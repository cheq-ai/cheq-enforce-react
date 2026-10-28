/**
 * SDK version, injected at build time from package.json via tsup `define`
 * (mirrored in vitest.config.ts). Falls back to "0.0.0" if the define is
 * missing, which signals a build misconfiguration.
 */
export const SDK_VERSION: string =
    typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "0.0.0";

export const SDK_PLATFORM = "react";

/**
 * Combined version reported in the `gateway` field of reporting beacons:
 * (gateway-version)-(sdk-platform)-(sdk-version), e.g. "2.3.802-react-0.2.0".
 */
export function buildGatewayVersion(remoteVersion: string): string {
    return `${remoteVersion}-${SDK_PLATFORM}-${SDK_VERSION}`;
}