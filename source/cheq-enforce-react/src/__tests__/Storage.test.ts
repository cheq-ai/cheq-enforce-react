import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    loadConsent,
    saveConsent,
    clearConsent,
    loadEnvironmentOverride,
    saveEnvironmentOverride,
    clearEnvironmentOverride,
} from '../Storage';
import type { ConsentData } from '../Types';

const VALID: ConsentData = {
    categories: { analytics: true, marketing: false },
    savedAt: 1_000_000,
    dataRetentionPeriod: 86_400_000,
    version: 'v1',
};

describe('Storage (web / localStorage)', () => {
    beforeEach(async () => {
        await clearConsent();
    });

    it('loadConsent returns null when nothing is stored', async () => {
        await expect(loadConsent()).resolves.toBeNull();
    });

    it('saveConsent then loadConsent returns the stored data', async () => {
        await saveConsent(VALID);
        await expect(loadConsent()).resolves.toEqual(VALID);
    });

    it('clearConsent removes the stored value', async () => {
        await saveConsent(VALID);
        await clearConsent();
        await expect(loadConsent()).resolves.toBeNull();
    });

    it('loadConsent returns null for corrupted JSON', async () => {
        localStorage.setItem('cheqEnforceConsentData', '{bad json');
        await expect(loadConsent()).resolves.toBeNull();
    });
});

describe('Storage — environment override (web / localStorage)', () => {
    beforeEach(async () => {
        await clearEnvironmentOverride();
    });

    it('returns null when nothing is stored', async () => {
        await expect(loadEnvironmentOverride()).resolves.toBeNull();
    });

    it('round-trips an override', async () => {
        await saveEnvironmentOverride('German', 1_700_000_000_000);
        await expect(loadEnvironmentOverride()).resolves.toEqual({
            environment: 'German',
            expiresAt: 1_700_000_000_000,
        });
    });

    it('clear removes both keys', async () => {
        await saveEnvironmentOverride('German', 1_700_000_000_000);
        await clearEnvironmentOverride();
        await expect(loadEnvironmentOverride()).resolves.toBeNull();
        expect(localStorage.getItem('cheqEnforceEnvironmentOverride')).toBeNull();
        expect(localStorage.getItem('cheqEnforceEnvironmentOverrideExpiry')).toBeNull();
    });

    it('returns null for a malformed expiry', async () => {
        localStorage.setItem('cheqEnforceEnvironmentOverride', 'German');
        localStorage.setItem('cheqEnforceEnvironmentOverrideExpiry', 'not-a-number');
        await expect(loadEnvironmentOverride()).resolves.toBeNull();
    });

    it('returns null when the environment value is blank', async () => {
        localStorage.setItem('cheqEnforceEnvironmentOverride', '   ');
        localStorage.setItem('cheqEnforceEnvironmentOverrideExpiry', '1700000000000');
        await expect(loadEnvironmentOverride()).resolves.toBeNull();
    });
});

describe('Storage — SecurityError fallback', () => {
    let savedDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        savedDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
        vi.resetModules();
    });

    afterEach(() => {
        if (savedDescriptor) {
            Object.defineProperty(window, 'localStorage', savedDescriptor);
        }
        vi.resetModules();
    });

    it('uses in-memory store when localStorage throws SecurityError', async () => {
        Object.defineProperty(window, 'localStorage', {
            get: () => { throw new DOMException('SecurityError'); },
            configurable: true,
        });

        const mod = await import('../Storage');
        const data: ConsentData = {
            categories: { analytics: true },
            savedAt: 1_000_000,
            dataRetentionPeriod: 86_400_000,
            version: 'v1',
        };

        await mod.saveConsent(data);
        const result = await mod.loadConsent();
        expect(result?.categories).toEqual({ analytics: true });

        await mod.clearConsent();
        await expect(mod.loadConsent()).resolves.toBeNull();
    });
});
