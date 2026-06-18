/**
 * Enforce — core consent management singleton.
 *
 * Handles configuration, remote config fetching, consent storage/validation,
 * and orchestration of the banner/modal lifecycle via callbacks registered
 * by the <EnforceProvider> React component.
 */

import type { ConsentData, EnforceConfig, RemoteConfig } from "./Types";
import { sendReportingBeacon } from "./ConsentReporting";
import { sendError } from "./ErrorReporting";
import { EnforceError } from "./Types";
import { loadConsent, saveConsent, clearConsent } from "./Storage";
import { fetchRemoteConfig } from "./api";
import { configurePlatform } from "./configurePlatform";
import { log, warn } from "./logger";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _config: EnforceConfig | null = null;
let _remoteConfig: RemoteConfig | null = null;
let _environmentChangeRequestId = 0;

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
        if (candidate.expiresAt <= now()) {
            return null;
        }

        return {
            categories: candidate.categories,
            savedAt: now(),
            dataRetentionPeriod: candidate.expiresAt - now(),
            version: candidate.version,
        };
    }

    return null;
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
        dataRetentionPeriod: config.dataRetentionPeriod ?? 31_536_000_000,
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
     */
    _registerCallbacks(callbacks: {
        showBanner: () => void;
        hideBanner: () => void;
        showModal: () => void;
        hideModal: () => void;
        onRemoteConfigLoaded: (rc: RemoteConfig) => void;
    }): void {
        _onShowBanner = callbacks.showBanner;
        _onHideBanner = callbacks.hideBanner;
        _onShowModal = callbacks.showModal;
        _onHideModal = callbacks.hideModal;
        _onRemoteConfigLoaded = callbacks.onRemoteConfigLoaded;
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
        const configureStartTimestamp = now();
        _fallbackConsent = null;

        const handledByPlatform = await configurePlatform(config);
        if (handledByPlatform) {
            _config = config;
            _remoteConfig = null;
            return;
        }

        // Set config before the fetch so consent helpers are usable on failure.
        _config = config;

        // Load and validate stored consent before the fetch so it is available
        // for the billing beacon's cookie flags and for the fetch-failure path.
        const stored = await this._loadStoredConsent();
        const validation = stored
            ? validateConsentData(stored, config)
            : { valid: false, reason: "no stored consent found", consentData: null };

        // Fetch remote config
        try {
            const rc = await fetchRemoteConfig(config);
            _remoteConfig = rc;
            _onRemoteConfigLoaded?.(rc);
            await sendReportingBeacon({
                config,
                remoteConfig: rc,
                type: "billing",
                requestTimestamp: configureStartTimestamp,
                cookieFlags: validation.valid && validation.consentData ? validation.consentData.categories : undefined,
            });
        } catch (e) {
            log(config.debug, "remote config fetch failed", e);
            void sendError({
                msg: e instanceof Error ? e.message : String(e),
                fn: "Enforce.configure.fetchRemoteConfig",
                config,
                clientId: _remoteConfig?.clientId,
            });

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
            this.showBanner();
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
            this.showModal();
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
            throw EnforceError.invalidConfig("environment is required.");
        }

        const nextConfig: EnforceConfig = {
            ...currentConfig,
            environment: nextEnvironment,
        };
        const requestId = ++_environmentChangeRequestId;

        log(currentConfig.debug, "setEnvironment() validating", nextEnvironment);

        try {
            const nextRemoteConfig = await fetchRemoteConfig(nextConfig);

            // Ignore stale completions so older requests cannot overwrite newer ones.
            if (requestId !== _environmentChangeRequestId) {
                throw EnforceError.invalidConfig(
                    `Ignoring stale environment change for "${nextEnvironment}".`
                );
            }

            _config = nextConfig;
            _remoteConfig = nextRemoteConfig;
            _onRemoteConfigLoaded?.(nextRemoteConfig);

            log(currentConfig.debug, "setEnvironment() committed", nextEnvironment);

            return nextRemoteConfig;
        } catch (error) {
            // Preserve the previous config/remote config on any failure.
            log(currentConfig.debug, "setEnvironment() failed", nextEnvironment, error);
            void sendError({
                msg: error instanceof Error ? error.message : String(error),
                fn: "Enforce.setEnvironment.fetchRemoteConfig",
                config: nextConfig,
                clientId: _remoteConfig?.clientId,
            });
            throw error;
        }
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
        notifyConsentHandlers({}, _config?.debug);
        notifyConsentChangeListeners();
        this._hideBanner();
        this._hideModal();
    },

    // -----------------------------------------------------------------------
    // Banner / modal control
    // -----------------------------------------------------------------------

    showBanner(): void {
        _showUIComponent('Banner', shouldShowBanner, hasBannerConfig, _onShowBanner);
    },

    _hideBanner(): void {
        _onHideBanner?.();
    },

    showModal(): void {
        _showUIComponent('Modal', shouldShowModal, hasModalConfig, _onShowModal);
    },

    _hideModal(): void {
        _onHideModal?.();
    },

    // -----------------------------------------------------------------------
    // Accessors
    // -----------------------------------------------------------------------

    _getRemoteConfig(): RemoteConfig | null {
        return _remoteConfig;
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
