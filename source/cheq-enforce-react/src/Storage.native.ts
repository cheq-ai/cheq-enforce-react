/**
 * React Native storage implementation.
 * Uses @react-native-async-storage/async-storage for persistent native storage.
 * Native consumers are expected to install that dependency.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
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

// ---------------------------------------------------------------------------
// Public API (async — required for React Native)
// ---------------------------------------------------------------------------

export async function loadConsent(): Promise<ConsentData | null> {
    try {
        const raw = await AsyncStorage.getItem(CONSENT_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as ConsentData;
    } catch (e) {
        console.warn("[CheqEnforce] loadConsent: failed to parse stored consent", e);
        return null;
    }
}

export async function saveConsent(data: ConsentData): Promise<void> {
    try {
        await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn("[CheqEnforce] saveConsent: failed to write consent to storage", e);
        throw e;
    }
}

export async function clearConsent(): Promise<void> {
    await AsyncStorage.removeItem(CONSENT_KEY);
}

export async function loadReportingEvents(): Promise<Record<string, boolean> | null> {
    try {
        const raw = await AsyncStorage.getItem(REPORTING_EVENTS_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as Record<string, boolean>;
    } catch (e) {
        console.warn("[CheqEnforce] loadReportingEvents: failed to parse stored events", e);
        return null;
    }
}

export async function saveReportingEvents(events: Record<string, boolean>): Promise<void> {
    try {
        await AsyncStorage.setItem(REPORTING_EVENTS_KEY, JSON.stringify(events));
    } catch (e) {
        console.warn("[CheqEnforce] saveReportingEvents: failed to write events to storage", e);
        throw e;
    }
}

export async function clearReportingEvents(): Promise<void> {
    await AsyncStorage.removeItem(REPORTING_EVENTS_KEY);
}

export async function loadEnvironmentOverride(): Promise<EnvironmentOverride | null> {
    try {
        const entries = await AsyncStorage.multiGet([
            ENVIRONMENT_OVERRIDE_KEY,
            ENVIRONMENT_OVERRIDE_EXPIRY_KEY,
        ]);
        const environment = entries[0]?.[1];
        const rawExpiry = entries[1]?.[1];
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
        await AsyncStorage.multiSet([
            [ENVIRONMENT_OVERRIDE_KEY, environment],
            [ENVIRONMENT_OVERRIDE_EXPIRY_KEY, String(expiresAt)],
        ]);
    } catch (e) {
        console.warn("[CheqEnforce] saveEnvironmentOverride: failed to write override to storage", e);
        throw e;
    }
}

export async function clearEnvironmentOverride(): Promise<void> {
    try {
        await AsyncStorage.multiRemove([
            ENVIRONMENT_OVERRIDE_KEY,
            ENVIRONMENT_OVERRIDE_EXPIRY_KEY,
        ]);
    } catch (e) {
        console.warn("[CheqEnforce] clearEnvironmentOverride: failed to remove override from storage", e);
        throw e;
    }
}
