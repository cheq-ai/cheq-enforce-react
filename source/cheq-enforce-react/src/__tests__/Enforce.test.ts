import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Enforce } from '../Enforce';
import { toEnforceConfiguration } from '../PublicConfiguration';
import { configurePlatform } from '../configurePlatform';
import { fetchRemoteConfig } from '../api';
import { sendReportingBeacon } from '../ConsentReporting';
import { sendError } from '../ErrorReporting';
import { loadConsent, saveConsent, clearConsent } from '../Storage';
import type { EnforceConfig, ConsentData, RemoteConfig } from '../Types';

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
    loadEnvironmentOverride: vi.fn().mockResolvedValue(null),
    saveEnvironmentOverride: vi.fn(),
    clearEnvironmentOverride: vi.fn(),
}));

const TEST_CONFIG: EnforceConfig = {
    clientName: 'test',
    publishPath: 'prod',
    environment: 'test-env',
    version: 'v1',
};

const NOW = Date.now();

function validConsent(overrides: Partial<ConsentData> = {}): ConsentData {
    return {
        categories: { analytics: true, marketing: false },
        savedAt: NOW - 1_000,
        dataRetentionPeriod: 86_400_000,
        version: 'v1',
        ...overrides,
    };
}

async function setupEnforce(): Promise<void> {
    vi.resetAllMocks();
    vi.mocked(configurePlatform).mockResolvedValue(true);
    vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
    vi.mocked(sendError).mockResolvedValue(true);
    vi.mocked(saveConsent).mockResolvedValue(undefined);
    vi.mocked(clearConsent).mockResolvedValue(undefined);
    vi.mocked(loadConsent).mockResolvedValue(null);
    await Enforce.configure(TEST_CONFIG);
}

describe('Enforce.getConsent — validateConsentData / normalizeStoredConsent', () => {
    beforeEach(setupEnforce);

    it('returns {} when no consent is stored', async () => {
        vi.mocked(loadConsent).mockResolvedValue(null);
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('returns categories for valid stored consent', async () => {
        vi.mocked(loadConsent).mockResolvedValue(validConsent());
        await expect(Enforce.getConsent()).resolves.toEqual({ analytics: true, marketing: false });
    });

    it('returns {} when consent has expired', async () => {
        vi.mocked(loadConsent).mockResolvedValue(
            validConsent({ savedAt: 0, dataRetentionPeriod: 1_000 })
        );
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('returns {} when stored version does not match config version', async () => {
        vi.mocked(loadConsent).mockResolvedValue(validConsent({ version: 'v99' }));
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('returns {} when stored data has no categories field', async () => {
        vi.mocked(loadConsent).mockResolvedValue({ categories: null } as unknown as ConsentData);
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('returns {} when category values are not booleans', async () => {
        vi.mocked(loadConsent).mockResolvedValue({
            ...validConsent(),
            categories: { analytics: 'yes' } as unknown as Record<string, boolean>,
        });
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('returns {} when savedAt is NaN', async () => {
        vi.mocked(loadConsent).mockResolvedValue(validConsent({ savedAt: NaN }));
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('returns {} when dataRetentionPeriod is negative', async () => {
        vi.mocked(loadConsent).mockResolvedValue(validConsent({ dataRetentionPeriod: -1 }));
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('migrates legacy expiresAt format and returns categories when not expired', async () => {
        vi.mocked(loadConsent).mockResolvedValue({
            categories: { analytics: true },
            expiresAt: NOW + 86_400_000,
            version: 'v1',
        } as unknown as ConsentData);
        await expect(Enforce.getConsent()).resolves.toEqual({ analytics: true });
    });

});

describe('Enforce.getConsent — category filtering', () => {
    beforeEach(async () => {
        await setupEnforce();
        vi.mocked(loadConsent).mockResolvedValue(validConsent());
    });

    it('returns all categories with no selection argument', async () => {
        await expect(Enforce.getConsent()).resolves.toEqual({ analytics: true, marketing: false });
    });

    it('returns a single category when called with a string', async () => {
        await expect(Enforce.getConsent('analytics')).resolves.toEqual({ analytics: true });
    });

    it('returns false for a missing category when called with a string', async () => {
        await expect(Enforce.getConsent('unknown')).resolves.toEqual({ unknown: false });
    });

    it('returns selected categories when called with a string array', async () => {
        await expect(Enforce.getConsent(['analytics', 'marketing'])).resolves.toEqual({
            analytics: true,
            marketing: false,
        });
    });

    it('returns false for missing categories in a string array', async () => {
        await expect(Enforce.getConsent(['analytics', 'unknown'])).resolves.toEqual({
            analytics: true,
            unknown: false,
        });
    });
});

// Remote configs used across multiple describe blocks
const REMOTE_BANNER_OFF: RemoteConfig = {
    clientId: 'cid', version: '1.0', enforcement: true,
    enablePrivacyNotice: false, enableConsentModal: false,
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

const REMOTE_BANNER_ON_NO_CONFIG: RemoteConfig = {
    clientId: 'cid', version: '1.0', enforcement: true,
    enablePrivacyNotice: true, enableConsentModal: false,
} as unknown as RemoteConfig;

const REMOTE_BANNER_ON: RemoteConfig = {
    clientId: 'cid', version: '1.0', enforcement: true,
    enablePrivacyNotice: true, enableConsentModal: false,
    bannerConfig: {},
    translation: { cookies: {} },
} as unknown as RemoteConfig;

const REMOTE_MODAL_OFF: RemoteConfig = {
    clientId: 'cid', version: '1.0', enforcement: true,
    enablePrivacyNotice: false, enableConsentModal: false,
} as unknown as RemoteConfig;

const REMOTE_MODAL_ON_NO_CONFIG: RemoteConfig = {
    clientId: 'cid', version: '1.0', enforcement: true,
    enablePrivacyNotice: false, enableConsentModal: true,
} as unknown as RemoteConfig;

const REMOTE_MODAL_ON: RemoteConfig = {
    clientId: 'cid', version: '1.0', enforcement: true,
    enablePrivacyNotice: false, enableConsentModal: true,
    consentModalConfig: {},
    translation: { cookies: {} },
} as unknown as RemoteConfig;

async function setupWithRemote(rc: RemoteConfig, storedConsent: ConsentData | null = null): Promise<void> {
    vi.resetAllMocks();
    // Reset UI callbacks to null so tests begin from a predictable clean state
    Enforce._registerCallbacks({
        showBanner: null as unknown as () => void,
        hideBanner: null as unknown as () => void,
        showModal: null as unknown as () => void,
        hideModal: null as unknown as () => void,
        onRemoteConfigLoaded: null as unknown as (rc: RemoteConfig) => void,
    });
    vi.mocked(configurePlatform).mockResolvedValue(false);
    vi.mocked(fetchRemoteConfig).mockResolvedValue(rc);
    vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
    vi.mocked(sendError).mockResolvedValue(true);
    vi.mocked(saveConsent).mockResolvedValue(undefined);
    vi.mocked(clearConsent).mockResolvedValue(undefined);
    vi.mocked(loadConsent).mockResolvedValue(storedConsent);
    await Enforce.configure(TEST_CONFIG);
}

// -----------------------------------------------------------------------
// Finding 14 — configure(): stored consent notification + autoShow=false
// -----------------------------------------------------------------------

describe('Enforce.configure — stored consent and autoShow', () => {
    it('fires onConsent handlers with stored categories when valid consent exists', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, validConsent());
        const handler = vi.fn();
        const unsubscribe = Enforce.onConsent(handler);

        await Enforce.configure(TEST_CONFIG);
        unsubscribe();

        expect(handler).toHaveBeenCalledWith({ analytics: true, marketing: false });
    });

    it('does not show banner or modal when autoShow is false and no stored consent', async () => {
        vi.resetAllMocks();
        vi.mocked(configurePlatform).mockResolvedValue(false);
        vi.mocked(fetchRemoteConfig).mockResolvedValue(REMOTE_BANNER_ON);
        vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
        vi.mocked(sendError).mockResolvedValue(true);
        vi.mocked(saveConsent).mockResolvedValue(undefined);
        vi.mocked(clearConsent).mockResolvedValue(undefined);
        vi.mocked(loadConsent).mockResolvedValue(null);

        const showBanner = vi.fn();
        const showModal = vi.fn();
        Enforce._registerCallbacks({
            showBanner,
            hideBanner: vi.fn(),
            showModal,
            hideModal: vi.fn(),
            onRemoteConfigLoaded: vi.fn(),
        });

        await Enforce.configure({ ...TEST_CONFIG, autoShow: false });

        expect(showBanner).not.toHaveBeenCalled();
        expect(showModal).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// Finding 15 — setEnvironment: happy path, rejection, stale-request guard
// -----------------------------------------------------------------------

describe('Enforce.setEnvironment', () => {
    const NEW_REMOTE: RemoteConfig = {
        clientId: 'new-cid', version: '2.0', enforcement: false,
        enablePrivacyNotice: false, enableConsentModal: false,
    } as unknown as RemoteConfig;

    // Native: the platform where a new environment's config is applied.
    beforeEach(() => setupWithRemote(REMOTE_BANNER_OFF));

    it('updates config.environment and remoteConfig on success', async () => {
        vi.mocked(fetchRemoteConfig).mockResolvedValue(NEW_REMOTE);
        await Enforce.setEnvironment('new-env');
        expect(Enforce._getConfig()?.environment).toBe('new-env');
        expect(Enforce._getRemoteConfig()).toEqual(NEW_REMOTE);
    });

    it('preserves original config and calls sendError when fetchRemoteConfig rejects', async () => {
        vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('network error'));
        await expect(Enforce.setEnvironment('bad-env')).rejects.toThrow('network error');
        expect(Enforce._getConfig()?.environment).toBe(TEST_CONFIG.environment);
        expect(sendError).toHaveBeenCalled();
    });

    it('ignores stale completions — only the second call commits its remote config', async () => {
        let resolveFirst!: (rc: RemoteConfig) => void;
        let resolveSecond!: (rc: RemoteConfig) => void;

        const firstRemote = { ...NEW_REMOTE, clientId: 'first' };
        const secondRemote = { ...NEW_REMOTE, clientId: 'second' };

        vi.mocked(fetchRemoteConfig)
            .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
            .mockImplementationOnce(() => new Promise(r => { resolveSecond = r; }));

        const firstCall = Enforce.setEnvironment('env-1');
        const secondCall = Enforce.setEnvironment('env-2');

        // Second resolves first — commits
        resolveSecond(secondRemote);
        await secondCall;

        // First resolves late — should be rejected as stale
        resolveFirst(firstRemote);
        await expect(firstCall).rejects.toThrow();

        expect(Enforce._getRemoteConfig()).toEqual(secondRemote);
    });

    it('does not report a stale completion as an error', async () => {
        let resolveFirst!: (rc: RemoteConfig) => void;
        vi.mocked(fetchRemoteConfig)
            .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
            .mockResolvedValueOnce(NEW_REMOTE);

        const firstCall = Enforce.setEnvironment('env-1');
        await Enforce.setEnvironment('env-2');
        resolveFirst(NEW_REMOTE);

        // The caller still learns its change was superseded…
        await expect(firstCall).rejects.toThrow('Ignoring stale environment change');
        // …but it is expected control flow, so no error beacon is sent.
        expect(sendError).not.toHaveBeenCalledWith(
            expect.objectContaining({ fn: 'Enforce.setEnvironment.fetchRemoteConfig' })
        );
    });

    describe('on web, where the consent UI is platform-managed', () => {
        beforeEach(setupEnforce);

        it('validates and returns the config without publishing it', async () => {
            vi.mocked(fetchRemoteConfig).mockResolvedValue(NEW_REMOTE);

            await expect(Enforce.setEnvironment('new-env')).resolves.toEqual(NEW_REMOTE);

            // configure() leaves the remote config null on web.
            expect(Enforce._getRemoteConfig()).toBeNull();
            expect(Enforce.getConfiguration()).toBeNull();
        });

        it('does not notify the UI layer of a new remote config', async () => {
            const onRemoteConfigLoaded = vi.fn();
            Enforce._registerCallbacks({
                showBanner: vi.fn(), hideBanner: vi.fn(),
                showModal: vi.fn(), hideModal: vi.fn(),
                onRemoteConfigLoaded,
            });
            vi.mocked(fetchRemoteConfig).mockResolvedValue(NEW_REMOTE);

            await Enforce.setEnvironment('new-env');

            expect(onRemoteConfigLoaded).not.toHaveBeenCalled();
        });

        it('still surfaces a failed validation to the caller', async () => {
            vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('network error'));
            await expect(Enforce.setEnvironment('bad-env')).rejects.toThrow('network error');
        });
    });
});

// -----------------------------------------------------------------------
// configure — older-format consent migration
// -----------------------------------------------------------------------

describe('Enforce.configure — older-format consent migration', () => {
    const legacyConsent = (overrides: Record<string, unknown> = {}) =>
        ({
            categories: { analytics: true },
            expiresAt: NOW + 86_400_000,
            version: 'v1',
            ...overrides,
        }) as unknown as ConsentData;

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rewrites valid older-format consent in the current format', async () => {
        const stored = legacyConsent();
        await setupWithRemote(REMOTE_BANNER_OFF, stored);

        expect(saveConsent).toHaveBeenCalledOnce();
        const saved = vi.mocked(saveConsent).mock.calls[0][0];
        expect(saved).toMatchObject({ categories: { analytics: true }, version: 'v1' });
        expect(saved).not.toHaveProperty('expiresAt');
        expect(saved.savedAt + saved.dataRetentionPeriod).toBe(
            (stored as unknown as { expiresAt: number }).expiresAt
        );
    });

    it('preserves the exact expiry even when the clock moves during migration', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, null);
        const expiresAt = NOW + 86_400_000;
        vi.mocked(loadConsent).mockResolvedValue(legacyConsent({ expiresAt }));
        // Every Date.now() call returns a later time.
        let clock = NOW;
        vi.spyOn(Date, 'now').mockImplementation(() => (clock += 7));

        await Enforce.configure(TEST_CONFIG);

        const saved = vi.mocked(saveConsent).mock.calls[0][0];
        expect(saved.savedAt + saved.dataRetentionPeriod).toBe(expiresAt);
    });

    it('does not rewrite current-format consent', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, validConsent());
        expect(saveConsent).not.toHaveBeenCalled();
    });

    it('clears expired older-format consent instead of rewriting it', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, legacyConsent({ expiresAt: NOW - 1_000 }));
        expect(saveConsent).not.toHaveBeenCalled();
        expect(clearConsent).toHaveBeenCalledOnce();
    });

    it('clears older-format consent with a stale version instead of rewriting it', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, legacyConsent({ version: 'v0' }));
        expect(saveConsent).not.toHaveBeenCalled();
        expect(clearConsent).toHaveBeenCalledOnce();
    });

    it('still completes configure() when the rewrite fails', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, null);
        vi.mocked(loadConsent).mockResolvedValue(legacyConsent());
        vi.mocked(saveConsent).mockRejectedValueOnce(new Error('storage full'));
        vi.mocked(sendReportingBeacon).mockClear();

        await expect(Enforce.configure(TEST_CONFIG)).resolves.toBeUndefined();

        // configure() carried on past the failed rewrite to its billing beacon.
        expect(sendReportingBeacon).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'billing' })
        );
        await expect(Enforce.getConsent()).resolves.toEqual({ analytics: true });
    });
});

// -----------------------------------------------------------------------
// getConfiguration — returns a copy
// -----------------------------------------------------------------------

describe('Enforce.getConfiguration', () => {
    it('returns a copy: mutating it does not change SDK state', async () => {
        const remote = {
            ...REMOTE_BANNER_OFF,
            translation: { cookies: { Analytics: { title: 'Analytics', description: 'Stats' } } },
        } as unknown as RemoteConfig;
        await setupWithRemote(remote, validConsent());

        const configuration = Enforce.getConfiguration();
        configuration!.clientId = 'tampered';
        configuration!.translation.cookies!.Injected = { title: 'x', description: 'y' };
        configuration!.translation.cookies!.Analytics.title = 'tampered';
        configuration!.bannerConfig!.ensAcceptAll = false;

        expect(Enforce._getRemoteConfig()!.clientId).toBe('cid');
        expect(Enforce._getRemoteConfig()!.translation.cookies).not.toHaveProperty('Injected');
        expect(Enforce._getRemoteConfig()!.translation.cookies.Analytics.title).toBe('Analytics');
        expect(Enforce._getRemoteConfig()!.bannerConfig.ensAcceptAll.show).toBe(true);
        const again = Enforce.getConfiguration();
        expect(again!.clientId).toBe('cid');
        expect(again!.translation.cookies).not.toHaveProperty('Injected');
        expect(again!.translation.cookies!.Analytics.title).toBe('Analytics');
        expect(again!.bannerConfig!.ensAcceptAll).toBe(true);
    });
});

// -----------------------------------------------------------------------
// _registerCallbacks — unregister
// -----------------------------------------------------------------------

describe('Enforce._registerCallbacks', () => {
    const makeCallbacks = () => ({
        showBanner: vi.fn(), hideBanner: vi.fn(),
        showModal: vi.fn(), hideModal: vi.fn(),
        onRemoteConfigLoaded: vi.fn(),
    });

    it('unregister clears the callbacks', () => {
        const callbacks = makeCallbacks();
        const unregister = Enforce._registerCallbacks(callbacks);

        unregister();
        Enforce._hideBanner();
        Enforce._hideModal();

        expect(callbacks.hideBanner).not.toHaveBeenCalled();
        expect(callbacks.hideModal).not.toHaveBeenCalled();
    });

    it('a stale unregister does not clear a newer registration', () => {
        const first = makeCallbacks();
        const second = makeCallbacks();
        const unregisterFirst = Enforce._registerCallbacks(first);
        Enforce._registerCallbacks(second);

        unregisterFirst();
        Enforce._hideBanner();

        expect(second.hideBanner).toHaveBeenCalledOnce();
        expect(first.hideBanner).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// configure — a superseded call stops applying state
// -----------------------------------------------------------------------

describe('Enforce.configure — overlapping calls', () => {
    const firstRemote = { ...REMOTE_BANNER_ON, clientId: 'first' } as RemoteConfig;
    const secondRemote = { ...REMOTE_BANNER_OFF, clientId: 'second' } as RemoteConfig;

    it('keeps the newer call\'s remote config when the older fetch resolves last', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, null);
        const showBanner = vi.fn();
        Enforce._registerCallbacks({
            showBanner, hideBanner: vi.fn(),
            showModal: vi.fn(), hideModal: vi.fn(),
            onRemoteConfigLoaded: vi.fn(),
        });
        let resolveFirst!: (rc: RemoteConfig) => void;
        vi.mocked(fetchRemoteConfig).mockClear();
        vi.mocked(fetchRemoteConfig)
            .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
            .mockResolvedValueOnce(secondRemote);
        vi.mocked(sendReportingBeacon).mockClear();

        const first = Enforce.configure({ ...TEST_CONFIG, environment: 'first-env' });
        // Let the older call reach its fetch before the newer one starts.
        await vi.waitFor(() => expect(fetchRemoteConfig).toHaveBeenCalledTimes(1));
        await Enforce.configure({ ...TEST_CONFIG, environment: 'second-env' });
        resolveFirst(firstRemote);
        await first;

        expect(Enforce._getRemoteConfig()).toEqual(secondRemote);
        expect(Enforce._getConfig()?.environment).toBe('second-env');
        // The older call must not show its banner or send its billing beacon.
        expect(showBanner).not.toHaveBeenCalled();
        expect(sendReportingBeacon).toHaveBeenCalledTimes(1);
        expect(sendReportingBeacon).toHaveBeenCalledWith(
            expect.objectContaining({ remoteConfig: secondRemote })
        );
    });

    it('does not clear the newer call\'s config when the older fetch fails last', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, null);
        let rejectFirst!: (e: Error) => void;
        vi.mocked(fetchRemoteConfig).mockClear();
        vi.mocked(fetchRemoteConfig)
            .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
            .mockResolvedValueOnce(secondRemote);

        const first = Enforce.configure({ ...TEST_CONFIG, environment: 'first-env' });
        await vi.waitFor(() => expect(fetchRemoteConfig).toHaveBeenCalledTimes(1));
        await Enforce.configure({ ...TEST_CONFIG, environment: 'second-env' });
        rejectFirst(new Error('network down'));
        await first;

        expect(Enforce._getRemoteConfig()).toEqual(secondRemote);
        expect(Enforce.getConfiguration()).toEqual(toEnforceConfiguration(secondRemote));
    });
});

// -----------------------------------------------------------------------
// W2 — setEnvironment empty/whitespace validation
// -----------------------------------------------------------------------

describe('Enforce.setEnvironment — empty/whitespace validation (W2)', () => {
    beforeEach(setupEnforce);

    it('rejects with invalidEnvironment when called with an empty string', async () => {
        await expect(Enforce.setEnvironment('')).rejects.toMatchObject({ kind: 'invalidEnvironment' });
    });

    it('rejects with invalidEnvironment when called with a whitespace-only string', async () => {
        await expect(Enforce.setEnvironment('   ')).rejects.toMatchObject({ kind: 'invalidEnvironment' });
    });

    it('does not call fetchRemoteConfig when environment string is empty', async () => {
        await expect(Enforce.setEnvironment('')).rejects.toBeDefined();
        expect(fetchRemoteConfig).not.toHaveBeenCalled();
    });

    it('does not call fetchRemoteConfig when environment string is whitespace-only', async () => {
        await expect(Enforce.setEnvironment('   ')).rejects.toBeDefined();
        expect(fetchRemoteConfig).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// _applyDefault — close/dismiss button behaviour
// -----------------------------------------------------------------------

describe('Enforce._applyDefault', () => {
    const CONFIG_WITH_DEFAULT = { ...TEST_CONFIG, defaultConsent: { Analytics: true, Marketing: false } };

    it('applies defaultConsent when no valid consent is stored', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, null);
        await Enforce.configure(CONFIG_WITH_DEFAULT);
        vi.mocked(loadConsent).mockResolvedValue(null);
        await Enforce._applyDefault({ BANNER_VIEWED: true });
        expect(saveConsent).toHaveBeenCalledWith(
            expect.objectContaining({ categories: { Analytics: true, Marketing: false } })
        );
    });

    it('does not overwrite consent when valid consent is already stored', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF, null);
        await Enforce.configure(CONFIG_WITH_DEFAULT);
        vi.mocked(loadConsent).mockResolvedValue(validConsent({ categories: { Analytics: false, Marketing: true } }));
        vi.mocked(saveConsent).mockClear();
        await Enforce._applyDefault({ BANNER_VIEWED: true });
        expect(saveConsent).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// Finding 16 — setConsent: merge, persistence, subscriber notification
// -----------------------------------------------------------------------

describe('Enforce.setConsent', () => {
    beforeEach(setupEnforce);

    it('merges new categories with existing stored consent', async () => {
        vi.mocked(loadConsent).mockResolvedValue(validConsent({ categories: { analytics: true } }));
        await Enforce.setConsent({ marketing: true });
        expect(saveConsent).toHaveBeenCalledWith(
            expect.objectContaining({ categories: { analytics: true, marketing: true } })
        );
    });

    it('calls sendReportingBeacon with merged cookieFlags', async () => {
        vi.mocked(loadConsent).mockResolvedValue(validConsent({ categories: { analytics: true } }));
        await Enforce.setConsent({ marketing: true });
        expect(sendReportingBeacon).toHaveBeenCalledWith(
            expect.objectContaining({ cookieFlags: { analytics: true, marketing: true } })
        );
    });

    it('notifies _addConsentChangeListener subscribers', async () => {
        vi.mocked(loadConsent).mockResolvedValue(null);
        const listener = vi.fn();
        const unsubscribe = Enforce._addConsentChangeListener(listener);
        await Enforce.setConsent({ analytics: true });
        unsubscribe();
        expect(listener).toHaveBeenCalled();
    });

    it('does not merge categories from expired stored consent', async () => {
        // Expired consent contains a stale "advertising" category added in a previous session.
        vi.mocked(loadConsent).mockResolvedValue(
            validConsent({ savedAt: 0, dataRetentionPeriod: 1_000, categories: { analytics: true, advertising: true } })
        );
        await Enforce.setConsent({ analytics: false, marketing: true });
        expect(saveConsent).toHaveBeenCalledWith(
            expect.objectContaining({ categories: { analytics: false, marketing: true } })
        );
    });
});

// -----------------------------------------------------------------------
// Finding 17 — showBanner / showModal guard branches
// -----------------------------------------------------------------------

describe('Enforce.showBanner — guard branches', () => {
    it('does not call sendError when enablePrivacyNotice is false', async () => {
        await setupWithRemote(REMOTE_BANNER_OFF);
        vi.mocked(sendError).mockClear();
        await Enforce.showBanner();
        expect(sendError).not.toHaveBeenCalled();
    });

    it('calls sendError when enablePrivacyNotice is true but bannerConfig is absent', async () => {
        await setupWithRemote(REMOTE_BANNER_ON_NO_CONFIG);
        vi.mocked(sendError).mockClear();
        await Enforce.showBanner();
        expect(sendError).toHaveBeenCalled();
    });

    it('calls sendError when banner config is present but presenter is not registered', async () => {
        await setupWithRemote(REMOTE_BANNER_ON);
        // No _registerCallbacks — _onShowBanner remains null
        vi.mocked(sendError).mockClear();
        await Enforce.showBanner();
        expect(sendError).toHaveBeenCalled();
    });
});

describe('Enforce.showModal — guard branches', () => {
    it('does not call sendError when enableConsentModal is false', async () => {
        await setupWithRemote(REMOTE_MODAL_OFF);
        vi.mocked(sendError).mockClear();
        await Enforce.showModal();
        expect(sendError).not.toHaveBeenCalled();
    });

    it('calls sendError when enableConsentModal is true but consentModalConfig is absent', async () => {
        await setupWithRemote(REMOTE_MODAL_ON_NO_CONFIG);
        vi.mocked(sendError).mockClear();
        await Enforce.showModal();
        expect(sendError).toHaveBeenCalled();
    });

    it('calls sendError when modal config is present but presenter is not registered', async () => {
        await setupWithRemote(REMOTE_MODAL_ON);
        // No _registerCallbacks — _onShowModal remains null
        vi.mocked(sendError).mockClear();
        await Enforce.showModal();
        expect(sendError).toHaveBeenCalled();
    });
});

describe('Enforce — remote config fetch failure fallback to defaultConsent', () => {
    const DEFAULT_CONSENT = { Analytics: true, Marketing: false, Functional: true };

    const CONFIG_WITH_DEFAULT: EnforceConfig = {
        ...TEST_CONFIG,
        defaultConsent: DEFAULT_CONSENT,
    };

    const STUB_REMOTE_CONFIG: RemoteConfig = {
        clientId: 'cid',
        enablePrivacyNotice: false,
        enableConsentModal: false,
    } as unknown as RemoteConfig;

    async function configureWithFetchFailure(config: EnforceConfig = CONFIG_WITH_DEFAULT) {
        vi.resetAllMocks();
        vi.mocked(configurePlatform).mockResolvedValue(false);
        vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('network error'));
        vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
        vi.mocked(sendError).mockResolvedValue(true);
        vi.mocked(saveConsent).mockResolvedValue(undefined);
        vi.mocked(clearConsent).mockResolvedValue(undefined);
        vi.mocked(loadConsent).mockResolvedValue(null);
        await Enforce.configure(config);
    }

    async function configureWithFetchSuccess(config: EnforceConfig = CONFIG_WITH_DEFAULT) {
        vi.resetAllMocks();
        vi.mocked(configurePlatform).mockResolvedValue(false);
        vi.mocked(fetchRemoteConfig).mockResolvedValue(STUB_REMOTE_CONFIG);
        vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
        vi.mocked(sendError).mockResolvedValue(true);
        vi.mocked(saveConsent).mockResolvedValue(undefined);
        vi.mocked(clearConsent).mockResolvedValue(undefined);
        vi.mocked(loadConsent).mockResolvedValue(null);
        await Enforce.configure(config);
    }

    it('getConsent() returns full defaultConsent when fetch fails and no stored consent', async () => {
        await configureWithFetchFailure();
        await expect(Enforce.getConsent()).resolves.toEqual(DEFAULT_CONSENT);
    });

    it('getConsent() returns a single category from defaultConsent', async () => {
        await configureWithFetchFailure();
        await expect(Enforce.getConsent('Analytics')).resolves.toEqual({ Analytics: true });
    });

    it('getConsent() returns false for a category set to false in defaultConsent', async () => {
        await configureWithFetchFailure();
        await expect(Enforce.getConsent('Marketing')).resolves.toEqual({ Marketing: false });
    });

    it('checkConsent() returns true for a consented category from defaultConsent', async () => {
        await configureWithFetchFailure();
        await expect(Enforce.checkConsent('Analytics')).resolves.toBe(true);
    });

    it('checkConsent() returns false for a denied category from defaultConsent', async () => {
        await configureWithFetchFailure();
        await expect(Enforce.checkConsent('Marketing')).resolves.toBe(false);
    });

    it('does not persist defaultConsent to storage when fetch fails', async () => {
        await configureWithFetchFailure();
        expect(saveConsent).not.toHaveBeenCalled();
    });

    it('getConsent() returns {} when fetch fails and no defaultConsent is provided', async () => {
        await configureWithFetchFailure({ ...TEST_CONFIG });
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('fallback is cleared on a subsequent successful configure()', async () => {
        await configureWithFetchFailure();
        await configureWithFetchSuccess();
        // No stored consent — should return {} (fallback cleared, not applied)
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });

    it('stored consent takes precedence over defaultConsent when fetch fails', async () => {
        await configureWithFetchFailure();
        vi.mocked(loadConsent).mockResolvedValue(validConsent());
        await expect(Enforce.getConsent()).resolves.toEqual({ analytics: true, marketing: false });
    });

    it('clearConsent() clears the fallback so getConsent() returns {} afterwards', async () => {
        await configureWithFetchFailure();
        await expect(Enforce.getConsent()).resolves.toEqual(DEFAULT_CONSENT);
        await Enforce.clearConsent();
        await expect(Enforce.getConsent()).resolves.toEqual({});
    });
});
