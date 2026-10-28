/**
 * Minimal react-native stub for component tests.
 *
 * Maps the handful of RN primitives the SDK uses onto DOM elements so
 * components can render under happy-dom with @testing-library/react. It is
 * wired up via `resolve.alias` in vitest.config.ts only — the build is
 * untouched. Flattened styles are serialized into a `data-style` attribute
 * so tests can assert on applied style overrides.
 */
import React from "react";

type AnyProps = Record<string, any>;

export type ModalProps = AnyProps;

function flattenStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>(
            (acc, entry) => ({ ...acc, ...flattenStyle(entry) }),
            {}
        );
    }
    if (typeof style === "object") return style as Record<string, unknown>;
    return {};
}

function domProps({
    style,
    testID,
    accessibilityRole,
    accessibilityLabel,
}: AnyProps): Record<string, unknown> {
    return {
        "data-style": JSON.stringify(flattenStyle(style)),
        ...(testID ? { "data-testid": testID } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
    };
}

export function View(props: AnyProps) {
    return <div {...domProps(props)}>{props.children}</div>;
}

export function Text(props: AnyProps) {
    return <span {...domProps(props)}>{props.children}</span>;
}

export function Modal(props: AnyProps) {
    if (props.visible === false) return null;
    return <div data-rn-modal="true">{props.children}</div>;
}

export function Pressable(props: AnyProps) {
    const style =
        typeof props.style === "function" ? props.style({ pressed: false }) : props.style;
    return (
        <button
            type="button"
            {...domProps({ ...props, style })}
            disabled={props.disabled}
            onClick={props.onPress}
        >
            {props.children}
        </button>
    );
}

export function ScrollView(props: AnyProps) {
    return <div {...domProps(props)}>{props.children}</div>;
}

export function Switch(props: AnyProps) {
    return (
        <input
            type="checkbox"
            {...domProps(props)}
            {...(props.thumbColor !== undefined ? { "data-thumb-color": props.thumbColor } : {})}
            checked={!!props.value}
            onChange={(event) => props.onValueChange?.(event.target.checked)}
        />
    );
}

export const Image = Object.assign(
    (props: AnyProps) => {
        const src =
            typeof props.source === "number" ? `asset-${props.source}` : props.source?.uri;
        return <img {...domProps(props)} src={src} alt="" />;
    },
    {
        resolveAssetSource: (source: number) => ({
            width: 120,
            height: 40,
            uri: `asset-${source}`,
        }),
        getSize: (
            _uri: string,
            success: (width: number, height: number) => void,
            _failure?: (error: unknown) => void
        ) => success(120, 40),
    }
);

export const StyleSheet = {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 0.5,
    flatten: flattenStyle,
};

export const Platform = {
    OS: "ios",
    select: <T,>(spec: { ios?: T; android?: T; default?: T }): T | undefined =>
        spec.ios !== undefined ? spec.ios : spec.default,
};
