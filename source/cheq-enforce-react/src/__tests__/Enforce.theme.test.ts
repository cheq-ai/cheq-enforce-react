import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Enforce } from '../Enforce';
import { configurePlatform } from '../configurePlatform';
import { fetchRemoteConfig } from '../api';
import { sendReportingBeacon } from '../ConsentReporting';
import { sendError } from '../ErrorReporting';
import { loadConsent, saveConsent, clearConsent } from '../Storage';
import type { EnforceConfig, RemoteConfig, Translation } from '../Types';

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
};

const TRANSLATION: Translation = {
    notificationBannerContent: 'We use cookies',
    notificationBannerAllowAll: 'Allow All',
    notificationBannerDenyAll: 'Deny All',
    notificationBannerPreferences: 'Preferences',
    consentTitle: 'Privacy Settings',
    consentDescription: 'Description',
    consentModalAllowAll: 'Allow All',
    consentModalDenyAll: 'Deny All',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    cookies: {},
};

const REMOTE_CONFIG: RemoteConfig = {
    clientId: 'cid-1',
    enablePrivacyNotice: false,
    enableConsentModal: false,
    translation: TRANSLATION,
    bannerConfig: {
        ensAcceptAll: { show: true },
        ensRejectAll: { show: true },
        ensOpenModal: { show: true },
        ensCloseBanner: { show: true },
    },
    consentModalConfig: {
        ensConsentAcceptAll: { show: true },
        ensConsentRejectAll: { show: true },
        ensSaveModal: { show: true },
        ensCloseModal: { show: true },
    },
};

function setupMocks({ web = false }: { web?: boolean } = {}): void {
    vi.resetAllMocks();
    vi.mocked(configurePlatform).mockResolvedValue(web);
    vi.mocked(fetchRemoteConfig).mockResolvedValue(REMOTE_CONFIG);
    vi.mocked(sendReportingBeacon).mockResolvedValue(undefined);
    vi.mocked(sendError).mockResolvedValue(true);
    vi.mocked(saveConsent).mockResolvedValue(undefined);
    vi.mocked(clearConsent).mockResolvedValue(undefined);
    vi.mocked(loadConsent).mockResolvedValue(null);
}

describe('Enforce.getConfiguration', () => {
    // NOTE: this test intentionally runs first in the file, before any
    // configure() call has populated the module-level state.
    it('resolves null before configure()', async () => {
        expect(Enforce.getConfiguration()).toBeNull();
    });

    beforeEach(() => setupMocks());

    it('resolves the public configuration after a successful configure()', async () => {
        await Enforce.configure(TEST_CONFIG);
        expect(Enforce.getConfiguration()).toEqual({
            clientId: 'cid-1',
            version: undefined,
            enforcement: undefined,
            enablePrivacyNotice: false,
            enableConsentModal: false,
            translation: TRANSLATION,
            bannerConfig: {
                ensAcceptAll: true, ensRejectAll: true,
                ensOpenModal: true, ensCloseBanner: true,
            },
            consentModalConfig: {
                ensConsentAcceptAll: true, ensConsentRejectAll: true,
                ensSaveModal: true, ensCloseModal: true,
            },
        });
    });

    it('returns a copy rather than the internal remote config object', async () => {
        await Enforce.configure(TEST_CONFIG);
        const first = Enforce.getConfiguration();
        const second = Enforce.getConfiguration();
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
    });

    it('resolves null on web, where the remote config is never fetched', async () => {
        setupMocks({ web: true });
        await Enforce.configure(TEST_CONFIG);
        expect(Enforce.getConfiguration()).toBeNull();
        expect(fetchRemoteConfig).not.toHaveBeenCalled();
    });

    it('resolves null when the remote config fetch failed', async () => {
        vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('boom'));
        await Enforce.configure(TEST_CONFIG);
        expect(Enforce.getConfiguration()).toBeNull();
    });

    it('resolves null when a re-configure fetch fails after a previous success', async () => {
        await Enforce.configure(TEST_CONFIG);
        expect(Enforce.getConfiguration()).not.toBeNull();

        vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('boom'));
        await Enforce.configure(TEST_CONFIG);
        expect(Enforce.getConfiguration()).toBeNull();
    });

    it('reflects the new environment after setEnvironment()', async () => {
        await Enforce.configure(TEST_CONFIG);

        const nextRemote: RemoteConfig = {
            ...REMOTE_CONFIG,
            translation: { ...TRANSLATION, notificationBannerContent: 'Wir verwenden Cookies' },
        };
        vi.mocked(fetchRemoteConfig).mockResolvedValue(nextRemote);
        await Enforce.setEnvironment('German');

        const configuration = Enforce.getConfiguration();
        expect(configuration?.translation.notificationBannerContent).toBe('Wir verwenden Cookies');
    });
});

describe('Enforce.configure — theme', () => {
    beforeEach(() => setupMocks());

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects invalidConfig for a structurally invalid theme without fetching', async () => {
        await expect(
            Enforce.configure({ ...TEST_CONFIG, theme: 42 as never })
        ).rejects.toMatchObject({ kind: 'invalidConfig' });
        expect(fetchRemoteConfig).not.toHaveBeenCalled();
        expect(configurePlatform).not.toHaveBeenCalled();
    });

    it('rejects invalidConfig for wrong-typed theme values', async () => {
        await expect(
            Enforce.configure({
                ...TEST_CONFIG,
                theme: { banner: { summary: { description: { fontSize: '16' } } } } as never,
            })
        ).rejects.toMatchObject({ kind: 'invalidConfig' });
    });

    describe('a rejected reconfigure leaves the current state untouched', () => {
        const MALFORMED_THEME = 42 as never;

        it('keeps the current resolved theme', async () => {
            await Enforce.configure({ ...TEST_CONFIG, theme: { banner: { backgroundColor: '#FDF6EC' } } });
            const before = Enforce._getResolvedTheme();
            expect(before).not.toBeNull();

            await expect(
                Enforce.configure({ ...TEST_CONFIG, theme: MALFORMED_THEME })
            ).rejects.toMatchObject({ kind: 'invalidConfig' });

            expect(Enforce._getResolvedTheme()).toBe(before);
        });

        it('keeps the defaultConsent fallback', async () => {
            vi.mocked(fetchRemoteConfig).mockRejectedValue(new Error('offline'));
            const config = { ...TEST_CONFIG, defaultConsent: { Analytics: true } };
            await Enforce.configure(config);
            await expect(Enforce.getConsent()).resolves.toEqual({ Analytics: true });

            await expect(
                Enforce.configure({ ...config, theme: MALFORMED_THEME })
            ).rejects.toMatchObject({ kind: 'invalidConfig' });

            await expect(Enforce.getConsent()).resolves.toEqual({ Analytics: true });
        });

        it('lets an in-flight setEnvironment() complete', async () => {
            await Enforce.configure(TEST_CONFIG);
            let resolveFetch!: (rc: RemoteConfig) => void;
            vi.mocked(fetchRemoteConfig).mockImplementationOnce(
                () => new Promise((resolve) => { resolveFetch = resolve; })
            );

            const pending = Enforce.setEnvironment('German');
            await expect(
                Enforce.configure({ ...TEST_CONFIG, theme: MALFORMED_THEME })
            ).rejects.toMatchObject({ kind: 'invalidConfig' });
            resolveFetch(REMOTE_CONFIG);

            await expect(pending).resolves.toEqual(REMOTE_CONFIG);
            expect(Enforce.getEnvironment()).toBe('German');
        });

        it('lets an in-flight configure() complete', async () => {
            const inFlightRemote: RemoteConfig = { ...REMOTE_CONFIG, clientId: 'in-flight' };
            let resolveFetch!: (rc: RemoteConfig) => void;
            vi.mocked(fetchRemoteConfig).mockImplementationOnce(
                () => new Promise((resolve) => { resolveFetch = resolve; })
            );

            const first = Enforce.configure(TEST_CONFIG);
            // Let the first call reach its fetch before the rejected one runs.
            await vi.waitFor(() => expect(fetchRemoteConfig).toHaveBeenCalledOnce());
            await expect(
                Enforce.configure({ ...TEST_CONFIG, theme: MALFORMED_THEME })
            ).rejects.toMatchObject({ kind: 'invalidConfig' });
            resolveFetch(inFlightRemote);
            await first;

            expect(Enforce.getConfiguration()).toMatchObject({ clientId: 'in-flight' });
        });
    });

    it('resolves the theme on native and exposes it internally', async () => {
        await Enforce.configure({
            ...TEST_CONFIG,
            theme: {
                banner: {
                    backgroundColor: '#FDF6EC',
                    buttons: {
                        order: ['rejectAll', 'acceptAll'],
                        acceptAll: { backgroundColor: '#2E7D32' },
                    },
                },
            },
        });

        const resolved = Enforce._getResolvedTheme();
        expect(resolved).not.toBeNull();
        expect(resolved?.banner.backgroundColor).toBe('#FDF6EC');
        expect(resolved?.banner.buttons.acceptAll.container.backgroundColor).toBe('#2E7D32');
        expect(resolved?.banner.buttonOrder).toEqual(['rejectAll', 'acceptAll', 'openModal', 'close']);
        expect(fetchRemoteConfig).toHaveBeenCalledOnce();
    });

    it('clears a previously resolved theme when configure() runs without one', async () => {
        await Enforce.configure({ ...TEST_CONFIG, theme: { banner: {} } });
        expect(Enforce._getResolvedTheme()).not.toBeNull();

        await Enforce.configure(TEST_CONFIG);
        expect(Enforce._getResolvedTheme()).toBeNull();
    });

    it('routes value-level theme warnings through debug-gated logging', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await Enforce.configure({
            ...TEST_CONFIG,
            debug: true,
            theme: { banner: { backgroundColor: 'not-a-color' } },
        });
        expect(consoleWarn).toHaveBeenCalledWith(
            '[CheqEnforce]',
            expect.stringContaining('invalid hex color "not-a-color"')
        );

        consoleWarn.mockClear();
        await Enforce.configure({
            ...TEST_CONFIG,
            debug: false,
            theme: { banner: { backgroundColor: 'not-a-color' } },
        });
        expect(consoleWarn).not.toHaveBeenCalled();
    });

    it('ignores the theme on web with a debug log and no resolution', async () => {
        setupMocks({ web: true });
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

        await Enforce.configure({
            ...TEST_CONFIG,
            debug: true,
            theme: { banner: { backgroundColor: '#FDF6EC' } },
        });

        expect(consoleLog).toHaveBeenCalledWith(
            '[CheqEnforce]',
            expect.stringContaining('theme is ignored on web')
        );
        expect(Enforce._getResolvedTheme()).toBeNull();
        expect(Enforce.getConfiguration()).toBeNull();
    });

    it('still rejects a structurally invalid theme on web', async () => {
        setupMocks({ web: true });
        await expect(
            Enforce.configure({ ...TEST_CONFIG, theme: [] as never })
        ).rejects.toMatchObject({ kind: 'invalidConfig' });
    });
});
