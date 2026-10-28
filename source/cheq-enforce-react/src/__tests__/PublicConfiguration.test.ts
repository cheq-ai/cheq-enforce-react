import { describe, it, expect } from 'vitest';
import { toEnforceConfiguration } from '../PublicConfiguration';
import type { RemoteConfig } from '../Types';

// Trimmed from a real environment.json, including fields the SDK does not
// model (optVals, consentWidgetCopy, the tcf2* blocks, *CustomConfig).
const REMOTE: RemoteConfig = {
    clientId: '1977',
    version: '2.3.811',
    enforcement: true,
    enablePrivacyNotice: true,
    enableConsentModal: true,
    optVals: { Functional: 0, Analytics: 0, Marketing: 0 },
    translation: {
        notificationBannerContent: 'By using our site, you agree to our use of cookies.',
        notificationBannerAllowAll: 'Allow All',
        notificationBannerDenyAll: 'Deny All',
        notificationBannerPreferences: 'Preferences',
        consentTitle: 'Privacy Settings',
        consentDescription: 'We might sometimes use cookies.',
        consentWidgetCopy: 'Privacy Settings',
        consentModalAllowAll: 'Allow All',
        consentModalDenyAll: 'Deny All',
        tcf2Modal: { title: 'Privacy Settings', accept: 'Accept' },
        tcf2Shared: { purposes: 'Purposes', vendors: 'Vendors' },
        save: 'Save',
        cancel: 'Cancel',
        close: 'Close',
        cookies: {
            Analytics: { title: 'Analytics', description: 'Usage statistics' },
            Marketing: { title: 'Marketing', description: 'Advertising' },
        },
    },
    bannerConfig: {
        ensAcceptAll: { show: true },
        ensRejectAll: { show: false },
        ensOpenModal: { show: true },
        ensCloseBanner: { show: false },
    },
    consentModalConfig: {
        ensConsentAcceptAll: { show: true },
        ensConsentRejectAll: { show: true },
        ensSaveModal: { show: false },
        ensCloseModal: { show: true },
    },
    privacyNoticeCustomConfig: null,
    consentModalCustomConfig: null,
} as unknown as RemoteConfig;

describe('toEnforceConfiguration', () => {
    it('returns exactly the public EnforceConfiguration shape', () => {
        expect(toEnforceConfiguration(REMOTE)).toStrictEqual({
            clientId: '1977',
            version: '2.3.811',
            enforcement: true,
            enablePrivacyNotice: true,
            enableConsentModal: true,
            translation: {
                notificationBannerContent: 'By using our site, you agree to our use of cookies.',
                notificationBannerAllowAll: 'Allow All',
                notificationBannerDenyAll: 'Deny All',
                notificationBannerPreferences: 'Preferences',
                consentTitle: 'Privacy Settings',
                consentDescription: 'We might sometimes use cookies.',
                consentModalAllowAll: 'Allow All',
                consentModalDenyAll: 'Deny All',
                save: 'Save',
                cancel: 'Cancel',
                close: 'Close',
                cookies: {
                    Analytics: { title: 'Analytics', description: 'Usage statistics' },
                    Marketing: { title: 'Marketing', description: 'Advertising' },
                },
            },
            bannerConfig: {
                ensAcceptAll: true,
                ensRejectAll: false,
                ensOpenModal: true,
                ensCloseBanner: false,
            },
            consentModalConfig: {
                ensConsentAcceptAll: true,
                ensConsentRejectAll: true,
                ensSaveModal: false,
                ensCloseModal: true,
            },
        });
    });

    it('drops environment.json fields that are not part of the public configuration', () => {
        const configuration = toEnforceConfiguration(REMOTE) as unknown as Record<string, unknown>;
        const translation = configuration.translation as Record<string, unknown>;

        expect(configuration).not.toHaveProperty('optVals');
        expect(configuration).not.toHaveProperty('privacyNoticeCustomConfig');
        expect(configuration).not.toHaveProperty('consentModalCustomConfig');
        expect(translation).not.toHaveProperty('consentWidgetCopy');
        expect(translation).not.toHaveProperty('tcf2Modal');
        expect(translation).not.toHaveProperty('tcf2Shared');
    });

    it('shares no objects with the remote config', () => {
        const configuration = toEnforceConfiguration(REMOTE);

        expect(configuration.translation).not.toBe(REMOTE.translation);
        expect(configuration.translation.cookies).not.toBe(REMOTE.translation.cookies);
        expect(configuration.translation.cookies!.Analytics).not.toBe(
            REMOTE.translation.cookies.Analytics
        );
    });
});
