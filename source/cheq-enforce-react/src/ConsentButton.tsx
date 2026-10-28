import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type { ResolvedButtonStyle } from "./ThemeTypes";

export type ConsentButtonRole = "primary" | "secondary" | "textOnly";

/** How the banner and modal describe each of their buttons before rendering. */
export interface ButtonDescriptor {
    role: ConsentButtonRole;
    label: string;
    onPress: () => void | Promise<void>;
    accessibilityLabel?: string;
}

export interface ConsentButtonProps {
    label: string;
    /** Selects the base (default) appearance of the button. */
    role: ConsentButtonRole;
    /** Sparse theme overrides layered on top of the base appearance. */
    themed?: ResolvedButtonStyle;
    disabled: boolean;
    onPress: () => void;
    accessibilityLabel?: string;
}

const EMPTY_THEMED: ResolvedButtonStyle = { container: {}, text: {} };

/**
 * Shared consent-UI button. The base styles are the framework defaults; the
 * optional `themed` overrides contain only properties the integrator set, so
 * an unthemed button renders exactly as before.
 */
export function ConsentButton({
    label,
    role,
    themed = EMPTY_THEMED,
    disabled,
    onPress,
    accessibilityLabel,
}: ConsentButtonProps) {
    const containerBase =
        role === "textOnly"
            ? [styles.closeButton]
            : [styles.button, role === "primary" ? styles.primaryButton : styles.secondaryButton];
    const textBase =
        role === "primary"
            ? styles.primaryButtonText
            : role === "secondary"
              ? styles.secondaryButtonText
              : styles.closeButtonText;

    return (
        <Pressable
            style={({ pressed }) => [
                ...containerBase,
                themed.container,
                pressed && !disabled && styles.buttonPressed,
            ]}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
        >
            <Text style={[textBase, themed.text]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: "center",
    },
    buttonPressed: {
        opacity: 0.7,
    },
    primaryButton: {
        backgroundColor: "#1a73e8",
    },
    primaryButtonText: {
        color: "#fff",
        fontWeight: "600",
        fontSize: 15,
    },
    secondaryButton: {
        backgroundColor: "#f0f0f0",
    },
    secondaryButtonText: {
        color: "#333",
        fontWeight: "500",
        fontSize: 15,
    },
    closeButton: {
        alignItems: "center",
        paddingVertical: 8,
    },
    closeButtonText: {
        color: "#888",
        fontSize: 13,
    },
});
