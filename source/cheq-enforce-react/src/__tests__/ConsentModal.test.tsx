import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Platform } from 'react-native';
import { ConsentModal } from '../ConsentModal';
import { parseThemeInput, resolveTheme } from '../ThemeResolver';
import type { ConsentModalConfig, Translation } from '../Types';

const TRANSLATION: Translation = {
    notificationBannerContent: 'We use cookies',
    notificationBannerAllowAll: 'Allow All',
    notificationBannerDenyAll: 'Deny All',
    notificationBannerPreferences: 'Preferences',
    consentTitle: 'Privacy Settings',
    consentDescription: 'Description',
    consentModalAllowAll: 'Allow All',
    consentModalDenyAll: 'Deny All',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    cookies: {
        Analytics: { title: 'Analytics', description: 'Usage statistics' },
    },
};

const ALL_VISIBLE: ConsentModalConfig = {
    ensConsentAcceptAll: { show: true },
    ensConsentRejectAll: { show: true },
    ensSaveModal: { show: true },
    ensCloseModal: { show: true },
};

const originalOS = Platform.OS;

function renderModal(theme?: unknown) {
    return render(
        <ConsentModal
            visible
            translation={TRANSLATION}
            modalConfig={ALL_VISIBLE}
            initialConsent={{}}
            theme={theme ? resolveTheme(parseThemeInput(theme)).modal : undefined}
            onAcceptAll={() => {}}
            onRejectAll={() => {}}
            onSave={() => {}}
            onClose={() => {}}
        />
    );
}

function switchThumbColor(container: HTMLElement): string | null {
    return container.querySelector('input[type="checkbox"]')!.getAttribute('data-thumb-color');
}

afterEach(() => {
    cleanup();
    Platform.OS = originalOS;
});

describe('ConsentModal switch thumb', () => {
    it('is white on Android so it does not take the host app theme accent', () => {
        Platform.OS = 'android';
        const { container } = renderModal();
        expect(switchThumbColor(container)).toBe('#FFFFFF');
    });

    it('stays white on Android when the toggle colors are themed', () => {
        Platform.OS = 'android';
        const { container } = renderModal({
            modal: { categories: { toggleOnColor: '#F8286B', toggleOffColor: '#B0BEC5' } },
        });
        expect(switchThumbColor(container)).toBe('#FFFFFF');
    });

    it('is left to the native default on iOS', () => {
        Platform.OS = 'ios';
        const { container } = renderModal();
        expect(switchThumbColor(container)).toBeNull();
    });
});

describe('ConsentModal submit lock', () => {
    function renderWithAcceptAll(onAcceptAll: () => void | Promise<void>) {
        return render(
            <ConsentModal
                visible
                translation={TRANSLATION}
                modalConfig={ALL_VISIBLE}
                initialConsent={{}}
                onAcceptAll={onAcceptAll}
                onRejectAll={() => {}}
                onSave={() => {}}
                onClose={() => {}}
            />
        );
    }

    function acceptAllButton(container: HTMLElement): HTMLButtonElement {
        const button = Array.from(container.querySelectorAll('[role="button"]')).find(
            (el) => el.textContent === 'Allow All'
        );
        return button as HTMLButtonElement;
    }

    it('disables the buttons while an action is in flight', () => {
        const { container } = renderWithAcceptAll(() => new Promise<void>(() => {}));

        fireEvent.click(acceptAllButton(container));

        expect(acceptAllButton(container).disabled).toBe(true);
    });

    it('re-enables the buttons when the action rejects, so the modal never deadlocks', async () => {
        const { container } = renderWithAcceptAll(() => Promise.reject(new Error('storage full')));

        fireEvent.click(acceptAllButton(container));
        expect(acceptAllButton(container).disabled).toBe(true);

        await waitFor(() => expect(acceptAllButton(container).disabled).toBe(false));
    });

    it('re-enables the buttons when the action throws synchronously', () => {
        const { container } = renderWithAcceptAll(() => { throw new Error('boom'); });

        fireEvent.click(acceptAllButton(container));

        expect(acceptAllButton(container).disabled).toBe(false);
    });
});
