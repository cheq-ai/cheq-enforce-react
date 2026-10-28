import { describe, it, expect } from 'vitest';
import {
    BANNER_BUTTON_NAMES,
    DEFAULT_RESOLVED_THEME,
    MODAL_BUTTON_NAMES,
    orderVisibleButtons,
    parseHexColor,
    parseThemeInput,
    resolveTheme,
    withScaledLineHeight,
} from '../ThemeResolver';
import type { ResolvedTheme } from '../ThemeTypes';

/** Parse + resolve in one step, collecting value-level warnings. */
function resolve(input: unknown): { theme: ResolvedTheme; warnings: string[] } {
    const warnings: string[] = [];
    const theme = resolveTheme(parseThemeInput(input), (msg) => warnings.push(msg));
    return { theme, warnings };
}

function expectInvalidConfig(fn: () => unknown): void {
    let caught: unknown = null;
    try {
        fn();
    } catch (error) {
        caught = error;
    }
    expect(caught).toMatchObject({ kind: 'invalidConfig' });
}

describe('resolveTheme defaults', () => {
    it('resolves an empty theme identically to no theme at all', () => {
        const warnings: string[] = [];
        const fromEmpty = resolveTheme(parseThemeInput({}), (msg) => warnings.push(msg));
        const fromUndefined = resolveTheme(undefined, (msg) => warnings.push(msg));

        expect(fromEmpty).toEqual(fromUndefined);
        expect(warnings).toEqual([]);
    });

    it('emits no style overrides for an empty theme', () => {
        const { theme } = resolve({});

        expect(theme.banner.logo).toBeUndefined();
        expect(theme.banner.backgroundColor).toBeUndefined();
        expect(theme.banner.separatorColor).toBeUndefined();
        expect(theme.banner.overlayColor).toBeUndefined();
        expect(theme.banner.summaryDescription).toEqual({});
        expect(theme.modal.presentationStyle).toBe('card');
        expect(theme.modal.summaryTitle).toEqual({});
        expect(theme.modal.categories.toggleOnColor).toBeUndefined();
        for (const name of BANNER_BUTTON_NAMES) {
            expect(theme.banner.buttons[name]).toEqual({ container: {}, text: {} });
        }
        for (const name of MODAL_BUTTON_NAMES) {
            expect(theme.modal.buttons[name]).toEqual({ container: {}, text: {} });
        }
    });

    it('uses the default button orders when order is omitted', () => {
        const { theme } = resolve({});
        expect(theme.banner.buttonOrder).toEqual(['acceptAll', 'rejectAll', 'openModal', 'close']);
        expect(theme.modal.buttonOrder).toEqual(['acceptAll', 'rejectAll', 'save', 'close']);
    });

    it('exposes a frozen default resolved theme', () => {
        expect(DEFAULT_RESOLVED_THEME).toEqual(resolveTheme(undefined));
        expect(Object.isFrozen(DEFAULT_RESOLVED_THEME)).toBe(true);
        expect(Object.isFrozen(DEFAULT_RESOLVED_THEME.banner.buttons.acceptAll)).toBe(true);
    });

    it('notes light-mode behaviour only when the theme has content', () => {
        expect(resolve({}).warnings).toEqual([]);
        const { warnings } = resolve({ banner: {} });
        expect(warnings).toEqual([
            expect.stringContaining('light-mode'),
        ]);
    });
});

describe('empty string handling', () => {
    it('treats empty strings as unset without warning', () => {
        const { theme, warnings } = resolve({
            banner: {
                logoUrl: '',
                logoImage: '',
                backgroundColor: '',
                separatorColor: '',
                summary: { description: { fontName: '', textColor: '  ' } },
                buttons: { acceptAll: { backgroundColor: '' } },
            },
        });

        expect(theme.banner.logo).toBeUndefined();
        expect(theme.banner.backgroundColor).toBeUndefined();
        expect(theme.banner.separatorColor).toBeUndefined();
        expect(theme.banner.summaryDescription).toEqual({});
        expect(theme.banner.buttons.acceptAll.container).toEqual({});
        // Only the light-mode note — no value warnings.
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('light-mode');
    });

    it('falls through an empty specific value to the global value', () => {
        const { theme } = resolve({
            banner: {
                buttons: {
                    acceptAll: { backgroundColor: '' },
                    global: { backgroundColor: '#123456' },
                },
            },
        });
        expect(theme.banner.buttons.acceptAll.container.backgroundColor).toBe('#123456');
    });
});

describe('per-property button fallback', () => {
    it('composes specific and global per property', () => {
        const { theme } = resolve({
            banner: {
                buttons: {
                    acceptAll: { backgroundColor: '#2E7D32' },
                    global: { borderRadius: 4, borderColor: '#FF6F00', borderWidth: 1 },
                },
            },
        });

        expect(theme.banner.buttons.acceptAll.container).toEqual({
            backgroundColor: '#2E7D32',
            borderRadius: 4,
            borderColor: '#FF6F00',
            borderWidth: 1,
        });
    });

    it('lets a specific property win over global', () => {
        const { theme } = resolve({
            modal: {
                buttons: {
                    save: { borderRadius: 20 },
                    global: { borderRadius: 4 },
                },
            },
        });
        expect(theme.modal.buttons.save.container.borderRadius).toBe(20);
    });

    it('applies global to every button that does not override it', () => {
        const { theme } = resolve({
            banner: {
                buttons: { global: { textColor: '#000000', fontSize: 18 } },
            },
        });
        for (const name of BANNER_BUTTON_NAMES) {
            expect(theme.banner.buttons[name].text).toEqual({ color: '#000000', fontSize: 18 });
        }
    });
});

describe('hex color parsing', () => {
    it('accepts 3, 6 and 8 digit hex with or without leading #', () => {
        expect(parseHexColor('#abc')).toBe('#abc');
        expect(parseHexColor('abc')).toBe('#abc');
        expect(parseHexColor('#AABBCC')).toBe('#AABBCC');
        expect(parseHexColor('AABBCC')).toBe('#AABBCC');
        expect(parseHexColor('#00000080')).toBe('#00000080');
        expect(parseHexColor(' #4A148C80 ')).toBe('#4A148C80');
    });

    it('rejects malformed hex values', () => {
        expect(parseHexColor('red')).toBeNull();
        expect(parseHexColor('#GGG')).toBeNull();
        expect(parseHexColor('#12345')).toBeNull();
        expect(parseHexColor('#1234567')).toBeNull();
        expect(parseHexColor('')).toBeNull();
    });

    it('keeps alpha-last 8-digit colors intact on resolved styles', () => {
        const { theme } = resolve({ banner: { overlayColor: '4A148C80' } });
        expect(theme.banner.overlayColor).toBe('#4A148C80');
    });

    it('warns and falls back on invalid hex values', () => {
        const { theme, warnings } = resolve({
            banner: { backgroundColor: 'not-a-color' },
        });
        expect(theme.banner.backgroundColor).toBeUndefined();
        expect(warnings).toContainEqual(
            expect.stringContaining('invalid hex color "not-a-color" for banner.backgroundColor')
        );
    });
});

describe('font weight and alignment', () => {
    it('maps weight names to numeric string weights', () => {
        const weights = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;
        for (const [name, expected] of Object.entries(weights)) {
            const { theme } = resolve({
                modal: { summary: { title: { fontWeight: name } } },
            });
            expect(theme.modal.summaryTitle.fontWeight).toBe(expected);
        }
    });

    it('maps alignments including justified and natural', () => {
        const alignments = {
            left: 'left',
            center: 'center',
            right: 'right',
            justified: 'justify',
            natural: 'auto',
        } as const;
        for (const [name, expected] of Object.entries(alignments)) {
            const { theme } = resolve({
                modal: { summary: { description: { textAlignment: name } } },
            });
            expect(theme.modal.summaryDescription.textAlign).toBe(expected);
        }
    });

    it('warns and falls back on unknown enum values', () => {
        const { theme, warnings } = resolve({
            banner: { summary: { description: { fontWeight: 'heavy', textAlignment: 'middle' } } },
        });
        expect(theme.banner.summaryDescription.fontWeight).toBeUndefined();
        expect(theme.banner.summaryDescription.textAlign).toBeUndefined();
        expect(warnings).toContainEqual(expect.stringContaining('"heavy"'));
        expect(warnings).toContainEqual(expect.stringContaining('"middle"'));
    });

    it('drops fontWeight when fontName is set on the same block', () => {
        const { theme, warnings } = resolve({
            banner: { summary: { description: { fontName: 'Georgia', fontWeight: 'bold' } } },
        });
        expect(theme.banner.summaryDescription.fontFamily).toBe('Georgia');
        expect(theme.banner.summaryDescription.fontWeight).toBeUndefined();
        expect(warnings).toContainEqual(
            expect.stringContaining('fontWeight is ignored because fontName is set')
        );
    });

    it('drops fontWeight when fontName comes from global and fontWeight from the button', () => {
        const { theme } = resolve({
            banner: {
                buttons: {
                    acceptAll: { fontWeight: 'bold' },
                    global: { fontName: 'Menlo-Regular' },
                },
            },
        });
        expect(theme.banner.buttons.acceptAll.text.fontFamily).toBe('Menlo-Regular');
        expect(theme.banner.buttons.acceptAll.text.fontWeight).toBeUndefined();
    });
});

describe('number validation', () => {
    it('rejects non-positive font sizes', () => {
        const { theme, warnings } = resolve({
            banner: { summary: { description: { fontSize: 0 } } },
        });
        expect(theme.banner.summaryDescription.fontSize).toBeUndefined();
        expect(warnings).toContainEqual(expect.stringContaining('fontSize'));
    });

    it('rejects negative and non-finite border values', () => {
        const { theme, warnings } = resolve({
            banner: { buttons: { acceptAll: { borderWidth: -1, borderRadius: Number.NaN } } },
        });
        expect(theme.banner.buttons.acceptAll.container.borderWidth).toBeUndefined();
        expect(theme.banner.buttons.acceptAll.container.borderRadius).toBeUndefined();
        expect(warnings).toContainEqual(expect.stringContaining('borderWidth'));
        expect(warnings).toContainEqual(expect.stringContaining('borderRadius'));
    });

    it('accepts zero border widths and radii', () => {
        const { theme, warnings } = resolve({
            banner: { buttons: { acceptAll: { borderWidth: 0, borderRadius: 0 } } },
        });
        expect(theme.banner.buttons.acceptAll.container.borderWidth).toBe(0);
        expect(theme.banner.buttons.acceptAll.container.borderRadius).toBe(0);
        expect(warnings.filter((w) => w.includes('border'))).toEqual([]);
    });
});

describe('unknown keys', () => {
    it('ignores unknown keys at every level without warning or error', () => {
        const { theme, warnings } = resolve({
            futureSection: { anything: true },
            banner: {
                futureKey: 'x',
                summary: {
                    title: { fontSize: 99 }, // not a banner key — ignored
                    description: { textColor: '#37474F', futureProp: 1 },
                },
                buttons: {
                    futureButton: { backgroundColor: '#FF0000' },
                    acceptAll: { backgroundColor: '#2E7D32', futureProp: 'y' },
                },
            },
        });

        expect(theme.banner.summaryDescription).toEqual({ color: '#37474F' });
        expect(theme.banner.buttons.acceptAll.container.backgroundColor).toBe('#2E7D32');
        expect(warnings.filter((w) => !w.includes('light-mode'))).toEqual([]);
    });
});

describe('parseThemeInput structural validation', () => {
    it('throws invalidConfig for a non-object theme', () => {
        expectInvalidConfig(() => parseThemeInput(42));
        expectInvalidConfig(() => parseThemeInput('theme'));
        expectInvalidConfig(() => parseThemeInput(null));
        expectInvalidConfig(() => parseThemeInput([]));
    });

    it('throws invalidConfig when a section has the wrong type', () => {
        expectInvalidConfig(() => parseThemeInput({ banner: [] }));
        expectInvalidConfig(() => parseThemeInput({ modal: 'card' }));
        expectInvalidConfig(() => parseThemeInput({ banner: { summary: 'text' } }));
    });

    it('throws invalidConfig when a value has the wrong type', () => {
        expectInvalidConfig(() =>
            parseThemeInput({ banner: { summary: { description: { fontSize: '16' } } } })
        );
        expectInvalidConfig(() =>
            parseThemeInput({ banner: { summary: { description: { textColor: 123 } } } })
        );
        expectInvalidConfig(() =>
            parseThemeInput({ banner: { buttons: { order: 'acceptAll' } } })
        );
        expectInvalidConfig(() =>
            parseThemeInput({ banner: { buttons: { order: ['acceptAll', 7] } } })
        );
        expectInvalidConfig(() => parseThemeInput({ banner: { logoUrl: 5 } }));
        expectInvalidConfig(() => parseThemeInput({ modal: { presentationStyle: true } }));
    });

    it('treats null values as absent rather than structural errors', () => {
        const parsed = parseThemeInput({ banner: null, modal: { summary: null } });
        expect(parsed).toEqual({ modal: {} });
    });
});

describe('button order', () => {
    it('renders named buttons first and appends the rest in default order', () => {
        const { theme } = resolve({
            banner: { buttons: { order: ['close'] } },
        });
        expect(theme.banner.buttonOrder).toEqual(['close', 'acceptAll', 'rejectAll', 'openModal']);
    });

    it('keeps the first occurrence of duplicates and warns', () => {
        const { theme, warnings } = resolve({
            banner: { buttons: { order: ['rejectAll', 'acceptAll', 'rejectAll'] } },
        });
        expect(theme.banner.buttonOrder).toEqual(['rejectAll', 'acceptAll', 'openModal', 'close']);
        expect(warnings).toContainEqual(expect.stringContaining('duplicate button "rejectAll"'));
    });

    it('skips unknown names and warns', () => {
        const { theme, warnings } = resolve({
            modal: { buttons: { order: ['save', 'openModal', 'acceptAll'] } },
        });
        expect(theme.modal.buttonOrder).toEqual(['save', 'acceptAll', 'rejectAll', 'close']);
        expect(warnings).toContainEqual(expect.stringContaining('unknown button "openModal"'));
    });

    it('accepts a full custom order', () => {
        const { theme, warnings } = resolve({
            modal: { buttons: { order: ['save', 'acceptAll', 'rejectAll', 'close'] } },
        });
        expect(theme.modal.buttonOrder).toEqual(['save', 'acceptAll', 'rejectAll', 'close']);
        expect(warnings.filter((w) => w.includes('button'))).toEqual([]);
    });
});

describe('orderVisibleButtons', () => {
    it('filters buttons hidden by the remote config and reports skips', () => {
        const skipped: string[] = [];
        const visible = { acceptAll: true, rejectAll: false, openModal: true, close: false };
        const result = orderVisibleButtons(
            ['close', 'acceptAll', 'rejectAll', 'openModal'] as const,
            visible,
            (name) => skipped.push(name)
        );
        expect(result).toEqual(['acceptAll', 'openModal']);
        expect(skipped).toEqual(['close', 'rejectAll']);
    });
});

describe('logo resolution', () => {
    it('maps a string logoImage to a bundled-asset uri source', () => {
        const { theme } = resolve({ banner: { logoImage: 'brand_logo' } });
        expect(theme.banner.logo).toEqual({
            source: { uri: 'brand_logo' },
            remote: false,
            alignment: 'center',
        });
    });

    it('passes a require() number source through', () => {
        const { theme } = resolve({ banner: { logoImage: 42 } });
        expect(theme.banner.logo).toEqual({ source: 42, remote: false, alignment: 'center' });
    });

    it('prefers logoImage over logoUrl', () => {
        const { theme } = resolve({
            banner: { logoImage: 'brand_logo', logoUrl: 'https://example.com/logo.png' },
        });
        expect(theme.banner.logo?.source).toEqual({ uri: 'brand_logo' });
        expect(theme.banner.logo?.remote).toBe(false);
    });

    it('falls back to logoUrl when logoImage is empty', () => {
        const { theme } = resolve({
            banner: { logoImage: '', logoUrl: 'https://example.com/logo.png' },
        });
        expect(theme.banner.logo).toEqual({
            source: { uri: 'https://example.com/logo.png' },
            remote: true,
            alignment: 'center',
        });
    });

    it('honours logoAlignment and warns on unknown values', () => {
        const { theme } = resolve({
            modal: { logoUrl: 'https://example.com/logo.png', logoAlignment: 'full' },
        });
        expect(theme.modal.logo?.alignment).toBe('full');

        const bad = resolve({
            modal: { logoUrl: 'https://example.com/logo.png', logoAlignment: 'top' },
        });
        expect(bad.theme.modal.logo?.alignment).toBe('center');
        expect(bad.warnings).toContainEqual(expect.stringContaining('"top"'));
    });
});

describe('modal presentation style', () => {
    it('defaults to card and accepts fullScreen', () => {
        expect(resolve({ modal: {} }).theme.modal.presentationStyle).toBe('card');
        expect(
            resolve({ modal: { presentationStyle: 'fullScreen' } }).theme.modal.presentationStyle
        ).toBe('fullScreen');
    });

    it('warns and falls back to card on unknown styles', () => {
        const { theme, warnings } = resolve({ modal: { presentationStyle: 'sheet' } });
        expect(theme.modal.presentationStyle).toBe('card');
        expect(warnings).toContainEqual(expect.stringContaining('"sheet"'));
    });
});

describe('modal categories', () => {
    it('resolves toggle colors, separator and category text styles', () => {
        const { theme } = resolve({
            modal: {
                categories: {
                    toggleOnColor: '#2E7D32',
                    toggleOffColor: '#B0BEC5',
                    separatorColor: '#8D6E63',
                    title: { fontSize: 16, fontWeight: 'bold' },
                    description: { textColor: '#6D4C41' },
                },
            },
        });
        expect(theme.modal.categories.toggleOnColor).toBe('#2E7D32');
        expect(theme.modal.categories.toggleOffColor).toBe('#B0BEC5');
        expect(theme.modal.categories.separatorColor).toBe('#8D6E63');
        expect(theme.modal.categories.title).toEqual({ fontSize: 16, fontWeight: '700' });
        expect(theme.modal.categories.description).toEqual({ color: '#6D4C41' });
    });

    it('leaves category separators unset when absent or blank', () => {
        expect(resolve({ modal: {} }).theme.modal.categories.separatorColor).toBeUndefined();
        expect(
            resolve({ modal: { categories: { separatorColor: '' } } }).theme.modal.categories
                .separatorColor
        ).toBeUndefined();
    });

    it('drops an invalid toggle color with a warning', () => {
        const { theme, warnings } = resolve({
            modal: { categories: { toggleOnColor: 'green!' } },
        });
        expect(theme.modal.categories.toggleOnColor).toBeUndefined();
        expect(warnings).toContainEqual(expect.stringContaining('toggleOnColor'));
    });
});

describe('withScaledLineHeight', () => {
    it('returns the style unchanged when fontSize is not themed', () => {
        const style = { color: '#333' };
        expect(withScaledLineHeight(style, 14, 20)).toBe(style);
    });

    it('scales lineHeight proportionally when fontSize is themed', () => {
        expect(withScaledLineHeight({ fontSize: 28 }, 14, 20)).toEqual({
            fontSize: 28,
            lineHeight: 40,
        });
        expect(withScaledLineHeight({ fontSize: 15 }, 14, 20)).toEqual({
            fontSize: 15,
            lineHeight: 21,
        });
    });
});

describe('enum lookups', () => {
    it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
        'treats the inherited key "%s" as an unknown value',
        (name) => {
            const { theme, warnings } = resolve({
                banner: { logoUrl: 'https://example.com/logo.png', logoAlignment: name, summary: { description: { fontWeight: name, textAlignment: name } } },
                modal: { presentationStyle: name },
            });

            expect(theme.banner.summaryDescription).toEqual({});
            expect(theme.banner.logo?.alignment).toBe('center');
            expect(theme.modal.presentationStyle).toBe('card');
            expect(warnings).toContain(
                `theme: unknown value "${name}" for banner.summary.description.fontWeight — using default`
            );
        }
    );
});
