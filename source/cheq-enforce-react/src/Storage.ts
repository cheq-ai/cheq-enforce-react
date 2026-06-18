/**
 * Web storage implementation.
 * Uses localStorage when available, falls back to an in-memory store.
 * The API is async to match the native AsyncStorage implementation.
 */

import type { ConsentData } from "./Types";

const CONSENT_KEY = "cheqEnforceConsentData";

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
