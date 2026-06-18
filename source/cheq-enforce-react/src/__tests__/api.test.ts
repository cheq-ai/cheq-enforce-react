import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchRemoteConfig } from '../api';
import type { EnforceConfig } from '../Types';

vi.mock('../ErrorReporting', () => ({
    sendError: vi.fn().mockResolvedValue(true),
}));

const CONFIG: EnforceConfig = {
    clientName: 'acme',
    publishPath: 'prod',
    environment: 'English',
};

const BASE_BANNER = {
    ensAcceptAll: { show: true },
    ensRejectAll: { show: true },
    ensOpenModal: { show: true },
    ensCloseBanner: { show: true },
};

const BASE_MODAL = {
    ensConsentAcceptAll: { show: true },
    ensConsentRejectAll: { show: true },
    ensSaveModal: { show: true },
    ensCloseModal: { show: true },
};

const BASE_TRANSLATION = {
    notificationBannerContent: 'We use cookies',
    notificationBannerPreferences: 'Preferences',
    close: 'Close',
    cookies: {},
};

const VALID_RESPONSE = {
    clientId: 'cid-1',
    version: '1.0',
    enforcement: true,
    enablePrivacyNotice: true,
    enableConsentModal: false,
    translation: BASE_TRANSLATION,
    bannerConfig: BASE_BANNER,
    consentModalConfig: BASE_MODAL,
};

function stubFetch(body: unknown, ok = true, status = 200): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok,
        status,
        json: () => Promise.resolve(body),
    }));
}

describe('fetchRemoteConfig', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('config validation', () => {
        it('throws invalidConfig when clientName is empty', async () => {
            await expect(
                fetchRemoteConfig({ ...CONFIG, clientName: '' })
            ).rejects.toMatchObject({ kind: 'invalidConfig' });
        });

        it('throws invalidConfig when publishPath is empty', async () => {
            await expect(
                fetchRemoteConfig({ ...CONFIG, publishPath: '' })
            ).rejects.toMatchObject({ kind: 'invalidConfig' });
        });
    });

    describe('network errors', () => {
        it('throws networkError when fetch rejects', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
            await expect(fetchRemoteConfig(CONFIG)).rejects.toMatchObject({ kind: 'networkError' });
        });

        it('throws networkError on non-200 response', async () => {
            stubFetch({}, false, 404);
            await expect(fetchRemoteConfig(CONFIG)).rejects.toMatchObject({ kind: 'networkError' });
        });
    });

    describe('schema validation', () => {
        it('throws parseError when JSON parsing fails', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.reject(new SyntaxError('bad json')),
            }));
            await expect(fetchRemoteConfig(CONFIG)).rejects.toMatchObject({ kind: 'parseError' });
        });

        it('throws parseError when response is an empty object', async () => {
            stubFetch({});
            await expect(fetchRemoteConfig(CONFIG)).rejects.toMatchObject({ kind: 'parseError' });
        });

        it('throws parseError when bannerConfig is absent', async () => {
            const { bannerConfig: _bc, ...noBC } = VALID_RESPONSE;
            stubFetch(noBC);
            await expect(fetchRemoteConfig(CONFIG)).rejects.toMatchObject({ kind: 'parseError' });
        });

        it('throws parseError when translation is missing required fields', async () => {
            stubFetch({ ...VALID_RESPONSE, translation: { cookies: {} } });
            await expect(fetchRemoteConfig(CONFIG)).rejects.toMatchObject({ kind: 'parseError' });
        });

        it('throws parseError when enableConsentModal=true but modal translation fields are missing', async () => {
            stubFetch({ ...VALID_RESPONSE, enableConsentModal: true });
            await expect(fetchRemoteConfig(CONFIG)).rejects.toMatchObject({ kind: 'parseError' });
        });
    });

    describe('successful parse and normalization', () => {
        it('returns config with clientId and version', async () => {
            stubFetch(VALID_RESPONSE);
            const result = await fetchRemoteConfig(CONFIG);
            expect(result.clientId).toBe('cid-1');
            expect(result.version).toBe('1.0');
        });

        it('fills in default Allow All / Deny All labels when absent', async () => {
            stubFetch(VALID_RESPONSE);
            const result = await fetchRemoteConfig(CONFIG);
            expect(result.translation.notificationBannerAllowAll).toBe('Allow All');
            expect(result.translation.notificationBannerDenyAll).toBe('Deny All');
        });

        it('preserves explicitly provided Allow All / Deny All labels', async () => {
            stubFetch({
                ...VALID_RESPONSE,
                translation: { ...BASE_TRANSLATION, notificationBannerAllowAll: 'Accept', notificationBannerDenyAll: 'Reject' },
            });
            const result = await fetchRemoteConfig(CONFIG);
            expect(result.translation.notificationBannerAllowAll).toBe('Accept');
            expect(result.translation.notificationBannerDenyAll).toBe('Reject');
        });

        it('accepts config when enableConsentModal=true and all modal fields are present', async () => {
            stubFetch({
                ...VALID_RESPONSE,
                enableConsentModal: true,
                translation: { ...BASE_TRANSLATION, consentTitle: 'Privacy', consentDescription: 'Choose', save: 'Save', cancel: 'Cancel' },
            });
            const result = await fetchRemoteConfig(CONFIG);
            expect(result.enableConsentModal).toBe(true);
            expect(result.translation.consentTitle).toBe('Privacy');
        });

        it('normalizes cookie details, filling in empty title/description for sparse entries', async () => {
            stubFetch({
                ...VALID_RESPONSE,
                translation: {
                    ...BASE_TRANSLATION,
                    cookies: {
                        analytics: { title: 'Analytics', description: 'Tracks usage' },
                        functional: {},
                    },
                },
            });
            const result = await fetchRemoteConfig(CONFIG);
            expect(result.translation.cookies['analytics']).toEqual({ title: 'Analytics', description: 'Tracks usage' });
            expect(result.translation.cookies['functional']).toEqual({ title: '', description: '' });
        });
    });
});
