import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Enforce } from '../Enforce';
import { toEnforceConfiguration } from '../PublicConfiguration';
import { configurePlatform } from '../configurePlatform';
import { fetchRemoteConfig } from '../api';
import { sendReportingBeacon } from '../ConsentReporting';
import { sendError } from '../ErrorReporting';
import {
    loadConsent,
    saveConsent,
    clearConsent,
    loadEnvironmentOverride,
    saveEnvironmentOverride,
    clearEnvironmentOverride,
} from '../Storage';
import type { ConsentData, EnforceConfig, RemoteConfig } from '../Types';

vi.mock('../configurePlatform', () => ({ configurePlatform: vi.fn() }));
vi.mock('../api', () => ({ fetchRemoteConfig: vi.fn() }));
vi.mock('../ConsentReporting', () => ({
    sendReportingBeacon: vi.fn(),
    resetReportingState: vi.fn(),
    clearReportedFlags: vi.fn(),
}));
vi.mock('../ErrorReporting', () => ({ sendError: vi.fn() }));
vi.mock('../Storage', () => ({
    loadConsent: vi.fn(),
    saveConsent: vi.fn(),
    clearConsent: vi.fn(),
    loadEnvironmentOverride: vi.fn(),
    saveEnvironmentOverride: vi.fn(),
    clearEnvironmentOverride: vi.fn(),
}));

const CONFIGURED_ENV = 'English';

const TEST_CONFIG: EnforceConfig = {
    clientName: 'test',
    publishPath: 'prod',
    environment: CONFIGURED_ENV,
};

const REMOTE_CONFIG = {
    clientId: 'cid-1',
    version: '1.0',
    enforcement: true,
    enablePrivacyNotice: false,
    enableConsentModal: false,
    translation: { cookies: {} },
    bannerConfig: {
        ensAcceptAll: { show: true }, ensRejectAll: { show: true },
        ensOpenModal: { show: true }, ensCloseBanner: { show: true },
    },
    consentModalConfig: {
        ensConsentAcceptAll: { show: true }, ensConsentRejectAll: { show: true },
        ensSaveModal: { show: true }, ensCloseModal: { show: true },
    },
} as unknown as RemoteConfig;

const ONE_YEAR = 31_536_000_000;

function validConsent(overrides: Partial<ConsentData> = {}): ConsentData {
    return {
        categories: { Analytics: true },
        savedAt: Date.now() - 1_000,
        dataRetentionPeriod: 86_400_000,
        version: '1',
        ...overrides,
    };
}

interface SetupOptions {
    override?: { environment: string; expiresAt: number } | null;
    storedConsent?: ConsentData | null;
    clearOverrideError?: Error;
}

async function configureNative({
    override = null,
    storedConsent = null,
    clearOverrideError,
}: SetupOptions = {}): Promise<void> {
    vi.resetAllMocks();
    vi.mocked(configurePlatform).mockResolvedValue(false);
    vi.mocked(fetchRemoteConfig).mockResolvedValue(REMOTE_CONFIG);
    vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
    vi.mocked(sendError).mockResolvedValue(true);
    vi.mocked(saveConsent).mockResolvedValue(undefined);
    vi.mocked(clearConsent).mockResolvedValue(undefined);
    vi.mocked(loadConsent).mockResolvedValue(storedConsent);
    vi.mocked(loadEnvironmentOverride).mockResolvedValue(override);
    vi.mocked(saveEnvironmentOverride).mockResolvedValue(undefined);
    if (clearOverrideError) {
        vi.mocked(clearEnvironmentOverride).mockRejectedValue(clearOverrideError);
    } else {
        vi.mocked(clearEnvironmentOverride).mockResolvedValue(undefined);
    }
    await Enforce.configure(TEST_CONFIG);
}

describe('before configure()', () => {
    // These run first, before any configure() call populates module state.
    it('getEnvironment returns null', async () => {
        expect(Enforce.getEnvironment()).toBeNull();
    });

    it('setEnvironment rejects with notConfigured', async () => {
        await expect(Enforce.setEnvironment('German')).rejects.toMatchObject({
            kind: 'notConfigured',
        });
    });

    it('resetEnvironment rejects with notConfigured', async () => {
        await expect(Enforce.resetEnvironment()).rejects.toMatchObject({
            kind: 'notConfigured',
        });
    });
});

describe('setEnvironment — override persistence', () => {
    it('persists the override with the stored consent record expiry', async () => {
        const consent = validConsent();
        await configureNative({ storedConsent: consent });

        await Enforce.setEnvironment('German');

        expect(saveEnvironmentOverride).toHaveBeenCalledWith(
            'German',
            consent.savedAt + consent.dataRetentionPeriod
        );
        expect(Enforce.getEnvironment()).toBe('German');
    });

    it('snapshots the expiry from an already-expired consent record too', async () => {
        const expired = validConsent({ savedAt: 1_000, dataRetentionPeriod: 1_000 });
        await configureNative();
        vi.mocked(loadConsent).mockResolvedValue(expired);

        await Enforce.setEnvironment('German');

        expect(saveEnvironmentOverride).toHaveBeenCalledWith('German', 2_000);
    });

    it('uses a one-year TTL when no consent is stored', async () => {
        await configureNative();

        const before = Date.now();
        await Enforce.setEnvironment('German');
        const after = Date.now();

        const [environment, expiresAt] = vi.mocked(saveEnvironmentOverride).mock.calls[0];
        expect(environment).toBe('German');
        expect(expiresAt).toBeGreaterThanOrEqual(before + ONE_YEAR);
        expect(expiresAt).toBeLessThanOrEqual(after + ONE_YEAR);
    });

    it('uses the configured dataRetentionPeriod when no consent is stored', async () => {
        vi.resetAllMocks();
        vi.mocked(configurePlatform).mockResolvedValue(false);
        vi.mocked(fetchRemoteConfig).mockResolvedValue(REMOTE_CONFIG);
        vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
        vi.mocked(loadConsent).mockResolvedValue(null);
        vi.mocked(loadEnvironmentOverride).mockResolvedValue(null);
        vi.mocked(saveEnvironmentOverride).mockResolvedValue(undefined);
        const THIRTY_DAYS = 2_592_000_000;
        await Enforce.configure({ ...TEST_CONFIG, dataRetentionPeriod: THIRTY_DAYS });

        const before = Date.now();
        await Enforce.setEnvironment('German');
        const after = Date.now();

        // The override must never outlive the retention policy it was set under.
        const [, expiresAt] = vi.mocked(saveEnvironmentOverride).mock.calls[0];
        expect(expiresAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS);
        expect(expiresAt).toBeLessThanOrEqual(after + THIRTY_DAYS);
        expect(expiresAt).toBeLessThan(before + ONE_YEAR);
    });

    it('rejects invalidEnvironment for whitespace input without fetching or persisting', async () => {
        await configureNative();
        vi.mocked(fetchRemoteConfig).mockClear();

        await expect(Enforce.setEnvironment('   ')).rejects.toMatchObject({
            kind: 'invalidEnvironment',
        });

        expect(fetchRemoteConfig).not.toHaveBeenCalled();
        expect(saveEnvironmentOverride).not.toHaveBeenCalled();
        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
    });

    it('keeps the previous environment and persists nothing when the fetch fails', async () => {
        await configureNative();
        vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('network down'));

        await expect(Enforce.setEnvironment('German')).rejects.toThrow('network down');

        expect(saveEnvironmentOverride).not.toHaveBeenCalled();
        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
    });
});

describe('configure — override application', () => {
    it('applies a valid stored override', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() + 60_000 },
        });

        expect(fetchRemoteConfig).toHaveBeenCalledWith(
            expect.objectContaining({ environment: 'German' })
        );
        expect(Enforce.getEnvironment()).toBe('German');
        expect(clearEnvironmentOverride).not.toHaveBeenCalled();
    });

    it('ignores and deletes an expired override', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() - 1 },
        });

        expect(clearEnvironmentOverride).toHaveBeenCalledOnce();
        expect(fetchRemoteConfig).toHaveBeenCalledWith(
            expect.objectContaining({ environment: CONFIGURED_ENV })
        );
        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
    });

    it('still configures when deleting an expired override fails', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() - 1 },
            clearOverrideError: new Error('storage unavailable'),
        });

        expect(fetchRemoteConfig).toHaveBeenCalledWith(
            expect.objectContaining({ environment: CONFIGURED_ENV })
        );
        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
        expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(REMOTE_CONFIG));
        expect(sendError).toHaveBeenCalledWith(
            expect.objectContaining({
                msg: 'storage unavailable',
                fn: 'Enforce.getValidEnvironmentOverride.clearExpired',
            })
        );
    });

    it('treats an override equal to the configured environment as a no-op', async () => {
        await configureNative({
            override: { environment: CONFIGURED_ENV, expiresAt: Date.now() + 60_000 },
        });

        expect(fetchRemoteConfig).toHaveBeenCalledWith(
            expect.objectContaining({ environment: CONFIGURED_ENV })
        );
        expect(clearEnvironmentOverride).not.toHaveBeenCalled();
        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
    });
});

describe('resetEnvironment', () => {
    it('clears the override and reverts to the configured environment', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() + 60_000 },
        });
        expect(Enforce.getEnvironment()).toBe('German');

        await Enforce.resetEnvironment();

        expect(clearEnvironmentOverride).toHaveBeenCalledOnce();
        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
    });

    it('also reverts an environment set during the session', async () => {
        await configureNative();
        await Enforce.setEnvironment('German');
        expect(Enforce.getEnvironment()).toBe('German');

        await Enforce.resetEnvironment();

        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
    });

    it('rejects when the override cannot be cleared', async () => {
        await configureNative();
        vi.mocked(clearEnvironmentOverride).mockRejectedValue(new Error('storage unavailable'));

        await expect(Enforce.resetEnvironment()).rejects.toThrow('storage unavailable');
    });
});

describe('environment override writes racing a newer environment change', () => {
    it('does not persist a setEnvironment override after a reset started during the persist', async () => {
        await configureNative();
        // Hold the consent read inside persistEnvironmentOverride open.
        let resolveConsentRead!: (consent: ConsentData | null) => void;
        vi.mocked(loadConsent).mockClear();
        vi.mocked(loadConsent).mockImplementationOnce(
            () => new Promise((resolve) => { resolveConsentRead = resolve; })
        );

        const envChange = Enforce.setEnvironment('German');
        await vi.waitFor(() => expect(loadConsent).toHaveBeenCalled());

        await Enforce.resetEnvironment();
        resolveConsentRead(null);
        await envChange;

        expect(clearEnvironmentOverride).toHaveBeenCalledOnce();
        expect(saveEnvironmentOverride).not.toHaveBeenCalled();
        expect(Enforce.getEnvironment()).toBe(CONFIGURED_ENV);
    });

    it('does not let a superseded setEnvironment persist overwrite a newer one', async () => {
        await configureNative();
        let resolveFirstConsentRead!: (consent: ConsentData | null) => void;
        vi.mocked(loadConsent).mockClear();
        vi.mocked(loadConsent).mockImplementationOnce(
            () => new Promise((resolve) => { resolveFirstConsentRead = resolve; })
        );

        const first = Enforce.setEnvironment('German');
        await vi.waitFor(() => expect(loadConsent).toHaveBeenCalled());

        await Enforce.setEnvironment('Spanish');
        resolveFirstConsentRead(null);
        await first;

        expect(saveEnvironmentOverride).toHaveBeenCalledOnce();
        expect(saveEnvironmentOverride).toHaveBeenCalledWith('Spanish', expect.any(Number));
    });

    it('does not re-align an override that a reset cleared while consent was being saved', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() + 60_000 },
        });
        // Hold the override read inside the consent-save re-align open.
        let resolveOverrideRead!: (override: { environment: string; expiresAt: number }) => void;
        vi.mocked(loadEnvironmentOverride).mockClear();
        vi.mocked(loadEnvironmentOverride).mockImplementationOnce(
            () => new Promise((resolve) => { resolveOverrideRead = resolve; })
        );

        const consentSave = Enforce.setConsent({ Analytics: true });
        await vi.waitFor(() => expect(loadEnvironmentOverride).toHaveBeenCalled());

        await Enforce.resetEnvironment();
        resolveOverrideRead({ environment: 'German', expiresAt: Date.now() + 60_000 });
        await consentSave;

        expect(clearEnvironmentOverride).toHaveBeenCalledOnce();
        expect(saveEnvironmentOverride).not.toHaveBeenCalled();
    });

    it('does not re-align an older override over one a setEnvironment in flight persisted', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() + 60_000 },
        });

        // setEnvironment starts first, so the consent save sees its request id.
        let resolveFetch!: (rc: RemoteConfig) => void;
        vi.mocked(fetchRemoteConfig).mockImplementationOnce(
            () => new Promise((resolve) => { resolveFetch = resolve; })
        );
        const envChange = Enforce.setEnvironment('Spanish');

        // The consent save reads the old override, and the read is held open.
        let resolveOverrideRead!: (override: { environment: string; expiresAt: number }) => void;
        vi.mocked(loadEnvironmentOverride).mockClear();
        vi.mocked(loadEnvironmentOverride).mockImplementationOnce(
            () => new Promise((resolve) => { resolveOverrideRead = resolve; })
        );
        const consentSave = Enforce.setConsent({ Analytics: true });
        await vi.waitFor(() => expect(loadEnvironmentOverride).toHaveBeenCalled());

        // setEnvironment commits and persists Spanish while the read is pending.
        resolveFetch(REMOTE_CONFIG);
        await envChange;
        resolveOverrideRead({ environment: 'German', expiresAt: Date.now() + 60_000 });
        await consentSave;

        expect(saveEnvironmentOverride).toHaveBeenCalledOnce();
        expect(saveEnvironmentOverride).toHaveBeenCalledWith('Spanish', expect.any(Number));
        expect(Enforce.getEnvironment()).toBe('Spanish');
    });
});

describe('resetEnvironment — remote configuration', () => {
    const GERMAN_REMOTE = { ...REMOTE_CONFIG, clientId: 'cid-de' } as RemoteConfig;
    const ENGLISH_REMOTE = { ...REMOTE_CONFIG, clientId: 'cid-en' } as RemoteConfig;
    const SPANISH_REMOTE = { ...REMOTE_CONFIG, clientId: 'cid-es' } as RemoteConfig;

    it("restores the configured environment's config without a refetch", async () => {
        await configureNative();
        vi.mocked(fetchRemoteConfig).mockResolvedValue(GERMAN_REMOTE);
        await Enforce.setEnvironment('German');
        expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(GERMAN_REMOTE));
        vi.mocked(fetchRemoteConfig).mockClear();

        await Enforce.resetEnvironment();

        expect(fetchRemoteConfig).not.toHaveBeenCalled();
        expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(REMOTE_CONFIG));
    });

    it('notifies the UI layer with the restored config', async () => {
        await configureNative();
        const onRemoteConfigLoaded = vi.fn();
        Enforce._registerCallbacks({
            showBanner: vi.fn(), hideBanner: vi.fn(),
            showModal: vi.fn(), hideModal: vi.fn(),
            onRemoteConfigLoaded,
        });
        vi.mocked(fetchRemoteConfig).mockResolvedValue(GERMAN_REMOTE);
        await Enforce.setEnvironment('German');

        await Enforce.resetEnvironment();

        expect(onRemoteConfigLoaded).toHaveBeenLastCalledWith(REMOTE_CONFIG);
    });

    describe('when the app launched with an override applied', () => {
        // configure() only fetched the override environment, so there is no
        // copy of the configured environment's config to restore.
        beforeEach(async () => {
            await configureNative({
                override: { environment: 'German', expiresAt: Date.now() + 60_000 },
            });
        });

        it('returns null from getConfiguration() until the background refetch lands', async () => {
            let resolveFetch!: (rc: RemoteConfig) => void;
            vi.mocked(fetchRemoteConfig).mockImplementationOnce(
                () => new Promise((resolve) => { resolveFetch = resolve; })
            );

            await Enforce.resetEnvironment();

            expect(fetchRemoteConfig).toHaveBeenLastCalledWith(
                expect.objectContaining({ environment: CONFIGURED_ENV })
            );
            expect(Enforce.getConfiguration()).toBeNull();
            // The consent UI and beacons keep the previous config meanwhile.
            expect(Enforce._getRemoteConfig()).toEqual(REMOTE_CONFIG);

            resolveFetch(ENGLISH_REMOTE);

            await vi.waitFor(() => {
                expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(ENGLISH_REMOTE));
            });
        });

        it('retries a failed refetch when called again', async () => {
            vi.mocked(fetchRemoteConfig).mockRejectedValueOnce(new Error('offline'));
            await Enforce.resetEnvironment();
            await vi.waitFor(() => {
                expect(sendError).toHaveBeenCalledWith(
                    expect.objectContaining({ fn: 'Enforce.refreshRemoteConfig' })
                );
            });
            expect(Enforce.getConfiguration()).toBeNull();

            vi.mocked(fetchRemoteConfig).mockResolvedValueOnce(ENGLISH_REMOTE);
            await Enforce.resetEnvironment();

            await vi.waitFor(() => {
                expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(ENGLISH_REMOTE));
            });
        });

        it('discards the refetch if the environment changes before it lands', async () => {
            let resolveFetch!: (rc: RemoteConfig) => void;
            vi.mocked(fetchRemoteConfig)
                .mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }))
                .mockResolvedValueOnce(SPANISH_REMOTE);

            await Enforce.resetEnvironment();
            await Enforce.setEnvironment('Spanish');
            resolveFetch(ENGLISH_REMOTE);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(Enforce.getEnvironment()).toBe('Spanish');
            expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(SPANISH_REMOTE));
        });
    });
});

describe('showBanner / showModal — remote config refresh', () => {
    it('re-fetches the remote config before showing the banner', async () => {
        await configureNative();
        expect(fetchRemoteConfig).toHaveBeenCalledTimes(1);

        await Enforce.showBanner();

        expect(fetchRemoteConfig).toHaveBeenCalledTimes(2);
    });

    it('re-fetches the remote config before showing the modal', async () => {
        await configureNative();

        await Enforce.showModal();

        expect(fetchRemoteConfig).toHaveBeenCalledTimes(2);
    });

    it('fetches the reverted environment after resetEnvironment', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() + 60_000 },
        });
        await Enforce.resetEnvironment();
        vi.mocked(fetchRemoteConfig).mockClear();

        await Enforce.showBanner();

        expect(fetchRemoteConfig).toHaveBeenCalledWith(
            expect.objectContaining({ environment: CONFIGURED_ENV })
        );
    });

    it('falls back to the cached config when the refresh fails', async () => {
        await configureNative();
        vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('offline'));

        await expect(Enforce.showBanner()).resolves.toBeUndefined();
        expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(REMOTE_CONFIG));
    });

    it('does not fetch on web, where configure() was handled by the platform', async () => {
        vi.resetAllMocks();
        vi.mocked(configurePlatform).mockResolvedValue(true);
        vi.mocked(loadConsent).mockResolvedValue(null);
        vi.mocked(loadEnvironmentOverride).mockResolvedValue(null);
        await Enforce.configure(TEST_CONFIG);

        await Enforce.showBanner();

        expect(fetchRemoteConfig).not.toHaveBeenCalled();
    });

    it('discards a stale refresh that resolves after a re-configure', async () => {
        await configureNative();

        // Start a refresh whose fetch stays pending.
        let resolveRefresh!: (rc: RemoteConfig) => void;
        vi.mocked(fetchRemoteConfig).mockImplementationOnce(
            () => new Promise((resolve) => { resolveRefresh = resolve; })
        );
        const showPromise = Enforce.showBanner();
        await Promise.resolve(); // let the refresh snapshot its request id

        // Re-configure commits a fresh remote config while the refresh hangs.
        const freshRemote = { ...REMOTE_CONFIG, version: '2.0' } as RemoteConfig;
        vi.mocked(fetchRemoteConfig).mockResolvedValue(freshRemote);
        await Enforce.configure(TEST_CONFIG);

        // The stale refresh result must not clobber the fresh config.
        resolveRefresh({ ...REMOTE_CONFIG, version: 'stale' } as RemoteConfig);
        await showPromise;

        expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(freshRemote));
    });

    it('discards a stale refresh that resolves after setEnvironment commits', async () => {
        await configureNative();

        // setEnvironment's fetch and the refresh's fetch both start pending.
        let resolveEnvChange!: (rc: RemoteConfig) => void;
        let resolveRefresh!: (rc: RemoteConfig) => void;
        vi.mocked(fetchRemoteConfig)
            .mockImplementationOnce(() => new Promise((resolve) => { resolveEnvChange = resolve; }))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));

        const envChange = Enforce.setEnvironment('German');
        const showPromise = Enforce.showBanner(); // refresh with the OLD config
        await Promise.resolve();

        const germanRemote = { ...REMOTE_CONFIG, version: 'german' } as RemoteConfig;
        resolveEnvChange(germanRemote);
        await envChange;

        resolveRefresh({ ...REMOTE_CONFIG, version: 'stale-english' } as RemoteConfig);
        await showPromise;

        expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(germanRemote));
        expect(Enforce.getEnvironment()).toBe('German');
    });
});

describe('web platform', () => {
    it('setEnvironment does not persist an override that configure() would never apply', async () => {
        vi.resetAllMocks();
        vi.mocked(configurePlatform).mockResolvedValue(true);
        vi.mocked(loadConsent).mockResolvedValue(null);
        vi.mocked(loadEnvironmentOverride).mockResolvedValue(null);
        vi.mocked(fetchRemoteConfig).mockResolvedValue(REMOTE_CONFIG);
        await Enforce.configure(TEST_CONFIG);

        await Enforce.setEnvironment('German');

        expect(saveEnvironmentOverride).not.toHaveBeenCalled();
    });
});

describe('consent lifecycle', () => {
    it('re-aligns the override expiry when consent is saved', async () => {
        await configureNative({
            override: { environment: 'German', expiresAt: Date.now() + 60_000 },
        });

        await Enforce.setConsent({ Analytics: true });

        const saved = vi.mocked(saveConsent).mock.calls[0][0];
        expect(saveEnvironmentOverride).toHaveBeenCalledWith(
            'German',
            saved.savedAt + saved.dataRetentionPeriod
        );
    });

    it('does not re-align an override the session is not running on', async () => {
        await configureNative();
        vi.mocked(loadEnvironmentOverride).mockResolvedValue({
            environment: 'German',
            expiresAt: Date.now() + 60_000,
        });

        await Enforce.setConsent({ Analytics: true });

        expect(saveEnvironmentOverride).not.toHaveBeenCalled();
    });

    it('does not revive an expired override when consent is saved', async () => {
        await configureNative();
        vi.mocked(loadEnvironmentOverride).mockResolvedValue({
            environment: 'German',
            expiresAt: Date.now() - 1,
        });

        await Enforce.setConsent({ Analytics: true });

        expect(saveEnvironmentOverride).not.toHaveBeenCalled();
        expect(clearEnvironmentOverride).toHaveBeenCalled();
    });

    it('clearConsent keeps the override', async () => {
        await configureNative();

        await Enforce.clearConsent();

        expect(clearConsent).toHaveBeenCalledOnce();
        expect(clearEnvironmentOverride).not.toHaveBeenCalled();
    });
});
