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

    static networkError(message: string): EnforceError {
        return new EnforceError(message, "networkError");
    }

    static parseError(message: string): EnforceError {
        return new EnforceError(message, "parseError");
    }
}
