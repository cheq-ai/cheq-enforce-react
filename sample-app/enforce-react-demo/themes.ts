import type { EnforceTheme } from "@cheq.ai/cheq-enforce-react";

/**
 * "All Fields" — every theme key populated with a distinct value so the
 * effect of each field is visible. Loaded from enforce_theme.json to
 * demonstrate the JSON-file workflow.
 */
export const ALL_FIELDS_THEME: EnforceTheme = require("./enforce_theme.json");

/**
 * "Cheq Brand" — styled after https://cheq.ai/: CHEQ pink primaries,
 * lavender secondaries, pill buttons, bundled wordmark logo.
 *
 * NOTE: assets/cheq-logo.png is a solid-pink placeholder — replace it with
 * the real CHEQ wordmark PNG.
 */
export const CHEQ_BRAND_THEME: EnforceTheme = {
    banner: {
        logoImage: require("./assets/cheq-logo.png"),
        logoAlignment: "center",
        backgroundColor: "#FFFFFF",
        overlayColor: "#1A1A2E66",
        summary: {
            description: { textColor: "#3D3D5C", textAlignment: "left" },
        },
        buttons: {
            order: ["acceptAll", "rejectAll", "openModal", "close"],
            global: { borderRadius: 24, fontSize: 15 },
            acceptAll: { backgroundColor: "#F8286B", textColor: "#FFFFFF", fontWeight: "semibold" },
            // Same as acceptAll: accept/reject must be equally prominent (GDPR).
            rejectAll: { backgroundColor: "#F8286B", textColor: "#FFFFFF", fontWeight: "semibold" },
            openModal: { backgroundColor: "#EEF0FB", textColor: "#3D3D5C" },
            close: { textColor: "#F8286B" },
        },
    },
    modal: {
        presentationStyle: "card",
        logoImage: require("./assets/cheq-logo.png"),
        logoAlignment: "center",
        backgroundColor: "#FFFFFF",
        // Single divider under the description; no per-category separators.
        separatorColor: "#EEF0FB",
        overlayColor: "#1A1A2E66",
        summary: {
            title: { textColor: "#1A1A2E", textAlignment: "center" },
            description: { textColor: "#3D3D5C", textAlignment: "center" },
        },
        buttons: {
            order: ["acceptAll", "rejectAll", "save", "close"],
            global: { borderRadius: 24, fontSize: 15 },
            acceptAll: { backgroundColor: "#F8286B", textColor: "#FFFFFF", fontWeight: "semibold" },
            // Same as acceptAll: accept/reject must be equally prominent (GDPR).
            rejectAll: { backgroundColor: "#F8286B", textColor: "#FFFFFF", fontWeight: "semibold" },
            save: { backgroundColor: "#EEF0FB", textColor: "#3D3D5C" },
            close: { textColor: "#F8286B" },
        },
        categories: {
            toggleOnColor: "#F8286B",
            title: { textColor: "#1A1A2E" },
            description: { textColor: "#6B6B8D" },
        },
    },
};

/**
 * "All Defaults" — a custom theme with everything empty. Must render
 * identically to using no theme at all.
 */
export const ALL_DEFAULTS_THEME: EnforceTheme = {};

export type ThemeOptionKey = "allFields" | "cheqBrand" | "allDefaults";

export const THEME_OPTIONS: Record<ThemeOptionKey, { label: string; theme: EnforceTheme }> = {
    allFields: { label: "All Fields", theme: ALL_FIELDS_THEME },
    cheqBrand: { label: "Cheq Brand", theme: CHEQ_BRAND_THEME },
    allDefaults: { label: "All Defaults", theme: ALL_DEFAULTS_THEME },
};

export const THEME_OPTION_KEYS: ThemeOptionKey[] = ["allFields", "cheqBrand", "allDefaults"];
