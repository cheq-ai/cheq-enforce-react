import type { EnforceTheme } from "./ThemeTypes";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface EnforceConfig {
    /** Client identifier (e.g. "ens-cparfitt") */
    clientName: string;
    /** Publication path in the Ensighten API (e.g. "stage") */
    publishPath: string;
    /** Environment label (e.g. "Ensighten Website English") */
    environment: string;
    /** Enable verbose debug logging. Default: false */
    debug?: boolean;
    /**
     * How long (ms) stored consent is considered valid before re-prompting.
     * Default: 31 536 000 000 (1 year)
     */
    dataRetentionPeriod?: number;
    /**
     * Automatically show the banner on configure() if no valid consent is
     * stored. Default: true
     */
    autoShow?: boolean;
    /**
     * Opaque string used for cache-busting: if the stored consent was saved
     * under a different version the stored data is discarded and the banner
     * is shown again.
     */
    version?: string;
    /**
     * Consent values to apply when the user dismisses the banner without
     * making an explicit choice (e.g. close / dismiss).
     */
    defaultConsent?: Record<string, boolean>;
    /**
     * Optional custom theme for the consent UI (banner and modal). Accepts a
     * theme object or a required JSON file (e.g.
     * `require("./enforce_theme.json")`). Native only — the web consent UI is
     * not rendered by this SDK. When omitted or empty, the UI renders with
     * its default appearance.
     */
    theme?: EnforceTheme;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface CookieDetails {
    title: string;
    description: string;
}

export interface Translation {
    notificationBannerContent: string;
    notificationBannerAllowAll: string;
    notificationBannerDenyAll: string;
    notificationBannerPreferences: string;
    consentTitle: string;
    consentDescription: string;
    consentModalAllowAll: string;
    consentModalDenyAll: string;
    save: string;
    cancel: string;
    close: string;
    cookies: Record<string, CookieDetails>;
}

export interface BannerConfigItem {
    show: boolean;
}

export interface BannerConfig {
    ensAcceptAll: BannerConfigItem;
    ensRejectAll: BannerConfigItem;
    ensOpenModal: BannerConfigItem;
    ensCloseBanner: BannerConfigItem;
}

export interface ConsentModalConfig {
    ensConsentAcceptAll: BannerConfigItem;
    ensConsentRejectAll: BannerConfigItem;
    ensSaveModal: BannerConfigItem;
    ensCloseModal: BannerConfigItem;
}

export interface RemoteConfig {
    clientId?: string;
    version?: string;
    enforcement?: boolean;
    enablePrivacyNotice?: boolean;
    enableConsentModal?: boolean;
    translation: Translation;
    bannerConfig: BannerConfig;
    consentModalConfig: ConsentModalConfig;
}

// ---------------------------------------------------------------------------
// Public configuration (returned by `Enforce.getConfiguration()`)
//
// Public mirrors of the remote-JSON models above, so the SDK's wire format is
// not frozen as public API.
// Only the fields below are exposed; anything else in environment.json is
// dropped. Keep toEnforceConfiguration() in sync when a field is added.
// ---------------------------------------------------------------------------

/**
 * The consent configuration fetched from the remote `environment.json`,
 * exposed so a customer can implement their own consent experience.
 */
export interface EnforceConfiguration {
    clientId?: string;
    version?: string;
    enforcement?: boolean;
    enablePrivacyNotice?: boolean;
    enableConsentModal?: boolean;
    translation: EnforceTranslation;
    bannerConfig?: EnforceBannerConfig;
    consentModalConfig?: EnforceConsentModalConfig;
}

/** All translated strings for the banner and modal. */
export interface EnforceTranslation {
    notificationBannerContent?: string;
    notificationBannerAllowAll?: string;
    notificationBannerDenyAll?: string;
    notificationBannerPreferences?: string;
    consentTitle?: string;
    consentDescription?: string;
    consentModalAllowAll?: string;
    consentModalDenyAll?: string;
    save?: string;
    cancel?: string;
    close?: string;
    cookies?: Record<string, EnforceCookieDetails>;
}

/** Title and description for one cookie category. */
export interface EnforceCookieDetails {
    title?: string;
    description?: string;
}

/** Which banner buttons are enabled in the remote configuration. */
export interface EnforceBannerConfig {
    ensAcceptAll?: boolean;
    ensRejectAll?: boolean;
    ensOpenModal?: boolean;
    ensCloseBanner?: boolean;
}

/** Which consent-modal buttons are enabled in the remote configuration. */
export interface EnforceConsentModalConfig {
    ensConsentAcceptAll?: boolean;
    ensConsentRejectAll?: boolean;
    ensSaveModal?: boolean;
    ensCloseModal?: boolean;
}

// ---------------------------------------------------------------------------
// Consent storage
// ---------------------------------------------------------------------------

export interface ConsentData {
    /** Map of category name → boolean */
    categories: Record<string, boolean>;
    /** Unix timestamp (ms) when this consent record was last saved */
    savedAt: number;
    /** Retention period (ms) that was active when this consent was saved */
    dataRetentionPeriod: number;
    /** Version string at the time consent was saved */
    version: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type EnforceErrorKind =
    | "notConfigured"
    | "invalidConfig"
    | "invalidEnvironment"
    | "networkError"
    | "parseError";

export class EnforceError extends Error {
    readonly kind: EnforceErrorKind;

    constructor(message: string, kind: EnforceErrorKind) {
        super(message);
        this.name = "EnforceError";
        this.kind = kind;
    }

    static notConfigured(): EnforceError {
        return new EnforceError(
            "Enforce has not been configured. Call Enforce.configure() first.",
            "notConfigured"
        );
    }

    static invalidConfig(message: string): EnforceError {
        return new EnforceError(message, "invalidConfig");
    }

    static invalidEnvironment(message: string): EnforceError {
        return new EnforceError(message, "invalidEnvironment");
    }

    static networkError(message: string): EnforceError {
        return new EnforceError(message, "networkError");
    }

    static parseError(message: string): EnforceError {
        return new EnforceError(message, "parseError");
    }
}
