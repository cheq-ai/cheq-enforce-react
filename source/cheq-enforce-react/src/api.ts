import type { EnforceConfig, RemoteConfig } from "./Types";
import { sendError } from "./ErrorReporting";
import { EnforceError } from "./Types";
import { log } from "./logger";

const PROD_HOST = "https://nexus.ensighten.com";
const TEST_HOST = "https://nexus-test.ensighten.com";
const CONFIG_PATH = "/privacy/environments";
const CONFIG_FILE = "environment.json";

function getBaseUrl(debug: boolean | undefined): string {
    return `${debug ? TEST_HOST : PROD_HOST}${CONFIG_PATH}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isBannerConfigItem(value: unknown): boolean {
    return isRecord(value) && typeof value.show === "boolean";
}

function isCookieDetails(value: unknown): boolean {
    return (
        isRecord(value) &&
        (value.title === undefined || typeof value.title === "string") &&
        (value.description === undefined || typeof value.description === "string")
    );
}

function hasRequiredStringFields(
    value: Record<string, unknown>,
    fields: readonly string[]
): boolean {
    return fields.every((field) => typeof value[field] === "string");
}

function isTranslation(value: unknown, options?: { modalEnabled?: boolean }): boolean {
    if (!isRecord(value)) {
        return false;
    }

    const requiredStringFields = [
        "notificationBannerContent",
        "notificationBannerPreferences",
        "close",
    ] as const;

    if (!hasRequiredStringFields(value, requiredStringFields)) {
        return false;
    }

    if (options?.modalEnabled) {
        const modalRequiredFields = [
            "consentTitle",
            "consentDescription",
            "save",
            "cancel",
        ] as const;

        if (!hasRequiredStringFields(value, modalRequiredFields)) {
            return false;
        }
    }

    if (!isRecord(value.cookies)) {
        return false;
    }

    return Object.values(value.cookies).every(isCookieDetails);
}

function hasOptionalString(value: unknown, key: string): boolean {
    return isRecord(value) && (value[key] === undefined || typeof value[key] === "string");
}

function hasOptionalBoolean(value: unknown, key: string): boolean {
    return isRecord(value) && (value[key] === undefined || typeof value[key] === "boolean");
}

function normalizeRemoteConfig(remoteConfig: RemoteConfig): RemoteConfig {
    const translation = remoteConfig.translation as RemoteConfig["translation"] & {
        notificationBannerAllowAll?: string;
        notificationBannerDenyAll?: string;
        consentModalAllowAll?: string;
        consentModalDenyAll?: string;
        consentTitle?: string;
        consentDescription?: string;
        save?: string;
        cancel?: string;
        cookies?: Record<string, Partial<RemoteConfig["translation"]["cookies"][string]>>;
    };
    const normalizedCookies = Object.fromEntries(
        Object.entries(translation.cookies ?? {}).map(([key, details]) => [
            key,
            {
                title: details?.title ?? "",
                description: details?.description ?? "",
            },
        ])
    );

    return {
        ...remoteConfig,
        translation: {
            ...translation,
            notificationBannerAllowAll:
                translation.notificationBannerAllowAll ?? "Allow All",
            notificationBannerDenyAll:
                translation.notificationBannerDenyAll ?? "Deny All",
            consentModalAllowAll:
                translation.consentModalAllowAll ??
                translation.notificationBannerAllowAll ??
                "Allow All",
            consentModalDenyAll:
                translation.consentModalDenyAll ??
                translation.notificationBannerDenyAll ??
                "Deny All",
            consentTitle: translation.consentTitle ?? "",
            consentDescription: translation.consentDescription ?? "",
            save: translation.save ?? "",
            cancel: translation.cancel ?? "",
            cookies: normalizedCookies,
        },
    };
}

function isRemoteConfig(value: unknown): value is RemoteConfig {
    if (!isRecord(value)) {
        return false;
    }

    const { translation, bannerConfig, consentModalConfig, enableConsentModal } = value;
    const modalEnabled = enableConsentModal === true;

    return (
        isTranslation(translation, { modalEnabled }) &&
        hasOptionalString(translation, "notificationBannerAllowAll") &&
        hasOptionalString(translation, "notificationBannerDenyAll") &&
        hasOptionalString(translation, "consentModalAllowAll") &&
        hasOptionalString(translation, "consentModalDenyAll") &&
        hasOptionalString(value, "clientId") &&
        hasOptionalString(value, "version") &&
        hasOptionalBoolean(value, "enforcement") &&
        hasOptionalBoolean(value, "enablePrivacyNotice") &&
        hasOptionalBoolean(value, "enableConsentModal") &&
        isRecord(bannerConfig) &&
        isBannerConfigItem(bannerConfig.ensAcceptAll) &&
        isBannerConfigItem(bannerConfig.ensRejectAll) &&
        isBannerConfigItem(bannerConfig.ensOpenModal) &&
        isBannerConfigItem(bannerConfig.ensCloseBanner) &&
        isRecord(consentModalConfig) &&
        isBannerConfigItem(consentModalConfig.ensConsentAcceptAll) &&
        isBannerConfigItem(consentModalConfig.ensConsentRejectAll) &&
        isBannerConfigItem(consentModalConfig.ensSaveModal) &&
        isBannerConfigItem(consentModalConfig.ensCloseModal)
    );
}

export async function fetchRemoteConfig(config: EnforceConfig): Promise<RemoteConfig> {
    const { clientName, publishPath, environment, debug } = config;

    if (!clientName || !publishPath || !environment) {
        void sendError({
            msg: "clientName, publishPath, and environment are required.",
            fn: "fetchRemoteConfig.validateConfig",
            config,
        });
        throw EnforceError.invalidConfig(
            "clientName, publishPath, and environment are required."
        );
    }

    const url = `${getBaseUrl(debug)}/${encodeURIComponent(clientName)}/${encodeURIComponent(publishPath)}/${encodeURIComponent(environment)}/${CONFIG_FILE}`;

    log(debug, "fetchRemoteConfig →", url);

    let response: Response;
    try {
        response = await fetch(url);
    } catch (e) {
        void sendError({
            msg: `Network request failed: ${String(e)}`,
            fn: "fetchRemoteConfig.fetch",
            config,
        });
        throw EnforceError.networkError(`Network request failed: ${String(e)}`);
    }

    if (!response.ok) {
        void sendError({
            msg: `Server returned ${response.status} for config request.`,
            fn: "fetchRemoteConfig.response",
            config,
        });
        throw EnforceError.networkError(
            `Server returned ${response.status} for config request.`
        );
    }

    let json: unknown;
    try {
        json = await response.json();
    } catch (e) {
        void sendError({
            msg: `Failed to parse config response: ${String(e)}`,
            fn: "fetchRemoteConfig.parse",
            config,
        });
        throw EnforceError.parseError(`Failed to parse config response: ${String(e)}`);
    }

    log(debug, "fetchRemoteConfig ←", json);

    if (!isRemoteConfig(json)) {
        void sendError({
            msg: "Config response did not match the expected schema.",
            fn: "fetchRemoteConfig.schema",
            config,
        });
        throw EnforceError.parseError("Config response did not match the expected schema.");
    }

    return normalizeRemoteConfig(json);
}
