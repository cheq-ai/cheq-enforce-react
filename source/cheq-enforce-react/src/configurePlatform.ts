import type { EnforceConfig } from "./Types";
import { log } from "./logger";

const PROD_BOOTSTRAP_HOST = "https://nexus.ensighten.com";
const TEST_BOOTSTRAP_HOST = "https://nexus-test.ensighten.com";

let injectedScriptSrc: string | null = null;

function buildBootstrapScriptUrl(config: EnforceConfig): string | null {
    const { clientName, publishPath } = config;

    if (!clientName || !publishPath) {
        log(
            config.debug,
            "web configure skipped: clientName and publishPath are required to inject Bootstrap.js"
        );
        return null;
    }

    const host = config.debug ? TEST_BOOTSTRAP_HOST : PROD_BOOTSTRAP_HOST;
    return `${host}/${encodeURIComponent(clientName)}/${encodeURIComponent(publishPath)}/Bootstrap.js`;
}

export function injectCheqBootstrapScript(config: EnforceConfig): void {
    if (typeof document === "undefined" || !document.head) {
        log(config.debug, "web configure skipped: document.head is not available");
        return;
    }

    const scriptSrc = buildBootstrapScriptUrl(config);
    if (!scriptSrc) {
        return;
    }

    if (injectedScriptSrc === scriptSrc) {
        log(config.debug, "Bootstrap.js already injected", scriptSrc);
        return;
    }

    const existingScript =
        Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
            .find((el) => el.src === scriptSrc) ?? null;

    if (existingScript) {
        injectedScriptSrc = scriptSrc;
        log(config.debug, "Bootstrap.js already present in document", scriptSrc);
        return;
    }

    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = false;
    script.onload = () => log(config.debug, "Bootstrap.js loaded", scriptSrc);
    script.onerror = () => log(config.debug, "Bootstrap.js failed to load", scriptSrc);

    document.head.appendChild(script);
    injectedScriptSrc = scriptSrc;
    log(config.debug, "Bootstrap.js injected", scriptSrc);
}

export async function configurePlatform(config: EnforceConfig): Promise<boolean> {
    injectCheqBootstrapScript(config);
    return true;
}
