import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ConsentBanner } from '../ConsentBanner';
import { parseThemeInput, resolveTheme } from '../ThemeResolver';
import type { ResolvedBannerTheme } from '../ThemeTypes';
import type { BannerConfig, Translation } from '../Types';

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
    cookies: {},
};

const ALL_VISIBLE: BannerConfig = {
    ensAcceptAll: { show: true },
    ensRejectAll: { show: true },
    ensOpenModal: { show: true },
    ensCloseBanner: { show: true },
};

function bannerTheme(input: unknown): ResolvedBannerTheme {
    return resolveTheme(parseThemeInput(input)).banner;
}

function renderBanner({
    bannerConfig = ALL_VISIBLE,
    theme,
}: {
    bannerConfig?: BannerConfig;
    theme?: ResolvedBannerTheme;
} = {}) {
    return render(
        <ConsentBanner
            visible
            translation={TRANSLATION}
            bannerConfig={bannerConfig}
            theme={theme}
            onAcceptAll={() => {}}
            onRejectAll={() => {}}
            onOpenModal={() => {}}
            onClose={() => {}}
        />
    );
}

function buttonLabels(container: HTMLElement): (string | null)[] {
    return Array.from(container.querySelectorAll('[role="button"]')).map(
        (button) => button.textContent
    );
}

function elementStyles(container: HTMLElement): Record<string, unknown>[] {
    return Array.from(container.querySelectorAll('[data-style]')).map((el) =>
        JSON.parse(el.getAttribute('data-style') ?? '{}')
    );
}

afterEach(cleanup);

describe('ConsentBanner button order', () => {
    it('renders buttons in the default order without a theme', () => {
        const { container } = renderBanner();
        expect(buttonLabels(container)).toEqual([
            'Allow All',
            'Deny All',
            'Preferences',
            'Close',
        ]);
    });

    it('renders named buttons first, then the rest in default order', () => {
        const { container } = renderBanner({
            theme: bannerTheme({ banner: { buttons: { order: ['close', 'rejectAll'] } } }),
        });
        expect(buttonLabels(container)).toEqual([
            'Close',
            'Deny All',
            'Allow All',
            'Preferences',
        ]);
    });

    it('never renders buttons the remote config hides, even when named in order', () => {
        const { container } = renderBanner({
            bannerConfig: {
                ...ALL_VISIBLE,
                ensCloseBanner: { show: false },
                ensRejectAll: { show: false },
            },
            theme: bannerTheme({
                banner: { buttons: { order: ['close', 'rejectAll', 'openModal'] } },
            }),
        });
        expect(buttonLabels(container)).toEqual(['Preferences', 'Allow All']);
    });
});

describe('ConsentBanner themed rendering', () => {
    it('renders no separator by default', () => {
        const { container } = renderBanner();
        const separators = elementStyles(container).filter(
            (style) => style.height === 0.5 && 'backgroundColor' in style
        );
        expect(separators).toEqual([]);
    });

    it('renders a separator when separatorColor is themed', () => {
        const { container } = renderBanner({
            theme: bannerTheme({ banner: { separatorColor: '#FF5722' } }),
        });
        const separators = elementStyles(container).filter(
            (style) => style.backgroundColor === '#FF5722'
        );
        expect(separators).toHaveLength(1);
    });

    it('applies themed button styles on top of the defaults', () => {
        const { container } = renderBanner({
            theme: bannerTheme({
                banner: {
                    buttons: {
                        acceptAll: { backgroundColor: '#2E7D32' },
                        global: { borderRadius: 4 },
                    },
                },
            }),
        });
        const buttons = Array.from(container.querySelectorAll('[role="button"]')).map((el) =>
            JSON.parse(el.getAttribute('data-style') ?? '{}')
        );
        const acceptAll = buttons[0];
        expect(acceptAll.backgroundColor).toBe('#2E7D32');
        expect(acceptAll.borderRadius).toBe(4);
        // rejectAll keeps its default (primary, matching acceptAll — GDPR)
        // background but picks up the global radius.
        const rejectAll = buttons[1];
        expect(rejectAll.backgroundColor).toBe('#1a73e8');
        expect(rejectAll.borderRadius).toBe(4);
    });

    it('renders identically with an empty theme and with no theme', () => {
        const unthemed = renderBanner();
        const unthemedHtml = unthemed.container.innerHTML;
        unthemed.unmount();

        const emptyThemed = renderBanner({ theme: bannerTheme({}) });
        expect(emptyThemed.container.innerHTML).toBe(unthemedHtml);
    });

    it('renders a logo only when themed', () => {
        const noLogo = renderBanner();
        expect(noLogo.container.querySelector('img')).toBeNull();
        noLogo.unmount();

        const withLogo = renderBanner({
            theme: bannerTheme({ banner: { logoImage: 42 } }),
        });
        expect(withLogo.container.querySelector('img')).not.toBeNull();
    });
});

describe('ConsentBanner submit lock', () => {
    function acceptAllButton(container: HTMLElement): HTMLButtonElement {
        const button = Array.from(container.querySelectorAll('[role="button"]')).find(
            (el) => el.textContent === 'Allow All'
        );
        return button as HTMLButtonElement;
    }

    it('disables the buttons while an action is in flight', () => {
        const { container } = render(
            <ConsentBanner
                visible
                translation={TRANSLATION}
                bannerConfig={ALL_VISIBLE}
                onAcceptAll={() => new Promise<void>(() => {})}
                onRejectAll={() => {}}
                onOpenModal={() => {}}
                onClose={() => {}}
            />
        );

        fireEvent.click(acceptAllButton(container));

        expect(acceptAllButton(container).disabled).toBe(true);
    });

    it('re-enables the buttons when the action rejects, so the banner never deadlocks', async () => {
        const { container } = render(
            <ConsentBanner
                visible
                translation={TRANSLATION}
                bannerConfig={ALL_VISIBLE}
                onAcceptAll={() => Promise.reject(new Error('storage full'))}
                onRejectAll={() => {}}
                onOpenModal={() => {}}
                onClose={() => {}}
            />
        );

        fireEvent.click(acceptAllButton(container));
        expect(acceptAllButton(container).disabled).toBe(true);

        await waitFor(() => expect(acceptAllButton(container).disabled).toBe(false));
    });

    it('re-enables the buttons when the action throws synchronously', () => {
        const { container } = render(
            <ConsentBanner
                visible
                translation={TRANSLATION}
                bannerConfig={ALL_VISIBLE}
                onAcceptAll={() => { throw new Error('boom'); }}
                onRejectAll={() => {}}
                onOpenModal={() => {}}
                onClose={() => {}}
            />
        );

        fireEvent.click(acceptAllButton(container));

        expect(acceptAllButton(container).disabled).toBe(false);
    });
});
