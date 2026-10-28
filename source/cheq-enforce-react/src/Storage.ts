/**
 * Web storage implementation.
 * Uses localStorage when available, falls back to an in-memory store.
 * The API is async to match the native AsyncStorage implementation.
 */

import type { ConsentData } from "./Types";

const CONSENT_KEY = "cheqEnforceConsentData";
const REPORTING_EVENTS_KEY = "cheqEnforceReportingEvents";
const ENVIRONMENT_OVERRIDE_KEY = "cheqEnforceEnvironmentOverride";
const ENVIRONMENT_OVERRIDE_EXPIRY_KEY = "cheqEnforceEnvironmentOverrideExpiry";

export interface EnvironmentOverride {
    environment: string;
    /** Absolute expiry, epoch milliseconds. */
    expiresAt: number;
}

function createMemoryStorage(): Storage {
    const store: Record<string, string> = {};
    return {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        key: (i) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; },
    };
}

function getSafeStorage(): Storage {
    try {
        if (typeof localStorage !== "undefined") return localStorage;
    } catch {
        // SecurityError in sandboxed iframes
    }
    return createMemoryStorage();
}

const store = getSafeStorage();

export async function loadConsent(): Promise<ConsentData | null> {
    try {
        const raw = store.getItem(CONSENT_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as ConsentData;
    } catch (e) {
        console.warn("[CheqEnforce] loadConsent: failed to parse stored consent", e);
        return null;
    }
}

export async function saveConsent(data: ConsentData): Promise<void> {
    try {
        store.setItem(CONSENT_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn("[CheqEnforce] saveConsent: failed to write consent to storage", e);
        throw e;
    }
}

export async function clearConsent(): Promise<void> {
    store.removeItem(CONSENT_KEY);
}

export async function loadReportingEvents(): Promise<Record<string, boolean> | null> {
    try {
        const raw = store.getItem(REPORTING_EVENTS_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as Record<string, boolean>;
    } catch (e) {
        console.warn("[CheqEnforce] loadReportingEvents: failed to parse stored events", e);
        return null;
    }
}

export async function saveReportingEvents(events: Record<string, boolean>): Promise<void> {
    try {
        store.setItem(REPORTING_EVENTS_KEY, JSON.stringify(events));
    } catch (e) {
        console.warn("[CheqEnforce] saveReportingEvents: failed to write events to storage", e);
        throw e;
    }
}

export async function clearReportingEvents(): Promise<void> {
    store.removeItem(REPORTING_EVENTS_KEY);
}

export async function loadEnvironmentOverride(): Promise<EnvironmentOverride | null> {
    try {
        const environment = store.getItem(ENVIRONMENT_OVERRIDE_KEY);
        const rawExpiry = store.getItem(ENVIRONMENT_OVERRIDE_EXPIRY_KEY);
        if (!environment || !environment.trim() || !rawExpiry) return null;
        const expiresAt = Number(rawExpiry);
        if (!Number.isFinite(expiresAt)) return null;
        return { environment, expiresAt };
    } catch (e) {
        console.warn("[CheqEnforce] loadEnvironmentOverride: failed to read stored override", e);
        return null;
    }
}

export async function saveEnvironmentOverride(
    environment: string,
    expiresAt: number
): Promise<void> {
    try {
        store.setItem(ENVIRONMENT_OVERRIDE_KEY, environment);
        store.setItem(ENVIRONMENT_OVERRIDE_EXPIRY_KEY, String(expiresAt));
    } catch (e) {
        console.warn("[CheqEnforce] saveEnvironmentOverride: failed to write override to storage", e);
        throw e;
    }
}

export async function clearEnvironmentOverride(): Promise<void> {
    try {
        store.removeItem(ENVIRONMENT_OVERRIDE_KEY);
        store.removeItem(ENVIRONMENT_OVERRIDE_EXPIRY_KEY);
    } catch (e) {
        console.warn("[CheqEnforce] clearEnvironmentOverride: failed to remove override from storage", e);
        throw e;
    }
}
