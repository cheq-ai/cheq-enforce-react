import React, { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import type { ResolvedLogo, ThemeLogoAlignment } from "./ThemeTypes";

export interface ConsentLogoProps {
    logo: ResolvedLogo;
}

/** Logo height in device-independent units. */
const LOGO_HEIGHT = 40;

/** Give up on a remote logo after this long and render nothing. */
const REMOTE_SIZE_TIMEOUT_MS = 3000;

const ALIGN_ITEMS: Record<ThemeLogoAlignment, "flex-start" | "center" | "flex-end" | "stretch"> = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
    full: "stretch",
};

interface SizeState {
    aspectRatio: number | null;
    failed: boolean;
}

/**
 * Renders a themed logo: 40 units tall, aspect-fit, never overflowing its
 * container. "full" alignment spans the container width. Any failure to
 * load or measure the image silently renders nothing — a broken logo must
 * never break the consent UI, and no layout space is reserved for it.
 */
export function ConsentLogo({ logo }: ConsentLogoProps) {
    // left/center/right need the intrinsic aspect ratio so the image frame
    // hugs the logo and alignment is visually correct; "full" does not.
    const needsSize = logo.alignment !== "full";
    const [{ aspectRatio, failed }, setState] = useState<SizeState>({
        aspectRatio: null,
        failed: false,
    });

    useEffect(() => {
        let done = false;
        setState({ aspectRatio: null, failed: false });
        if (!needsSize) return;

        if (typeof logo.source === "number") {
            // Bundled require() asset — resolvable synchronously.
            const resolved = Image.resolveAssetSource(logo.source);
            if (resolved && resolved.width > 0 && resolved.height > 0) {
                setState({ aspectRatio: resolved.width / resolved.height, failed: false });
            } else {
                setState({ aspectRatio: null, failed: true });
            }
            return;
        }

        const timeout = setTimeout(() => {
            if (!done) {
                done = true;
                setState({ aspectRatio: null, failed: true });
            }
        }, REMOTE_SIZE_TIMEOUT_MS);

        Image.getSize(
            logo.source.uri,
            (width, height) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                if (width > 0 && height > 0) {
                    setState({ aspectRatio: width / height, failed: false });
                } else {
                    setState({ aspectRatio: null, failed: true });
                }
            },
            () => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                setState({ aspectRatio: null, failed: true });
            }
        );

        return () => {
            done = true;
            clearTimeout(timeout);
        };
    }, [logo, needsSize]);

    if (failed) return null;

    const handleError = () => setState({ aspectRatio: null, failed: true });

    if (logo.alignment === "full") {
        return (
            <View style={[styles.container, { alignItems: ALIGN_ITEMS.full }]}>
                <Image
                    source={logo.source}
                    style={styles.fullImage}
                    resizeMode="contain"
                    onError={handleError}
                />
            </View>
        );
    }

    // Render nothing until the size is known (remote logos appear once
    // loaded; this is the silent fallback when they never do).
    if (aspectRatio === null) return null;

    return (
        <View style={[styles.container, { alignItems: ALIGN_ITEMS[logo.alignment] }]}>
            <Image
                source={logo.source}
                style={[styles.image, { aspectRatio }]}
                resizeMode="contain"
                onError={handleError}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: LOGO_HEIGHT,
        justifyContent: "center",
    },
    image: {
        height: LOGO_HEIGHT,
        maxWidth: "100%",
    },
    fullImage: {
        width: "100%",
        height: LOGO_HEIGHT,
    },
});
