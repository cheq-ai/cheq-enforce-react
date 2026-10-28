/**
 * Enforce — core consent management singleton.
 *
 * Handles configuration, remote config fetching, consent storage/validation,
 * and orchestration of the banner/modal lifecycle via callbacks registered
 * by the <EnforceProvider> React component.
 */

import type { ConsentData, EnforceConfig, EnforceConfiguration, RemoteConfig } from "./Types";
import { clearReportedFlags, sendReportingBeacon } from "./ConsentReporting";
import { sendError } from "./ErrorReporting";
import { EnforceError } from "./Types";
import {
    loadConsent,
    saveConsent,
    clearConsent,
    loadEnvironmentOverride,
    saveEnvironmentOverride,
    clearEnvironmentOverride,
} from "./Storage";
import { fetchRemoteConfig } from "./api";
import { configurePlatform } from "./configurePlatform";
import { log, warn } from "./logger";
import { parseThemeInput, resolveTheme, type ParsedTheme } from "./ThemeResolver";
import { toEnforceConfiguration } from "./PublicConfiguration";
import type { ResolvedTheme } from "./ThemeTypes";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _config: EnforceConfig | null = null;
// The last remote config fetched. Drives the consent UI and beacons, which
// keep using it until a replacement is adopted.
let _remoteConfig: RemoteConfig | null = null;
// The environment _remoteConfig was fetched for. getConfiguration() serves it
// only while this matches the effective environment.
let _remoteConfigEnvironment: string | null = null;
let _resolvedTheme: ResolvedTheme | null = null;
let _environmentChangeRequestId = 0;
// Incremented by each configure() so a superseded call stops applying state.
let _configureGeneration = 0;
// The environment passed to configure(), so resetEnvironment() can revert to
// it. _config.environment always holds the *effective* environment.
let _configuredEnvironment: string | null = null;
// The configured environment's remote config, kept so resetEnvironment() can
// restore it without a refetch.
let _configuredRemoteConfig: RemoteConfig | null = null;
// True when configure() was handled by the platform layer (web), where the
// SDK never fetches the remote config or renders the consent UI.
let _handledByPlatform = false;

// Callbacks registered by <EnforceProvider>
let _onShowBanner: (() => void) | null = null;
let _onHideBanner: (() => void) | null = null;
let _onShowModal: (() => void) | null = null;
let _onHideModal: (() => void) | null = null;
let _onRemoteConfigLoaded: ((rc: RemoteConfig) => void) | null = null;
let _consentChangeListeners: Array<() => void> = [];
let _consentHandlers: Array<(consent: Record<string, boolean>) => void> = [];
// In-memory fallback set when remote config fetch fails and defaultConsent is provided.
// Never persisted; cleared on each configure() call.
let _fallbackConsent: Record<string, boolean> | null = null;
// Serializes concurrent _setConsent calls so read-modify-write is always atomic.
let _writeQueue: Promise<void> = Promise.resolve();

type LegacyConsentData = {
    categories?: unknown;
    expiresAt?: unknown;
    version?: unknown;
};

type ConsentValidationResult =
    | { valid: true;  reason: string; consentData: ConsentData }
    | { valid: false; reason: string; consentData: ConsentData | null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireConfig(): EnforceConfig {
    if (!_config) throw EnforceError.notConfigured();
    return _config;
}

/** Fallback retention period (ms) when the config does not set one: 1 year. */
const DEFAULT_DATA_RETENTION_PERIOD = 31_536_000_000;

function dataRetentionPeriod(config: EnforceConfig): number {
    return config.dataRetentionPeriod ?? DEFAULT_DATA_RETENTION_PERIOD;
}

/**
 * Return the persisted environment override if one exists and has not
 * expired. An expired override is deleted at read time (lazy expiry).
 */
async function getValidEnvironmentOverride(config: EnforceConfig): Promise<string | null> {
    const override = await loadEnvironmentOverride();
    if (!override) return null;

    if (now() >= override.expiresAt) {
        try {
            await clearEnvironmentOverride();
        } catch (error) {
            // The override is expired either way, so a failed cleanup must not
            // stop configure(); the next read retries it.
            warn(config.debug, "failed to clear expired environment override", error);
            void sendError({
                msg: error instanceof Error ? error.message : String(error),
                fn: "Enforce.getValidEnvironmentOverride.clearExpired",
                config,
                clientId: _remoteConfig?.clientId,
            });
        }
        return null;
    }
    return override.environment;
}

/**
 * Persist an environment override for future launches. Its expiry snapshots
 * the stored consent record's expiry when one exists (the override must not
 * outlive the consent period it was set under), otherwise the configured
 * retention period — an override must never outlive the retention policy.
 *
 * Skipped when a newer environment change (setEnvironment, resetEnvironment
 * or configure) started after `requestId` was taken. The check runs after the
 * consent read and right before the write, with no await in between: a reset
 * bumps the request id before issuing its clear, so the clear cannot be
 * followed by this write.
 *
 * Native only: setEnvironment() returns earlier on web.
 */
async function persistEnvironmentOverride(
    environment: string,
    config: EnforceConfig,
    requestId: number
): Promise<void> {
    try {
        const stored = normalizeStoredConsent(await loadConsent());
        if (requestId !== _environmentChangeRequestId) return;
        const expiresAt = stored
            ? stored.savedAt + stored.dataRetentionPeriod
            : now() + dataRetentionPeriod(config);
        await saveEnvironmentOverride(environment, expiresAt);
    } catch (error) {
        // The session switch already succeeded; failing to persist must not
        // reject the setEnvironment call.
        warn(config.debug, "failed to persist environment override", error);
        void sendError({
            msg: error instanceof Error ? error.message : String(error),
            fn: "Enforce.setEnvironment.persistOverride",
            config,
            clientId: _remoteConfig?.clientId,
        });
    }
}

function now(): number {
    return Date.now();
}

function hasValidCategories(categories: unknown): categories is Record<string, boolean> {
    return (
        !!categories &&
        typeof categories === "object" &&
        !Array.isArray(categories) &&
        Object.values(categories).every((value) => typeof value === "boolean")
    );
}

function normalizeStoredConsent(data: unknown): ConsentData | null {
    if (!data || typeof data !== "object") {
        return null;
    }

    const candidate = data as Partial<ConsentData> & LegacyConsentData;

    if (!hasValidCategories(candidate.categories)) {
        return null;
    }

    if (
        typeof candidate.savedAt === "number" &&
        Number.isFinite(candidate.savedAt) &&
        typeof candidate.dataRetentionPeriod === "number" &&
        Number.isFinite(candidate.dataRetentionPeriod) &&
        candidate.dataRetentionPeriod >= 0 &&
        typeof candidate.version === "string"
    ) {
        return {
            categories: candidate.categories,
            savedAt: candidate.savedAt,
            dataRetentionPeriod: candidate.dataRetentionPeriod,
            version: candidate.version,
        };
    }

    // Migration path for older persisted consent that stored expiresAt instead
    // of savedAt + dataRetentionPeriod.
    if (
        hasValidCategories(candidate.categories) &&
        typeof candidate.expiresAt === "number" &&
        Number.isFinite(candidate.expiresAt) &&
        typeof candidate.version === "string"
    ) {
        // One clock read, so savedAt + dataRetentionPeriod equals expiresAt exactly.
        const currentTime = now();
        if (candidate.expiresAt <= currentTime) {
            return null;
        }

        return {
            categories: candidate.categories,
            savedAt: currentTime,
            dataRetentionPeriod: candidate.expiresAt - currentTime,
            version: candidate.version,
        };
    }

    return null;
}

/** True for a stored record in the older format (expiresAt, no savedAt). */
function isLegacyConsent(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    const candidate = data as Partial<ConsentData> & LegacyConsentData;
    return typeof candidate.expiresAt === "number" && typeof candidate.savedAt !== "number";
}

function validateConsentData(
    data: unknown,
    config: EnforceConfig
): ConsentValidationResult {
    const normalized = normalizeStoredConsent(data);

    if (!normalized) {
        return {
            valid: false,
            reason: "stored consent is missing required metadata or categories",
            consentData: null,
        };
    }

    if (now() > normalized.savedAt + normalized.dataRetentionPeriod) {
        return {
            valid: false,
            reason: "stored consent has expired",
            consentData: normalized,
        };
    }

    if ((config.version ?? "1") !== normalized.version) {
        return {
            valid: false,
            reason: `stored consent version "${normalized.version}" does not match current version "${config.version ?? "1"}"`,
            consentData: normalized,
        };
    }

    return {
        valid: true,
        reason: "stored consent is valid",
        consentData: normalized,
    };
}

function buildConsentData(
    categories: Record<string, boolean>,
    config: EnforceConfig
): ConsentData {
    return {
        categories,
        savedAt: now(),
        dataRetentionPeriod: dataRetentionPeriod(config),
        version: config.version ?? "1",
    };
}

function filterConsentCategories(
    categories: Record<string, boolean>,
    selection?: string | string[]
): Record<string, boolean> {
    if (selection === undefined) {
        return { ...categories };
    }

    if (!Array.isArray(selection)) {
        return {
            [selection]: categories[selection] ?? false,
        };
    }

    return Object.fromEntries(
        selection
            .map((key) => [key, categories[key] ?? false])
    );
}

function shouldShowBanner(remoteConfig: RemoteConfig | null): boolean {
    return remoteConfig?.enablePrivacyNotice === true;
}

function shouldShowModal(remoteConfig: RemoteConfig | null): boolean {
    return remoteConfig?.enableConsentModal === true;
}

function hasBannerConfig(remoteConfig: RemoteConfig | null): boolean {
    return !!remoteConfig?.bannerConfig;
}

function hasModalConfig(remoteConfig: RemoteConfig | null): boolean {
    return !!remoteConfig?.consentModalConfig;
}

function notifyConsentHandlers(
    consent: Record<string, boolean>,
    debug: boolean | undefined
): void {
    for (const handler of _consentHandlers) {
        try {
            handler({ ...consent });
        } catch (error) {
            warn(debug, "onConsent handler failed", error);
        }
    }
}

function notifyConsentChangeListeners(): void {
    for (const fn of _consentChangeListeners) {
        try {
            fn();
        } catch {
            // listeners are internal (useConsent); swallow to avoid cascading failures
        }
    }
}

/**
 * Adopt a fetched remote config only while `environment` is still the
 * effective one; a config for a superseded environment is discarded.
 */
function adoptRemoteConfig(rc: RemoteConfig, environment: string): boolean {
    if (_config?.environment !== environment) {
        log(_config?.debug, `discarding remote config for "${environment}": no longer the effective environment`);
        return false;
    }
    _remoteConfig = rc;
    _remoteConfigEnvironment = environment;
    if (environment === _configuredEnvironment) {
        _configuredRemoteConfig = rc;
    }
    _onRemoteConfigLoaded?.(rc);
    return true;
}

/**
 * Re-fetch the remote config for the current effective environment so a
 * manually shown banner/modal presents the latest translations and button
 * configuration. Failures fall back to the cached config — a refresh must
 * never prevent the consent UI from showing. No-op before configure() and on
 * web (where the SDK never fetches the remote config).
 */
async function refreshRemoteConfig(): Promise<void> {
    const config = _config;
    if (!config || _handledByPlatform) return;

    const requestId = _environmentChangeRequestId;

    try {
        const rc = await fetchRemoteConfig(config);

        // Discard stale results if the environment changed mid-flight, or if
        // the active config was replaced while this fetch was pending (a
        // concurrent setEnvironment/resetEnvironment/configure committed).
        if (requestId !== _environmentChangeRequestId || _config !== config) return;

        adoptRemoteConfig(rc, config.environment);
    } catch (error) {
        warn(config.debug, "remote config refresh failed — using cached config", error);
        void sendError({
            msg: error instanceof Error ? error.message : String(error),
            fn: "Enforce.refreshRemoteConfig",
            config,
            clientId: _remoteConfig?.clientId,
        });
    }
}

function _showUIComponent(
    label: 'Banner' | 'Modal',
    shouldShow: (rc: RemoteConfig | null) => boolean,
    hasConfig: (rc: RemoteConfig | null) => boolean,
    presenter: (() => void) | null,
): void {
    const config = _config;

    if (!shouldShow(_remoteConfig)) {
        log(config?.debug, `${label} not turned on. Skipping showing ${label.toLowerCase()}.`);
        return;
    }

    if (!hasConfig(_remoteConfig)) {
        warn(config?.debug, `${label} is enabled but ${label.toLowerCase()} config is missing.`);
        if (config) {
            void sendError({
                msg: `${label} is enabled but ${label.toLowerCase()} config is missing.`,
                fn: `Enforce.show${label}`,
                config,
                clientId: _remoteConfig?.clientId,
            });
        }
        return;
    }

    if (!presenter) {
        warn(config?.debug, `${label} presenter is unavailable. Skipping showing ${label.toLowerCase()}.`);
        if (config) {
            void sendError({
                msg: `${label} presenter is unavailable.`,
                fn: `Enforce.show${label}.presenter`,
                config,
                clientId: _remoteConfig?.clientId,
            });
        }
        return;
    }

    presenter();
}

function presentBanner(): void {
    _showUIComponent('Banner', shouldShowBanner, hasBannerConfig, _onShowBanner);
}

function presentModal(): void {
    _showUIComponent('Modal', shouldShowModal, hasModalConfig, _onShowModal);
}

// ---------------------------------------------------------------------------
// Public singleton
// ---------------------------------------------------------------------------

export const Enforce = {
    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------

    /**
     * Register UI callbacks from <EnforceProvider>.
     * Called internally — not part of the public consumer API.
     * Returns an unregister function, which only clears the callbacks if they
     * have not since been replaced by another registration.
     */
    _registerCallbacks(callbacks: {
        showBanner: () => void;
        hideBanner: () => void;
        showModal: () => void;
        hideModal: () => void;
        onRemoteConfigLoaded: (rc: RemoteConfig) => void;
    }): () => void {
        _onShowBanner = callbacks.showBanner;
        _onHideBanner = callbacks.hideBanner;
        _onShowModal = callbacks.showModal;
        _onHideModal = callbacks.hideModal;
        _onRemoteConfigLoaded = callbacks.onRemoteConfigLoaded;

        return () => {
            if (_onShowBanner !== callbacks.showBanner) return;
            _onShowBanner = null;
            _onHideBanner = null;
            _onShowModal = null;
            _onHideModal = null;
            _onRemoteConfigLoaded = null;
        };
    },

    // -----------------------------------------------------------------------
    // Configuration & initialisation
    // -----------------------------------------------------------------------

    /**
     * Configure the SDK and kick off the initialisation flow:
     *  1. Delegate to the platform layer (native); returns early if handled
     *  2. Load and validate any stored consent (needed for the billing beacon
     *     and the remote-config fetch-failure path)
     *  3. Fetch remote config
     *  4. Auto-show the banner/modal if no valid consent exists (and autoShow ≠ false)
     */
    async configure(config: EnforceConfig): Promise<void> {
        log(config.debug, "configure()", config);

        // Structurally validate the theme before any side effects so a
        // malformed theme document fails fast on every platform, leaving the
        // current configuration and any in-flight calls untouched.
        let parsedTheme: ParsedTheme | undefined;
        if (config.theme !== undefined) {
            parsedTheme = parseThemeInput(config.theme);
        }

        const configureStartTimestamp = now();
        _fallbackConsent = null;
        _resolvedTheme = null;
        // Invalidate in-flight setEnvironment/refresh completions from a
        // previous configuration so they cannot overwrite this one.
        ++_environmentChangeRequestId;
        const generation = ++_configureGeneration;
        // A newer configure() started while this one was awaiting: it owns
        // the SDK state from here, so this call must stop applying any.
        const isSuperseded = () => generation !== _configureGeneration;

        const handledByPlatform = await configurePlatform(config);
        if (isSuperseded()) return;
        _handledByPlatform = handledByPlatform;
        _configuredRemoteConfig = null;
        if (handledByPlatform) {
            if (parsedTheme) {
                log(config.debug, "theme is ignored on web: the consent UI is not rendered by this SDK");
            }
            _config = config;
            _configuredEnvironment = config.environment;
            _remoteConfig = null;
            _remoteConfigEnvironment = null;
            return;
        }

        // Set config before the fetch so consent helpers are usable on failure.
        _config = config;
        _configuredEnvironment = config.environment;

        // Apply a persisted environment override from a previous
        // setEnvironment(). Everything downstream uses the effective value.
        const environmentOverride = await getValidEnvironmentOverride(config);
        if (isSuperseded()) return;
        if (environmentOverride && environmentOverride !== config.environment) {
            log(config.debug, "applying persisted environment override", environmentOverride);
            config = { ...config, environment: environmentOverride };
            _config = config;
        }

        if (parsedTheme) {
            _resolvedTheme = resolveTheme(parsedTheme, (msg) => warn(config.debug, msg));
        }

        // Load and validate stored consent before the fetch so it is available
        // for the billing beacon's cookie flags and for the fetch-failure path.
        const stored = await this._loadStoredConsent();
        if (isSuperseded()) return;
        const validation = stored
            ? validateConsentData(stored, config)
            : { valid: false, reason: "no stored consent found", consentData: null };

        // Stored consent that is no longer valid (expired or version mismatch)
        // is removed together with its reported flags, so beacons start clean.
        if (stored && !validation.valid) {
            await clearReportedFlags();
            await clearConsent();
            if (isSuperseded()) return;
        }

        // Rewrite valid older-format consent in the current format, so later
        // reads stop re-deriving it.
        if (validation.valid && validation.consentData && isLegacyConsent(stored)) {
            try {
                await saveConsent(validation.consentData);
            } catch (error) {
                warn(config.debug, "failed to migrate stored consent to the current format", error);
            }
            if (isSuperseded()) return;
        }

        // Fetch remote config
        try {
            const rc = await fetchRemoteConfig(config);
            if (isSuperseded()) return;
            adoptRemoteConfig(rc, config.environment);
            await sendReportingBeacon({
                config,
                remoteConfig: rc,
                type: "billing",
                requestTimestamp: configureStartTimestamp,
                cookieFlags: validation.valid && validation.consentData ? validation.consentData.categories : undefined,
            });
        } catch (e) {
            if (isSuperseded()) return;
            log(config.debug, "remote config fetch failed", e);
            void sendError({
                msg: e instanceof Error ? e.message : String(e),
                fn: "Enforce.configure.fetchRemoteConfig",
                config,
                clientId: _remoteConfig?.clientId,
            });

            // A stale remote config from a previous configure() must not
            // masquerade as this configuration (e.g. via getConfiguration()).
            _remoteConfig = null;
            _remoteConfigEnvironment = null;

            // Remote translations are unavailable — never show UI.
            // Notify onConsent handlers with whatever consent is available.
            if (validation.valid && validation.consentData) {
                log(config.debug, "remote config failed — notifying handlers with stored consent");
                notifyConsentHandlers(validation.consentData.categories, config.debug);
                notifyConsentChangeListeners();
                return;
            }

            if (config.defaultConsent) {
                log(config.debug, "remote config failed — notifying handlers with config.defaultConsent");
                _fallbackConsent = config.defaultConsent;
                notifyConsentHandlers(config.defaultConsent, config.debug);
                notifyConsentChangeListeners();
                return;
            }

            log(config.debug, "remote config failed — no consent available");
            return;
        }

        if (isSuperseded()) return;

        log(config.debug, "stored consent validation", {
            reason: validation.reason,
            stored,
            normalized: validation.consentData,
        });

        if (validation.valid && validation.consentData) {
            log(config.debug, "valid stored consent found — skipping initial UI");
            notifyConsentHandlers(validation.consentData.categories, config.debug);
            notifyConsentChangeListeners();
            return;
        }

        if (config.autoShow === false) {
            log(config.debug, "autoShow disabled — skipping initial UI");
            return;
        }

        if (shouldShowBanner(_remoteConfig)) {
            if (!hasBannerConfig(_remoteConfig)) {
                warn(config.debug, "Privacy notice is enabled but banner config is missing.");
                void sendError({
                    msg: "Privacy notice is enabled but banner config is missing.",
                    fn: "Enforce.configure.showBanner",
                    config,
                    clientId: _remoteConfig?.clientId,
                });
                return;
            }

            log(config.debug, "no valid consent — showing banner");
            // Present directly — the remote config was fetched moments ago,
            // so the showBanner() refresh would be a redundant second fetch.
            presentBanner();
            return;
        }

        if (shouldShowModal(_remoteConfig)) {
            if (!hasModalConfig(_remoteConfig)) {
                warn(config.debug, "Consent modal is enabled but modal config is missing.");
                void sendError({
                    msg: "Consent modal is enabled but modal config is missing.",
                    fn: "Enforce.configure.showModal",
                    config,
                    clientId: _remoteConfig?.clientId,
                });
                return;
            }

            log(config.debug, "no valid consent — showing modal");
            presentModal();
            return;
        }

        warn(
            config.debug,
            "No valid consent found, but neither privacy notice nor consent modal is enabled."
        );
        void sendError({
            msg: "No valid consent found, but neither privacy notice nor consent modal is enabled.",
            fn: "Enforce.configure.initialUiDecision",
            config,
            clientId: _remoteConfig?.clientId,
        });
    },

    /**
     * Change the active environment only after the corresponding remote config
     * has been fetched and validated successfully.
     *
     * On web the environment is validated and returned, but nothing is
     * applied or persisted.
     */
    async setEnvironment(environment: string): Promise<RemoteConfig> {
        const currentConfig = requireConfig();
        const nextEnvironment = environment.trim();

        if (!nextEnvironment) {
            void sendError({
                msg: "environment is required.",
                fn: "Enforce.setEnvironment.validate",
                config: currentConfig,
                clientId: _remoteConfig?.clientId,
            });
            throw EnforceError.invalidEnvironment("environment is required.");
        }

        const nextConfig: EnforceConfig = {
            ...currentConfig,
            environment: nextEnvironment,
        };
        const requestId = ++_environmentChangeRequestId;

        log(currentConfig.debug, "setEnvironment() validating", nextEnvironment);

        let stale = false;
        try {
            const nextRemoteConfig = await fetchRemoteConfig(nextConfig);

            // Ignore stale completions so older requests cannot overwrite newer ones.
            if (requestId !== _environmentChangeRequestId) {
                stale = true;
                throw EnforceError.invalidConfig(
                    `Ignoring stale environment change for "${nextEnvironment}".`
                );
            }

            _config = nextConfig;

            // On web the consent UI is platform-managed, so the fetched config
            // is returned to the caller but never published to the SDK.
            if (_handledByPlatform) {
                log(
                    currentConfig.debug,
                    "setEnvironment() validated but not applied on web: the consent UI is not rendered by this SDK",
                    nextEnvironment
                );
                return nextRemoteConfig;
            }

            adoptRemoteConfig(nextRemoteConfig, nextEnvironment);

            // Persist the override so future launches use this environment
            // until it expires or resetEnvironment() is called. The write is
            // skipped if a newer environment change starts before it lands.
            await persistEnvironmentOverride(nextEnvironment, currentConfig, requestId);

            log(currentConfig.debug, "setEnvironment() committed", nextEnvironment);

            return nextRemoteConfig;
        } catch (error) {
            // Preserve the previous config/remote config on any failure.
            log(currentConfig.debug, "setEnvironment() failed", nextEnvironment, error);
            // A stale completion is expected control flow, not an error.
            if (!stale) {
                void sendError({
                    msg: error instanceof Error ? error.message : String(error),
                    fn: "Enforce.setEnvironment.fetchRemoteConfig",
                    config: nextConfig,
                    clientId: _remoteConfig?.clientId,
                });
            }
            throw error;
        }
    },

    /**
     * The effective environment: an active setEnvironment() override if one
     * exists, otherwise the environment passed to configure(). Returns null
     * before configure() has run.
     */
    getEnvironment(): string | null {
        return _config?.environment ?? null;
    },

    /**
     * Discard the persisted environment override and revert to the
     * environment supplied to configure(), for this session and future
     * launches.
     *
     * The configured environment's remote config is restored from the copy
     * kept at configure() time. When there is none (the app launched with an
     * override applied), it is refetched in the background; until that lands
     * getConfiguration() returns null, while the consent UI and beacons
     * keep using the previous config. Calling this again retries a failed
     * refetch.
     */
    async resetEnvironment(): Promise<void> {
        const config = requireConfig();

        // Invalidate any in-flight setEnvironment so a stale completion
        // cannot overwrite the reset.
        ++_environmentChangeRequestId;

        await clearEnvironmentOverride();

        // Re-read after the await: a configure() may have replaced the config.
        let current = requireConfig();
        if (_configuredEnvironment && current.environment !== _configuredEnvironment) {
            current = _config = { ...current, environment: _configuredEnvironment };
        }

        log(config.debug, "resetEnvironment()", _configuredEnvironment);

        const environment = current.environment;
        if (_remoteConfigEnvironment === environment) return;

        if (_configuredRemoteConfig) {
            adoptRemoteConfig(_configuredRemoteConfig, environment);
            return;
        }

        void refreshRemoteConfig();
    },

    // -----------------------------------------------------------------------
    // Consent read/write
    // -----------------------------------------------------------------------

    /**
     * Load and return stored consent if it exists, without validation.
     * Returns null if nothing is stored.
     */
    async _loadStoredConsent(): Promise<ConsentData | null> {
        return loadConsent();
    },

    /**
     * Returns stored consent categories.
     * With no selection it returns the full consent map.
     * With a string or string[] it returns only matching categories.
     * A missing single category yields { [category]: false } as a safe fallback.
     * A missing category in a string[] also yields false for that key.
     */
    async getConsent(
        selection?: string | string[]
    ): Promise<Record<string, boolean>> {
        const config = requireConfig();
        const stored = await this._loadStoredConsent();
        const validation = stored
            ? validateConsentData(stored, config)
            : { valid: false, reason: "no stored consent found", consentData: null };

        if (!validation.valid || !validation.consentData) {
            if (_fallbackConsent) {
                log(config.debug, "getConsent() returning fallback defaultConsent");
                return filterConsentCategories(_fallbackConsent, selection);
            }
            log(config.debug, "getConsent() no valid consent — returning empty", { reason: validation.reason });
            return {};
        }

        return filterConsentCategories(validation.consentData.categories, selection);
    },

    /**
     * Returns `true` if the given category has been consented to.
     * Returns `false` if consent is absent, expired, or the category is not found.
     */
    async checkConsent(category: string): Promise<boolean> {
        const categories = await this.getConsent(category);
        return categories[category] === true;
    },

    /**
     * Programmatically set consent for one or more categories.
     * Merges with any existing stored categories.
     */
    async setConsent(categories: Record<string, boolean>): Promise<void> {
        await this._setConsent(categories);
    },

    async _setConsent(
        categories: Record<string, boolean>,
        beaconExtras?: Record<string, boolean>
    ): Promise<void> {
        const next = _writeQueue.then(async () => {
            const config = requireConfig();
            const existing = await this._loadStoredConsent();
            const existingValidation = existing ? validateConsentData(existing, config) : null;
            const base = existingValidation?.valid ? existing!.categories : {};
            const merged = { ...base, ...categories };
            const data = buildConsentData(merged, config);

            await saveConsent(data);

            // The environment override's lifetime always tracks the latest
            // consent period. An already-expired override must not be
            // revived, so only a still-valid one is re-aligned.
            //
            // Only the override the session is running on is re-aligned, and
            // only if no environment change started meanwhile. Checked with no
            // await before the write: setEnvironment() switches _config before
            // persisting, so a re-align holding an older override cannot write
            // it over a newer one, and a reset cannot be undone either.
            try {
                const requestId = _environmentChangeRequestId;
                const overrideEnvironment = await getValidEnvironmentOverride(config);
                if (
                    overrideEnvironment &&
                    overrideEnvironment === _config?.environment &&
                    requestId === _environmentChangeRequestId
                ) {
                    await saveEnvironmentOverride(
                        overrideEnvironment,
                        data.savedAt + data.dataRetentionPeriod
                    );
                }
            } catch (error) {
                warn(config.debug, "failed to re-align environment override expiry", error);
            }

            log(config.debug, "setConsent()", merged);
            await sendReportingBeacon({
                config,
                remoteConfig: _remoteConfig,
                type: "consent",
                cookieFlags: merged,
                eventFlags: beaconExtras,
            });
            notifyConsentHandlers(merged, config.debug);
            notifyConsentChangeListeners();
            this._hideBanner();
            this._hideModal();
        });
        // Keep the queue moving even if this call throws; caller still sees the error.
        _writeQueue = next.catch(() => { /* absorb to unblock queue */ });
        await next;
    },

    /**
     * Register a callback invoked with the latest full consent map whenever
     * consent changes: on startup if stored consent is valid, after each
     * setConsent(), and after clearConsent() (called with an empty object {}).
     * Returns an unsubscribe function.
     */
    onConsent(handler: (consent: Record<string, boolean>) => void): () => void {
        _consentHandlers.push(handler);
        return () => {
            _consentHandlers = _consentHandlers.filter(h => h !== handler);
        };
    },

    /**
     * Apply defaultConsent from the config (used when user closes without choosing).
     * If valid consent already exists, the close is treated as a dismissal only —
     * existing consent is preserved and no beacon is sent.
     */
    async _applyDefault(
        beaconExtras?: Record<string, boolean>
    ): Promise<void> {
        const config = requireConfig();
        const stored = await this._loadStoredConsent();
        const validation = stored ? validateConsentData(stored, config) : null;
        const hasValidConsent = validation?.valid === true;

        if (!hasValidConsent && config.defaultConsent) {
            await this._setConsent(config.defaultConsent, beaconExtras);
        }
        this._hideBanner();
        this._hideModal();
    },

    /** Clear all stored consent. */
    async clearConsent(): Promise<void> {
        _fallbackConsent = null;
        await clearConsent();
        await clearReportedFlags();
        notifyConsentHandlers({}, _config?.debug);
        notifyConsentChangeListeners();
        this._hideBanner();
        this._hideModal();
    },

    // -----------------------------------------------------------------------
    // Banner / modal control
    // -----------------------------------------------------------------------

    async showBanner(): Promise<void> {
        await refreshRemoteConfig();
        presentBanner();
    },

    _hideBanner(): void {
        _onHideBanner?.();
    },

    async showModal(): Promise<void> {
        await refreshRemoteConfig();
        presentModal();
    },

    _hideModal(): void {
        _onHideModal?.();
    },

    // -----------------------------------------------------------------------
    // Accessors
    // -----------------------------------------------------------------------

    /**
     * The public configuration retrieved from the remote environment.json —
     * clientId, version, enforcement, the enable flags, translations, and
     * the banner/modal button configuration — for customers implementing
     * their own consent experience.
     *
     * Returns `null` when the remote configuration is unavailable:
     * before `configure()` has completed, when the remote fetch failed,
     * after a `resetEnvironment()` whose refetch has not yet succeeded, or on
     * web (where the consent UI is not rendered by this SDK). It never
     * returns another environment's configuration.
     *
     * Only the public fields are returned, and each button entry is a
     * boolean. The result is a copy, so changing it
     * does not affect the SDK.
     */
    getConfiguration(): EnforceConfiguration | null {
        if (!_remoteConfig || _remoteConfigEnvironment !== _config?.environment) {
            return null;
        }
        return toEnforceConfiguration(_remoteConfig);
    },

    _getRemoteConfig(): RemoteConfig | null {
        return _remoteConfig;
    },

    _getResolvedTheme(): ResolvedTheme | null {
        return _resolvedTheme;
    },

    _isConfigured(): boolean {
        return _config !== null;
    },

    _getConfig(): EnforceConfig | null {
        return _config ? { ..._config } : null;
    },

    _addConsentChangeListener(fn: () => void): () => void {
        _consentChangeListeners.push(fn);
        return () => {
            _consentChangeListeners = _consentChangeListeners.filter(f => f !== fn);
        };
    },
};
