import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Enforce } from '../Enforce';
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
}));
vi.mock('../ErrorReporting', () => ({ sendError: vi.fn() }));
vi.mock('../Storage', () => ({
    loadConsent: vi.fn(),
    saveConsent: vi.fn(),
    clearConsent: vi.fn(),
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

    beforeEach(setupEnforce);

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
});

// -----------------------------------------------------------------------
// W2 — setEnvironment empty/whitespace validation
// -----------------------------------------------------------------------

describe('Enforce.setEnvironment — empty/whitespace validation (W2)', () => {
    beforeEach(setupEnforce);

    it('rejects with invalidConfig when called with an empty string', async () => {
        await expect(Enforce.setEnvironment('')).rejects.toMatchObject({ kind: 'invalidConfig' });
    });

    it('rejects with invalidConfig when called with a whitespace-only string', async () => {
        await expect(Enforce.setEnvironment('   ')).rejects.toMatchObject({ kind: 'invalidConfig' });
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
        Enforce.showBanner();
        expect(sendError).not.toHaveBeenCalled();
    });

    it('calls sendError when enablePrivacyNotice is true but bannerConfig is absent', async () => {
        await setupWithRemote(REMOTE_BANNER_ON_NO_CONFIG);
        vi.mocked(sendError).mockClear();
        Enforce.showBanner();
        expect(sendError).toHaveBeenCalled();
    });

    it('calls sendError when banner config is present but presenter is not registered', async () => {
        await setupWithRemote(REMOTE_BANNER_ON);
        // No _registerCallbacks — _onShowBanner remains null
        vi.mocked(sendError).mockClear();
        Enforce.showBanner();
        expect(sendError).toHaveBeenCalled();
    });
});

describe('Enforce.showModal — guard branches', () => {
    it('does not call sendError when enableConsentModal is false', async () => {
        await setupWithRemote(REMOTE_MODAL_OFF);
        vi.mocked(sendError).mockClear();
        Enforce.showModal();
        expect(sendError).not.toHaveBeenCalled();
    });

    it('calls sendError when enableConsentModal is true but consentModalConfig is absent', async () => {
        await setupWithRemote(REMOTE_MODAL_ON_NO_CONFIG);
        vi.mocked(sendError).mockClear();
        Enforce.showModal();
        expect(sendError).toHaveBeenCalled();
    });

    it('calls sendError when modal config is present but presenter is not registered', async () => {
        await setupWithRemote(REMOTE_MODAL_ON);
        // No _registerCallbacks — _onShowModal remains null
        vi.mocked(sendError).mockClear();
        Enforce.showModal();
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
