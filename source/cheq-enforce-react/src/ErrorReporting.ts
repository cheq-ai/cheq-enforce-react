import type { EnforceConfig } from "./Types";
import { log, warn } from "./logger";

const SDK_VERSION = "0.1.0";
const PROD_HOST = "https://nexus.ensighten.com";
const TEST_HOST = "https://nexus-test.ensighten.com";
const ERROR_PATH = "/error/e.gif";
const UNKNOWN_APP_NAME = "UnknownApp";
const UNKNOWN_APP_VERSION = "0";

interface ErrorReportingOptions {
    msg: string;
    fn: string;
    config: Pick<EnforceConfig, "clientName" | "publishPath" | "debug">;
    clientId?: string | null;
}

function truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : value.slice(0, maxLength);
}

const ALLOWED_HOSTS = [PROD_HOST, TEST_HOST] as const;

function getReportingHost(debug: boolean | undefined): string {
    return debug ? TEST_HOST : PROD_HOST;
}

function assertSafeUrl(url: string): void {
    if (!ALLOWED_HOSTS.some(host => url.startsWith(host))) {
        throw new Error("ErrorReporting: URL does not match any allowed host");
    }
}

function getAppInfo(): { appName: string; appVersion: string } {
    const navigatorValue =
        typeof globalThis !== "undefined" && "navigator" in globalThis
            ? globalThis.navigator
            : undefined;

    const appName =
        typeof navigatorValue?.appName === "string" && navigatorValue.appName.trim()
            ? navigatorValue.appName.trim()
            : UNKNOWN_APP_NAME;
    const appVersion =
        typeof navigatorValue?.appVersion === "string" && navigatorValue.appVersion.trim()
            ? navigatorValue.appVersion.trim()
            : UNKNOWN_APP_VERSION;

    return { appName, appVersion };
}

function buildFunctionContext(fn: string, appInfo: { appName: string; appVersion: string }): string {
    const { appName, appVersion } = appInfo;
    return truncate(
        `${fn} | CheqEnforce/${SDK_VERSION} (${appName} ${appVersion})`,
        256
    );
}

function buildReferrer(config: Pick<EnforceConfig, "clientName" | "debug">): string {
    const host = getReportingHost(config.debug);
    return `${host}/privacy/environments/${encodeURIComponent(config.clientName ?? "")}`;
}

function buildUserAgent(appInfo: { appName: string; appVersion: string }): string {
    const { appName, appVersion } = appInfo;
    return `CheqEnforce/${SDK_VERSION} (${appName} ${appVersion})`;
}

function buildErrorUrl(options: ErrorReportingOptions, appInfo: { appName: string; appVersion: string }): string {
    const host = getReportingHost(options.config.debug);
    const params = new URLSearchParams({
        msg: truncate(options.msg, 1024),
        fn: buildFunctionContext(options.fn, appInfo),
        client: truncate(options.config.clientName ?? "", 256),
        publishPath: truncate(options.config.publishPath ?? "", 256),
        errorName: "SDKError",
    });

    if (options.clientId && options.clientId.trim()) {
        params.set("cid", truncate(options.clientId.trim(), 256));
    }

    return `${host}${ERROR_PATH}?${params.toString()}`;
}

async function sendWithHeaders(url: string, config: ErrorReportingOptions["config"], appInfo: { appName: string; appVersion: string }): Promise<boolean> {
    assertSafeUrl(url);
    const response = await fetch(url, {
        method: "GET",
        headers: {
            Referer: buildReferrer(config),
            "User-Agent": buildUserAgent(appInfo),
        },
    });

    return response.ok;
}

async function sendWithoutHeaders(url: string): Promise<boolean> {
    assertSafeUrl(url);
    const response = await fetch(url, { method: "GET" });
    return response.ok;
}

export async function sendError(options: ErrorReportingOptions): Promise<boolean> {
    try {
        const appInfo = getAppInfo();
        const url = buildErrorUrl(options, appInfo);
        log(
            options.config.debug,
            "[CheqEnforce] error reporting beacon →",
            url
        );

        try {
            const ok = await sendWithHeaders(url, options.config, appInfo);
            if (!ok) {
                warn(options.config.debug, "error reporting beacon failed", url);
            }
            return ok;
        } catch (headerError) {
            log(
                options.config.debug,
                "error reporting with headers failed, retrying without headers",
                headerError
            );

            const ok = await sendWithoutHeaders(url);
            if (!ok) {
                warn(options.config.debug, "error reporting beacon failed", url);
            }
            return ok;
        }
    } catch (error) {
        warn(options.config.debug, "error reporting failed", error);
        return false;
    }
}
