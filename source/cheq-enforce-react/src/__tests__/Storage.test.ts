import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConsent, saveConsent, clearConsent } from '../Storage';
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
