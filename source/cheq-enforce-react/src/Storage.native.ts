/**
 * React Native storage implementation.
 * Uses @react-native-async-storage/async-storage for persistent native storage.
 * Native consumers are expected to install that dependency.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ConsentData } from "./Types";

const CONSENT_KEY = "cheqEnforceConsentData";

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
