// ---------------------------------------------------------------------------
// Public theme input types
//
// These mirror the theme JSON format exactly. Every key is
// optional; `{}` is a valid theme that renders entirely with defaults.
// ---------------------------------------------------------------------------

export type ThemeFontWeight = "regular" | "medium" | "semibold" | "bold";

export type ThemeTextAlignment =
    | "left"
    | "center"
    | "right"
    | "justified"
    | "natural";

export type ThemeLogoAlignment = "left" | "center" | "right" | "full";

export type ModalPresentationStyle = "card" | "fullScreen";

export type BannerButtonName = "acceptAll" | "rejectAll" | "openModal" | "close";

export type ModalButtonName = "acceptAll" | "rejectAll" | "save" | "close";

export interface ThemeTextStyle {
    /** Platform font name. On RN this maps to `fontFamily`. */
    fontName?: string;
    fontSize?: number;
    /** Applies only when no custom `fontName` is set (a named font carries its own weight). */
    fontWeight?: ThemeFontWeight;
    textAlignment?: ThemeTextAlignment;
    /** Hex color: #RGB, #RRGGBB, or #RRGGBBAA (alpha last); leading # optional. */
    textColor?: string;
}

export interface ThemeButtonStyle {
    backgroundColor?: string;
    textColor?: string;
    fontName?: string;
    fontSize?: number;
    fontWeight?: ThemeFontWeight;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
}

export interface BannerButtonsTheme {
    /** Named buttons render first, in order; unlisted buttons follow in default order. */
    order?: BannerButtonName[];
    acceptAll?: ThemeButtonStyle;
    rejectAll?: ThemeButtonStyle;
    openModal?: ThemeButtonStyle;
    close?: ThemeButtonStyle;
    /** Per-property fallback for all banner buttons. */
    global?: ThemeButtonStyle;
}

export interface ModalButtonsTheme {
    order?: ModalButtonName[];
    acceptAll?: ThemeButtonStyle;
    rejectAll?: ThemeButtonStyle;
    save?: ThemeButtonStyle;
    close?: ThemeButtonStyle;
    global?: ThemeButtonStyle;
}

export interface EnforceBannerTheme {
    /** Remote logo URL (raster recommended). */
    logoUrl?: string;
    /**
     * Local/bundled logo. A string is treated as a native bundled-asset name
     * (Xcode asset catalog / Android drawable); a number is a `require()` result.
     */
    logoImage?: string | number;
    logoAlignment?: ThemeLogoAlignment;
    backgroundColor?: string;
    /** When set, a divider is drawn between the banner text and the buttons. */
    separatorColor?: string;
    overlayColor?: string;
    summary?: {
        description?: ThemeTextStyle;
    };
    buttons?: BannerButtonsTheme;
}

export interface EnforceModalTheme {
    presentationStyle?: ModalPresentationStyle;
    logoUrl?: string;
    logoImage?: string | number;
    logoAlignment?: ThemeLogoAlignment;
    backgroundColor?: string;
    /** When set, a divider is drawn underneath the modal description. */
    separatorColor?: string;
    /** Not visible when `presentationStyle` is "fullScreen". */
    overlayColor?: string;
    summary?: {
        title?: ThemeTextStyle;
        description?: ThemeTextStyle;
    };
    buttons?: ModalButtonsTheme;
    categories?: {
        toggleOnColor?: string;
        toggleOffColor?: string;
        /** When set, a divider is drawn between category rows (never after the last one). */
        separatorColor?: string;
        title?: ThemeTextStyle;
        description?: ThemeTextStyle;
    };
}

export interface EnforceTheme {
    banner?: EnforceBannerTheme;
    modal?: EnforceModalTheme;
}

// ---------------------------------------------------------------------------
// Resolved theme types
//
// Output of the theme resolver. All style objects are SPARSE: they contain
// only properties the integrator explicitly and validly set, renamed to their
// React Native equivalents. Components render `[baseStyle, resolvedOverride]`
// so an empty override falls through to the current (default) appearance.
// ---------------------------------------------------------------------------

export interface ResolvedTextStyle {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: "400" | "500" | "600" | "700";
    textAlign?: "left" | "center" | "right" | "justify" | "auto";
    color?: string;
    /** Emitted only when fontSize is themed on a text block whose base style bakes a lineHeight. */
    lineHeight?: number;
}

export interface ResolvedButtonStyle {
    container: {
        backgroundColor?: string;
        borderColor?: string;
        borderWidth?: number;
        borderRadius?: number;
    };
    text: ResolvedTextStyle;
}

export interface ResolvedLogo {
    source: { uri: string } | number;
    /** True when the logo comes from `logoUrl` (needs async size lookup + silent failure). */
    remote: boolean;
    alignment: ThemeLogoAlignment;
}

export interface ResolvedBannerTheme {
    logo?: ResolvedLogo;
    backgroundColor?: string;
    /** Presence means "draw the divider" — the default banner has none. */
    separatorColor?: string;
    overlayColor?: string;
    summaryDescription: ResolvedTextStyle;
    buttons: Record<BannerButtonName, ResolvedButtonStyle>;
    /** Sanitized full permutation of banner button names. Visibility is filtered at render. */
    buttonOrder: BannerButtonName[];
}

export interface ResolvedModalTheme {
    presentationStyle: ModalPresentationStyle;
    logo?: ResolvedLogo;
    backgroundColor?: string;
    /** Presence ⇒ draw a divider under the description; absent ⇒ none. */
    separatorColor?: string;
    overlayColor?: string;
    summaryTitle: ResolvedTextStyle;
    summaryDescription: ResolvedTextStyle;
    categories: {
        toggleOnColor?: string;
        toggleOffColor?: string;
        /** Presence ⇒ draw dividers between category rows; absent ⇒ none. */
        separatorColor?: string;
        title: ResolvedTextStyle;
        description: ResolvedTextStyle;
    };
    buttons: Record<ModalButtonName, ResolvedButtonStyle>;
    buttonOrder: ModalButtonName[];
}

export interface ResolvedTheme {
    banner: ResolvedBannerTheme;
    modal: ResolvedModalTheme;
}
