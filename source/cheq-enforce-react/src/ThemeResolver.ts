import { EnforceError } from "./Types";
import type {
    BannerButtonName,
    ModalButtonName,
    ModalPresentationStyle,
    ResolvedBannerTheme,
    ResolvedButtonStyle,
    ResolvedLogo,
    ResolvedModalTheme,
    ResolvedTextStyle,
    ResolvedTheme,
    ThemeButtonStyle,
    ThemeFontWeight,
    ThemeLogoAlignment,
    ThemeTextAlignment,
    ThemeTextStyle,
} from "./ThemeTypes";

// ---------------------------------------------------------------------------
// Theme parsing & resolution.
//
// Two tiers:
//  - parseThemeInput(): STRUCTURAL validation. A present key of the wrong
//    JSON type (e.g. `fontSize: "16"`, `order: "acceptAll"`) throws an
//    EnforceError — the one case surfaced to the integrator. Unknown keys
//    are silently dropped (forward compatibility).
//  - resolveTheme(): VALUE-level, tolerant resolution. Invalid values (bad
//    hex, unknown enum member, non-finite number) are logged via the injected
//    warn callback and fall through to the default. Empty strings mean
//    "not set" and fall through silently.
//
// The output is SPARSE: only explicitly and validly themed properties are
// present, so components can render `[baseStyle, override]` and an untouched
// theme is pixel-identical to the default appearance.
//
// This module deliberately has no react-native import so it stays fully
// unit-testable outside a native environment.
// ---------------------------------------------------------------------------

type WarnFn = (message: string) => void;

const noopWarn: WarnFn = () => {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Banner button names in their default render order. */
export const BANNER_BUTTON_NAMES: readonly BannerButtonName[] = [
    "acceptAll",
    "rejectAll",
    "openModal",
    "close",
];

/** Modal button names in their default render order. */
export const MODAL_BUTTON_NAMES: readonly ModalButtonName[] = [
    "acceptAll",
    "rejectAll",
    "save",
    "close",
];

const FONT_WEIGHT_MAP: Record<string, NonNullable<ResolvedTextStyle["fontWeight"]>> = {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
};

const TEXT_ALIGN_MAP: Record<string, NonNullable<ResolvedTextStyle["textAlign"]>> = {
    left: "left",
    center: "center",
    right: "right",
    justified: "justify",
    // "natural" follows the language/layout direction.
    natural: "auto",
};

const LOGO_ALIGNMENT_MAP: Record<string, ThemeLogoAlignment> = {
    left: "left",
    center: "center",
    right: "right",
    full: "full",
};

const PRESENTATION_STYLE_MAP: Record<string, ModalPresentationStyle> = {
    card: "card",
    fullScreen: "fullScreen",
};

const HEX_BODY_RE = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// ---------------------------------------------------------------------------
// Structural parsing (throws EnforceError.invalidConfig)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuralError(path: string, expected: string): EnforceError {
    return EnforceError.invalidConfig(`theme: ${path} must be ${expected}`);
}

function readString(
    obj: Record<string, unknown>,
    key: string,
    path: string
): string | undefined {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw structuralError(`${path}.${key}`, "a string");
    return value;
}

function readNumber(
    obj: Record<string, unknown>,
    key: string,
    path: string
): number | undefined {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number") throw structuralError(`${path}.${key}`, "a number");
    return value;
}

function readStringOrNumber(
    obj: Record<string, unknown>,
    key: string,
    path: string
): string | number | undefined {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" && typeof value !== "number") {
        throw structuralError(`${path}.${key}`, "a string or a number");
    }
    return value;
}

function parseTextStyle(value: unknown, path: string): ThemeTextStyle | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) throw structuralError(path, "an object");

    const out: ThemeTextStyle = {};
    const fontName = readString(value, "fontName", path);
    if (fontName !== undefined) out.fontName = fontName;
    const fontSize = readNumber(value, "fontSize", path);
    if (fontSize !== undefined) out.fontSize = fontSize;
    const fontWeight = readString(value, "fontWeight", path);
    if (fontWeight !== undefined) out.fontWeight = fontWeight as ThemeFontWeight;
    const textAlignment = readString(value, "textAlignment", path);
    if (textAlignment !== undefined) out.textAlignment = textAlignment as ThemeTextAlignment;
    const textColor = readString(value, "textColor", path);
    if (textColor !== undefined) out.textColor = textColor;
    return out;
}

function parseButtonStyle(value: unknown, path: string): ThemeButtonStyle | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) throw structuralError(path, "an object");

    const out: ThemeButtonStyle = {};
    const backgroundColor = readString(value, "backgroundColor", path);
    if (backgroundColor !== undefined) out.backgroundColor = backgroundColor;
    const textColor = readString(value, "textColor", path);
    if (textColor !== undefined) out.textColor = textColor;
    const fontName = readString(value, "fontName", path);
    if (fontName !== undefined) out.fontName = fontName;
    const fontSize = readNumber(value, "fontSize", path);
    if (fontSize !== undefined) out.fontSize = fontSize;
    const fontWeight = readString(value, "fontWeight", path);
    if (fontWeight !== undefined) out.fontWeight = fontWeight as ThemeFontWeight;
    const borderColor = readString(value, "borderColor", path);
    if (borderColor !== undefined) out.borderColor = borderColor;
    const borderWidth = readNumber(value, "borderWidth", path);
    if (borderWidth !== undefined) out.borderWidth = borderWidth;
    const borderRadius = readNumber(value, "borderRadius", path);
    if (borderRadius !== undefined) out.borderRadius = borderRadius;
    return out;
}

function parseOrder(value: unknown, path: string): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw structuralError(path, "an array of button names");
    }
    return [...(value as string[])];
}

interface ParsedButtons<N extends string> {
    order?: string[];
    global?: ThemeButtonStyle;
    named: Partial<Record<N, ThemeButtonStyle>>;
}

function parseButtons<N extends string>(
    value: unknown,
    path: string,
    names: readonly N[]
): ParsedButtons<N> | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) throw structuralError(path, "an object");

    const out: ParsedButtons<N> = { named: {} };
    const order = parseOrder(value.order, `${path}.order`);
    if (order !== undefined) out.order = order;
    const global = parseButtonStyle(value.global, `${path}.global`);
    if (global !== undefined) out.global = global;
    for (const name of names) {
        const style = parseButtonStyle(value[name], `${path}.${name}`);
        if (style !== undefined) out.named[name] = style;
    }
    return out;
}

interface ParsedSection<N extends string> {
    logoUrl?: string;
    logoImage?: string | number;
    logoAlignment?: string;
    backgroundColor?: string;
    separatorColor?: string;
    overlayColor?: string;
    buttons?: ParsedButtons<N>;
}

function parseSectionCommon<N extends string>(
    value: Record<string, unknown>,
    path: string,
    names: readonly N[]
): ParsedSection<N> {
    const out: ParsedSection<N> = {};
    const logoUrl = readString(value, "logoUrl", path);
    if (logoUrl !== undefined) out.logoUrl = logoUrl;
    const logoImage = readStringOrNumber(value, "logoImage", path);
    if (logoImage !== undefined) out.logoImage = logoImage;
    const logoAlignment = readString(value, "logoAlignment", path);
    if (logoAlignment !== undefined) out.logoAlignment = logoAlignment;
    const backgroundColor = readString(value, "backgroundColor", path);
    if (backgroundColor !== undefined) out.backgroundColor = backgroundColor;
    const separatorColor = readString(value, "separatorColor", path);
    if (separatorColor !== undefined) out.separatorColor = separatorColor;
    const overlayColor = readString(value, "overlayColor", path);
    if (overlayColor !== undefined) out.overlayColor = overlayColor;
    const buttons = parseButtons(value.buttons, `${path}.buttons`, names);
    if (buttons !== undefined) out.buttons = buttons;
    return out;
}

interface ParsedBanner extends ParsedSection<BannerButtonName> {
    summaryDescription?: ThemeTextStyle;
}

function parseBanner(value: unknown): ParsedBanner | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) throw structuralError("banner", "an object");

    const out: ParsedBanner = parseSectionCommon(value, "banner", BANNER_BUTTON_NAMES);
    const summary = value.summary;
    if (summary !== undefined && summary !== null) {
        if (!isRecord(summary)) throw structuralError("banner.summary", "an object");
        const description = parseTextStyle(summary.description, "banner.summary.description");
        if (description !== undefined) out.summaryDescription = description;
    }
    return out;
}

interface ParsedModal extends ParsedSection<ModalButtonName> {
    presentationStyle?: string;
    summaryTitle?: ThemeTextStyle;
    summaryDescription?: ThemeTextStyle;
    categories?: {
        toggleOnColor?: string;
        toggleOffColor?: string;
        separatorColor?: string;
        title?: ThemeTextStyle;
        description?: ThemeTextStyle;
    };
}

function parseModal(value: unknown): ParsedModal | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) throw structuralError("modal", "an object");

    const out: ParsedModal = parseSectionCommon(value, "modal", MODAL_BUTTON_NAMES);
    const presentationStyle = readString(value, "presentationStyle", "modal");
    if (presentationStyle !== undefined) out.presentationStyle = presentationStyle;

    const summary = value.summary;
    if (summary !== undefined && summary !== null) {
        if (!isRecord(summary)) throw structuralError("modal.summary", "an object");
        const title = parseTextStyle(summary.title, "modal.summary.title");
        if (title !== undefined) out.summaryTitle = title;
        const description = parseTextStyle(summary.description, "modal.summary.description");
        if (description !== undefined) out.summaryDescription = description;
    }

    const categories = value.categories;
    if (categories !== undefined && categories !== null) {
        if (!isRecord(categories)) throw structuralError("modal.categories", "an object");
        const parsed: NonNullable<ParsedModal["categories"]> = {};
        const toggleOnColor = readString(categories, "toggleOnColor", "modal.categories");
        if (toggleOnColor !== undefined) parsed.toggleOnColor = toggleOnColor;
        const toggleOffColor = readString(categories, "toggleOffColor", "modal.categories");
        if (toggleOffColor !== undefined) parsed.toggleOffColor = toggleOffColor;
        const categorySeparatorColor = readString(categories, "separatorColor", "modal.categories");
        if (categorySeparatorColor !== undefined) parsed.separatorColor = categorySeparatorColor;
        const title = parseTextStyle(categories.title, "modal.categories.title");
        if (title !== undefined) parsed.title = title;
        const description = parseTextStyle(categories.description, "modal.categories.description");
        if (description !== undefined) parsed.description = description;
        out.categories = parsed;
    }
    return out;
}

/**
 * Structurally validate a theme input. Throws EnforceError (kind
 * "invalidConfig") when a present key has the wrong type. Unknown keys are
 * silently dropped. Returns a normalized copy (never aliases the input).
 */
export function parseThemeInput(input: unknown): ParsedTheme {
    if (!isRecord(input)) throw structuralError("theme", "an object");
    const out: ParsedTheme = {};
    const banner = parseBanner(input.banner);
    if (banner !== undefined) out.banner = banner;
    const modal = parseModal(input.modal);
    if (modal !== undefined) out.modal = modal;
    return out;
}

export interface ParsedTheme {
    banner?: ParsedBanner;
    modal?: ParsedModal;
}

// ---------------------------------------------------------------------------
// Value-level resolution (tolerant: warn + fall through to default)
// ---------------------------------------------------------------------------

/**
 * Normalize a hex color: #RGB, #RRGGBB or #RRGGBBAA (alpha last), leading #
 * optional. Returns the #-prefixed color, or null when invalid.
 */
export function parseHexColor(value: string): string | null {
    const trimmed = value.trim();
    const body = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    return HEX_BODY_RE.test(body) ? `#${body}` : null;
}

function isUnsetString(value: string | undefined): value is undefined {
    return value === undefined || value.trim() === "";
}

function resolveColor(value: string | undefined, path: string, warn: WarnFn): string | undefined {
    if (isUnsetString(value)) return undefined;
    const parsed = parseHexColor(value);
    if (parsed === null) {
        warn(`theme: invalid hex color "${value}" for ${path} — using default`);
        return undefined;
    }
    return parsed;
}

function resolveMapped<V>(
    value: string | undefined,
    map: Record<string, V>,
    path: string,
    warn: WarnFn
): V | undefined {
    if (isUnsetString(value)) return undefined;
    const key = value.trim();
    // Own keys only, so inherited members like "constructor" are rejected.
    const mapped = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
    if (mapped === undefined) {
        warn(`theme: unknown value "${value}" for ${path} — using default`);
        return undefined;
    }
    return mapped;
}

function resolveFontSize(value: number | undefined, path: string, warn: WarnFn): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value <= 0) {
        warn(`theme: invalid number ${value} for ${path} — using default`);
        return undefined;
    }
    return value;
}

function resolveNonNegativeNumber(
    value: number | undefined,
    path: string,
    warn: WarnFn
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value < 0) {
        warn(`theme: invalid number ${value} for ${path} — using default`);
        return undefined;
    }
    return value;
}

/**
 * A named font carries its own weight, so `fontWeight` only applies when no
 * custom `fontName` is set. Drops fontWeight (warning once) when both
 * resolved on the same text block.
 */
function applyFontNameWeightRule(text: ResolvedTextStyle, path: string, warn: WarnFn): ResolvedTextStyle {
    if (text.fontFamily !== undefined && text.fontWeight !== undefined) {
        warn(`theme: ${path}.fontWeight is ignored because fontName is set`);
        const { fontWeight: _dropped, ...rest } = text;
        return rest;
    }
    return text;
}

function resolveTextStyleSparse(
    style: ThemeTextStyle | undefined,
    path: string,
    warn: WarnFn
): ResolvedTextStyle {
    const out: ResolvedTextStyle = {};
    if (!style) return out;

    if (!isUnsetString(style.fontName)) out.fontFamily = style.fontName.trim();
    const fontSize = resolveFontSize(style.fontSize, `${path}.fontSize`, warn);
    if (fontSize !== undefined) out.fontSize = fontSize;
    const fontWeight = resolveMapped(style.fontWeight, FONT_WEIGHT_MAP, `${path}.fontWeight`, warn);
    if (fontWeight !== undefined) out.fontWeight = fontWeight;
    const textAlign = resolveMapped(style.textAlignment, TEXT_ALIGN_MAP, `${path}.textAlignment`, warn);
    if (textAlign !== undefined) out.textAlign = textAlign;
    const color = resolveColor(style.textColor, `${path}.textColor`, warn);
    if (color !== undefined) out.color = color;
    return out;
}

function resolveButtonStyleSparse(
    style: ThemeButtonStyle | undefined,
    path: string,
    warn: WarnFn
): ResolvedButtonStyle {
    const out: ResolvedButtonStyle = { container: {}, text: {} };
    if (!style) return out;

    const backgroundColor = resolveColor(style.backgroundColor, `${path}.backgroundColor`, warn);
    if (backgroundColor !== undefined) out.container.backgroundColor = backgroundColor;
    const borderColor = resolveColor(style.borderColor, `${path}.borderColor`, warn);
    if (borderColor !== undefined) out.container.borderColor = borderColor;
    const borderWidth = resolveNonNegativeNumber(style.borderWidth, `${path}.borderWidth`, warn);
    if (borderWidth !== undefined) out.container.borderWidth = borderWidth;
    const borderRadius = resolveNonNegativeNumber(style.borderRadius, `${path}.borderRadius`, warn);
    if (borderRadius !== undefined) out.container.borderRadius = borderRadius;

    out.text = resolveTextStyleSparse(
        {
            fontName: style.fontName,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            textColor: style.textColor,
        },
        path,
        warn
    );
    return out;
}

/**
 * Resolve all buttons of a section with per-property fallback:
 * specific button → buttons.global → (sparse: falls through to the
 * component's base style). Invalid and empty values behave like unset and
 * fall through the same chain.
 */
function resolveButtons<N extends string>(
    buttons: ParsedButtons<N> | undefined,
    names: readonly N[],
    sectionPath: string,
    warn: WarnFn
): Record<N, ResolvedButtonStyle> {
    let globalSparse = resolveButtonStyleSparse(buttons?.global, `${sectionPath}.global`, warn);
    globalSparse = {
        container: globalSparse.container,
        text: applyFontNameWeightRule(globalSparse.text, `${sectionPath}.global`, warn),
    };

    const out = {} as Record<N, ResolvedButtonStyle>;
    for (const name of names) {
        const specific = resolveButtonStyleSparse(
            buttons?.named[name],
            `${sectionPath}.${name}`,
            warn
        );
        const mergedText = { ...globalSparse.text, ...specific.text };
        out[name] = {
            container: { ...globalSparse.container, ...specific.container },
            text: applyFontNameWeightRule(mergedText, `${sectionPath}.${name}`, warn),
        };
    }
    return out;
}

/**
 * Sanitize a themed button order into a full permutation of the section's
 * button names: named buttons first (duplicates: first occurrence wins,
 * unknown names skipped — both warned), then unlisted names in default order.
 */
function sanitizeOrder<N extends string>(
    order: readonly string[] | undefined,
    names: readonly N[],
    path: string,
    warn: WarnFn
): N[] {
    if (order === undefined) return [...names];

    const valid = new Set<string>(names);
    const seen = new Set<N>();
    const result: N[] = [];
    for (const raw of order) {
        if (!valid.has(raw)) {
            warn(`theme: ${path} contains unknown button "${raw}" — skipping`);
            continue;
        }
        const name = raw as N;
        if (seen.has(name)) {
            warn(`theme: ${path} contains duplicate button "${raw}" — first occurrence wins`);
            continue;
        }
        seen.add(name);
        result.push(name);
    }
    for (const name of names) {
        if (!seen.has(name)) result.push(name);
    }
    return result;
}

function resolveLogo<N extends string>(
    section: ParsedSection<N>,
    path: string,
    warn: WarnFn
): ResolvedLogo | undefined {
    const alignment =
        resolveMapped(section.logoAlignment, LOGO_ALIGNMENT_MAP, `${path}.logoAlignment`, warn) ??
        "center";

    // Precedence: local/bundled logoImage → remote logoUrl → no logo.
    const image = section.logoImage;
    if (typeof image === "number") {
        return { source: image, remote: false, alignment };
    }
    if (typeof image === "string" && image.trim() !== "") {
        return { source: { uri: image.trim() }, remote: false, alignment };
    }
    if (!isUnsetString(section.logoUrl)) {
        return { source: { uri: section.logoUrl.trim() }, remote: true, alignment };
    }
    return undefined;
}

function resolveBannerTheme(banner: ParsedBanner | undefined, warn: WarnFn): ResolvedBannerTheme {
    const out: ResolvedBannerTheme = {
        summaryDescription: applyFontNameWeightRule(
            resolveTextStyleSparse(banner?.summaryDescription, "banner.summary.description", warn),
            "banner.summary.description",
            warn
        ),
        buttons: resolveButtons(banner?.buttons, BANNER_BUTTON_NAMES, "banner.buttons", warn),
        buttonOrder: sanitizeOrder(banner?.buttons?.order, BANNER_BUTTON_NAMES, "banner.buttons.order", warn),
    };
    if (!banner) return out;

    const logo = resolveLogo(banner, "banner", warn);
    if (logo !== undefined) out.logo = logo;
    const backgroundColor = resolveColor(banner.backgroundColor, "banner.backgroundColor", warn);
    if (backgroundColor !== undefined) out.backgroundColor = backgroundColor;
    const separatorColor = resolveColor(banner.separatorColor, "banner.separatorColor", warn);
    if (separatorColor !== undefined) out.separatorColor = separatorColor;
    const overlayColor = resolveColor(banner.overlayColor, "banner.overlayColor", warn);
    if (overlayColor !== undefined) out.overlayColor = overlayColor;
    return out;
}

function resolveModalTheme(modal: ParsedModal | undefined, warn: WarnFn): ResolvedModalTheme {
    const out: ResolvedModalTheme = {
        presentationStyle:
            resolveMapped(modal?.presentationStyle, PRESENTATION_STYLE_MAP, "modal.presentationStyle", warn) ??
            "card",
        summaryTitle: applyFontNameWeightRule(
            resolveTextStyleSparse(modal?.summaryTitle, "modal.summary.title", warn),
            "modal.summary.title",
            warn
        ),
        summaryDescription: applyFontNameWeightRule(
            resolveTextStyleSparse(modal?.summaryDescription, "modal.summary.description", warn),
            "modal.summary.description",
            warn
        ),
        categories: {
            title: applyFontNameWeightRule(
                resolveTextStyleSparse(modal?.categories?.title, "modal.categories.title", warn),
                "modal.categories.title",
                warn
            ),
            description: applyFontNameWeightRule(
                resolveTextStyleSparse(modal?.categories?.description, "modal.categories.description", warn),
                "modal.categories.description",
                warn
            ),
        },
        buttons: resolveButtons(modal?.buttons, MODAL_BUTTON_NAMES, "modal.buttons", warn),
        buttonOrder: sanitizeOrder(modal?.buttons?.order, MODAL_BUTTON_NAMES, "modal.buttons.order", warn),
    };
    if (!modal) return out;

    const logo = resolveLogo(modal, "modal", warn);
    if (logo !== undefined) out.logo = logo;
    const backgroundColor = resolveColor(modal.backgroundColor, "modal.backgroundColor", warn);
    if (backgroundColor !== undefined) out.backgroundColor = backgroundColor;
    const separatorColor = resolveColor(modal.separatorColor, "modal.separatorColor", warn);
    if (separatorColor !== undefined) out.separatorColor = separatorColor;
    const overlayColor = resolveColor(modal.overlayColor, "modal.overlayColor", warn);
    if (overlayColor !== undefined) out.overlayColor = overlayColor;
    const toggleOnColor = resolveColor(modal.categories?.toggleOnColor, "modal.categories.toggleOnColor", warn);
    if (toggleOnColor !== undefined) out.categories.toggleOnColor = toggleOnColor;
    const toggleOffColor = resolveColor(modal.categories?.toggleOffColor, "modal.categories.toggleOffColor", warn);
    if (toggleOffColor !== undefined) out.categories.toggleOffColor = toggleOffColor;
    const categorySeparatorColor = resolveColor(
        modal.categories?.separatorColor,
        "modal.categories.separatorColor",
        warn
    );
    if (categorySeparatorColor !== undefined) out.categories.separatorColor = categorySeparatorColor;
    return out;
}

/**
 * Resolve a parsed theme into sparse style overrides. Value-level problems
 * are reported through `onWarn` and fall through to defaults — they never
 * break the UI.
 */
export function resolveTheme(theme: ParsedTheme | undefined, onWarn?: WarnFn): ResolvedTheme {
    const warn = onWarn ?? noopWarn;
    if (theme && (theme.banner !== undefined || theme.modal !== undefined)) {
        warn("theme: themed UI is light-mode based; system dark-mode/appearance settings are ignored");
    }
    return {
        banner: resolveBannerTheme(theme?.banner, warn),
        modal: resolveModalTheme(theme?.modal, warn),
    };
}

// ---------------------------------------------------------------------------
// Render-time helpers
// ---------------------------------------------------------------------------

/**
 * Filter a sanitized button order down to the buttons the remote config
 * shows. Which buttons appear is never theme-controlled: the theme only
 * orders and styles buttons the remote config enables. Hidden names are
 * reported through `onSkip`.
 */
export function orderVisibleButtons<N extends string>(
    order: readonly N[],
    visible: Record<N, boolean>,
    onSkip?: (name: N) => void
): N[] {
    const result: N[] = [];
    for (const name of order) {
        if (visible[name]) {
            result.push(name);
        } else {
            onSkip?.(name);
        }
    }
    return result;
}

/**
 * Base text styles that bake in a lineHeight would clip a themed, larger
 * fontSize. When (and only when) fontSize is themed, emit a proportionally
 * scaled lineHeight; otherwise return the style unchanged so the default
 * rendering stays untouched.
 */
export function withScaledLineHeight(
    style: ResolvedTextStyle,
    baseFontSize: number,
    baseLineHeight: number
): ResolvedTextStyle {
    if (style.fontSize === undefined) return style;
    return {
        ...style,
        lineHeight: Math.round((style.fontSize * baseLineHeight) / baseFontSize),
    };
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const key of Object.keys(value as object)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
    }
    return value;
}

/**
 * The resolved form of "no theme": all overrides sparse/empty, default
 * button orders, card presentation. Shared stable reference for unthemed
 * renders.
 */
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = deepFreeze(resolveTheme(undefined));
