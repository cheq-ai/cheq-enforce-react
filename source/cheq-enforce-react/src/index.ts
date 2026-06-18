// Core singleton
export { Enforce } from "./Enforce";

// React component API
export { EnforceProvider } from "./EnforceProvider";
export type { EnforceProviderProps } from "./EnforceProvider";

// Hook
export { useConsent } from "./useConsent";
export type { UseConsentResult } from "./useConsent";

// Presentational components (for custom UIs)
export { ConsentBanner } from "./ConsentBanner";
export type { ConsentBannerProps } from "./ConsentBanner";
export { ConsentModal } from "./ConsentModal";
export type { ConsentModalProps } from "./ConsentModal";

// Types
export type {
    EnforceConfig,
    RemoteConfig,
    Translation,
    BannerConfig,
    ConsentModalConfig,
    BannerConfigItem,
    CookieDetails,
    ConsentData,
    EnforceErrorKind,
} from "./Types";
export { EnforceError } from "./Types";
