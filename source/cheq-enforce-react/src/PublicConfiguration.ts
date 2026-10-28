/**
 * Maps the internal remote config onto the public EnforceConfiguration
 * returned by `Enforce.getConfiguration()`: only the public fields are copied
 * (anything else in environment.json is dropped) and each `{ show }` button
 * entry is flattened to a boolean. Builds new objects throughout, so the
 * result never shares state with the SDK.
 */

import type {
    BannerConfig,
    ConsentModalConfig,
    EnforceBannerConfig,
    EnforceConfiguration,
    EnforceConsentModalConfig,
    EnforceTranslation,
    RemoteConfig,
    Translation,
} from "./Types";

function toEnforceTranslation(translation: Translation): EnforceTranslation {
    return {
        notificationBannerContent: translation.notificationBannerContent,
        notificationBannerAllowAll: translation.notificationBannerAllowAll,
        notificationBannerDenyAll: translation.notificationBannerDenyAll,
        notificationBannerPreferences: translation.notificationBannerPreferences,
        consentTitle: translation.consentTitle,
        consentDescription: translation.consentDescription,
        consentModalAllowAll: translation.consentModalAllowAll,
        consentModalDenyAll: translation.consentModalDenyAll,
        save: translation.save,
        cancel: translation.cancel,
        close: translation.close,
        cookies: Object.fromEntries(
            Object.entries(translation.cookies).map(([key, details]) => [
                key,
                { title: details.title, description: details.description },
            ])
        ),
    };
}

function toEnforceBannerConfig(config: BannerConfig): EnforceBannerConfig {
    return {
        ensAcceptAll: config.ensAcceptAll.show,
        ensRejectAll: config.ensRejectAll.show,
        ensOpenModal: config.ensOpenModal.show,
        ensCloseBanner: config.ensCloseBanner.show,
    };
}

function toEnforceConsentModalConfig(config: ConsentModalConfig): EnforceConsentModalConfig {
    return {
        ensConsentAcceptAll: config.ensConsentAcceptAll.show,
        ensConsentRejectAll: config.ensConsentRejectAll.show,
        ensSaveModal: config.ensSaveModal.show,
        ensCloseModal: config.ensCloseModal.show,
    };
}

export function toEnforceConfiguration(remoteConfig: RemoteConfig): EnforceConfiguration {
    return {
        clientId: remoteConfig.clientId,
        version: remoteConfig.version,
        enforcement: remoteConfig.enforcement,
        enablePrivacyNotice: remoteConfig.enablePrivacyNotice,
        enableConsentModal: remoteConfig.enableConsentModal,
        translation: toEnforceTranslation(remoteConfig.translation),
        bannerConfig: toEnforceBannerConfig(remoteConfig.bannerConfig),
        consentModalConfig: toEnforceConsentModalConfig(remoteConfig.consentModalConfig),
    };
}
