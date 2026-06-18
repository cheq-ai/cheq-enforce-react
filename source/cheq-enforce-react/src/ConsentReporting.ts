import { compressBlock, compressBound, makeBuffer } from "lz4js";
import type { EnforceConfig, RemoteConfig } from "./Types";
import { sendError } from "./ErrorReporting";
import { log, warn } from "./logger";

export type ReportingBeaconType = "billing" | "consent";
export type ReportingFlags = Record<string, boolean>;

interface ReportingSendOptions {
    config: EnforceConfig;
    remoteConfig: RemoteConfig | null;
    type: ReportingBeaconType;
    requestTimestamp?: number;
    cookieFlags?: ReportingFlags;
    eventFlags?: ReportingFlags;
}

interface ReportingContext {
    clientId: string;
    version: string;
    enforcement: boolean;
}

interface BillingRequestPayload {
    destination: string;
    type: "billing";
    start: number;
    end: -1;
    source: string;
    status: string;
    reasons: unknown[];
    dataPatterns: unknown[];
    list: unknown[];
    id: number;
}

interface BillingPayload {
    requests: BillingRequestPayload[];
    mode: "enforce" | "observe";
    environment: string;
    documentReferrer: string;
    publishPath: string;
    clientId: string;
    instanceId: string;
    version: "1.0.0";
    gateway: string;
    cookies: Record<string, string>;
    packet: 0;
}

interface ConsentEventPayload {
    event: "cookieChanged";
    dt: number;
    [flag: string]: string | number;
}

interface ConsentPayload {
    version: "1.0.0";
    gateway: string;
    clientId: string;
    clientName: string;
    publishPath: string;
    mode: "whitelist" | "blacklist";
    cookies: Record<string, string>;
    dt: number;
    settings: {
        modal: "enterprise";
        environment: string;
        defaults: Record<string, number>;
    };
    events: ConsentEventPayload[];
}

const REPORTING_HOST = "https://data.privacy.ensighten.com";
const REPORTING_PLATFORM = "react_native_sdk";
const REPORTING_SDK_VERSION = "0.0.1";
const LZ4_HASH_TABLE_SIZE = 1 << 16;

let billingSent = false;
let consentBeaconCount = 0;
let storedCookieFlags: ReportingFlags = {};

function now(): number {
    return Date.now();
}

function createInstanceId(): string {
    // instanceId is a short-lived telemetry correlation token, not a security credential.
    // Cryptographic randomness is not required — Math.random() matches the format
    // expected by the reporting backend (base-36 encoded integer).
    // orca-ignore
    return ((268435456 * (1 + Math.random())) | 0).toString(36);
}

let instanceId = createInstanceId();

export function resetReportingState(): void {
    billingSent = false;
    consentBeaconCount = 0;
    storedCookieFlags = {};
    instanceId = createInstanceId();
}

function toNumericFlags(flags?: ReportingFlags): Record<string, number> {
    if (!flags) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(flags).map(([key, value]) => [key, value ? 1 : 0])
    );
}

function toCookieName(clientName: string, flag: string): string {
    return `${clientName.toUpperCase()}_ENSIGHTEN_PRIVACY_${flag}`;
}

export function createLiteralOnlyLz4Block(input: Uint8Array): Uint8Array {
    const output: number[] = [];
    let literalLength = input.length;

    if (literalLength < 15) {
        output.push(literalLength << 4);
    } else {
        output.push(15 << 4);
        literalLength -= 15;
        while (literalLength >= 255) {
            output.push(255);
            literalLength -= 255;
        }
        output.push(literalLength);
    }

    for (const byte of input) {
        output.push(byte);
    }

    return Uint8Array.from(output);
}

function compressRawLz4(input: Uint8Array): Uint8Array {
    const output = makeBuffer(compressBound(input.length));
    const hashTable = new Uint32Array(LZ4_HASH_TABLE_SIZE);
    const size = compressBlock(input, output, 0, input.length, hashTable);

    if (size <= 0) {
        return createLiteralOnlyLz4Block(input);
    }

    return output.slice(0, size);
}

function toBase64(input: Uint8Array): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let output = "";

    for (let index = 0; index < input.length; index += 3) {
        const byte1 = input[index] ?? 0;
        const byte2 = input[index + 1] ?? 0;
        const byte3 = input[index + 2] ?? 0;
        const combined = (byte1 << 16) | (byte2 << 8) | byte3;

        output += chars[(combined >> 18) & 63];
        output += chars[(combined >> 12) & 63];
        output += index + 1 < input.length ? chars[(combined >> 6) & 63] : "=";
        output += index + 2 < input.length ? chars[combined & 63] : "=";
    }

    return output;
}

function toBase64Url(input: Uint8Array): string {
    return toBase64(input)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function buildReportingContext(
    config: EnforceConfig,
    remoteConfig: RemoteConfig | null
): ReportingContext | null {
    if (!remoteConfig?.clientId || !remoteConfig.version || typeof remoteConfig.enforcement !== "boolean") {
        warn(
            config.debug,
            "reporting skipped: remote config is missing clientId, version, or enforcement",
            remoteConfig
        );
        return null;
    }

    return {
        clientId: remoteConfig.clientId,
        version: remoteConfig.version,
        enforcement: remoteConfig.enforcement,
    };
}

function buildBillingPayload(
    config: EnforceConfig,
    context: ReportingContext,
    requestTimestamp: number
): BillingPayload {
    return {
        requests: [
            {
                destination: "",
                type: "billing",
                start: requestTimestamp,
                end: -1,
                source: "",
                status: "",
                reasons: [],
                dataPatterns: [],
                list: [],
                id: requestTimestamp,
            },
        ],
        mode: context.enforcement ? "enforce" : "observe",
        environment: config.environment,
        documentReferrer: "",
        publishPath: config.publishPath,
        clientId: context.clientId,
        instanceId,
        version: "1.0.0",
        gateway: context.version,
        cookies: Object.fromEntries(
            Object.entries(storedCookieFlags).map(([flag, value]) => [
                toCookieName(config.clientName, flag),
                value ? "1" : "0",
            ])
        ),
        packet: 0,
    };
}

function buildConsentPayload(
    config: EnforceConfig,
    context: ReportingContext,
    eventFlags?: ReportingFlags
): ConsentPayload {
    const cookies = Object.fromEntries(
        Object.entries(storedCookieFlags).map(([flag, value]) => [
            toCookieName(config.clientName, flag),
            value ? "1" : "0",
        ])
    );

    const eventTimestamp = now();
    const events = Object.entries(eventFlags ?? {}).map(([key, value]) => ({
        event: "cookieChanged" as const,
        dt: eventTimestamp,
        [key]: value ? "1" : "0",
    }));

    return {
        version: "1.0.0",
        gateway: context.version,
        clientId: context.clientId,
        clientName: config.clientName,
        publishPath: config.publishPath,
        mode: context.enforcement ? "whitelist" : "blacklist",
        cookies,
        dt: eventTimestamp,
        settings: {
            modal: "enterprise",
            environment: config.environment,
            defaults: toNumericFlags(config.defaultConsent),
        },
        events,
    };
}

function buildBeaconPath(type: ReportingBeaconType): string {
    return type === "billing" ? "/privacy/v1/b/b.rnc" : "/privacy/v1/c/b.rnc";
}

function buildBeaconCount(type: ReportingBeaconType): number {
    if (type === "billing") {
        return 0;
    }

    consentBeaconCount += 1;
    return consentBeaconCount;
}

function buildBeaconUrl(
    type: ReportingBeaconType,
    context: ReportingContext,
    payload: object,
    config: EnforceConfig
): string {
    const payloadJson = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const compressedBytes = compressRawLz4(payloadBytes);
    const encodedPayload = toBase64Url(compressedBytes);
    const queryParams = {
        n: String(buildBeaconCount(type)),
        c: context.clientId,
        i: instanceId,
        p: config.publishPath,
        utm_platform: REPORTING_PLATFORM,
        utm_sdk_version: REPORTING_SDK_VERSION,
        s: String(payloadBytes.length),
        d: encodedPayload,
    };

    const query = Object.entries(queryParams)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");

    return `${REPORTING_HOST}${buildBeaconPath(type)}?${query}`;
}

async function dispatchBeacon(config: EnforceConfig, url: string): Promise<void> {
    try {
        const response = await fetch(url, { method: "GET" });

        if (!response.ok) {
            warn(config.debug, "reporting beacon failed", {
                status: response.status,
                url,
            });
            void sendError({
                msg: `Reporting beacon failed with status ${response.status}.`,
                fn: "ConsentReporting.dispatchBeacon.response",
                config,
            });
            return;
        }

        log(config.debug, "reporting beacon sent", url);
    } catch (error) {
        warn(config.debug, "reporting beacon failed", error);
        void sendError({
            msg: error instanceof Error ? error.message : String(error),
            fn: "ConsentReporting.dispatchBeacon.fetch",
            config,
        });
    }
}

export async function sendReportingBeacon(options: ReportingSendOptions): Promise<void> {
    const { config, remoteConfig, type, requestTimestamp, cookieFlags, eventFlags } = options;

    try {
        const context = buildReportingContext(config, remoteConfig);

        if (!context) {
            return;
        }

        if (type === "billing") {
            if (billingSent) {
                log(config.debug, "billing beacon already sent");
                return;
            }

            // Seed storedCookieFlags with existing consent so the billing
            // payload reflects the current consent state on re-launches.
            if (cookieFlags && Object.keys(cookieFlags).length > 0) {
                storedCookieFlags = { ...storedCookieFlags, ...cookieFlags };
            }

            const payload = buildBillingPayload(
                config,
                context,
                requestTimestamp ?? now()
            );
            const url = buildBeaconUrl(type, context, payload, config);
            await dispatchBeacon(config, url);
            billingSent = true;
            return;
        }

        const mergedFlags = {
            ...(cookieFlags ?? {}),
            ...(eventFlags ?? {}),
        };

        if (Object.keys(mergedFlags).length > 0) {
            storedCookieFlags = {
                ...storedCookieFlags,
                ...mergedFlags,
            };
        }

        const payload = buildConsentPayload(config, context, mergedFlags);
        const url = buildBeaconUrl(type, context, payload, config);
        await dispatchBeacon(config, url);
    } catch (error) {
        warn(config.debug, "reporting beacon build failed", error);
        void sendError({
            msg: error instanceof Error ? error.message : String(error),
            fn: `ConsentReporting.sendReportingBeacon.${type}`,
            config,
            clientId: remoteConfig?.clientId,
        });
    }
}
