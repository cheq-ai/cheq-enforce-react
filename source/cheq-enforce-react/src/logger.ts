const PREFIX = "[CheqEnforce]";

export function log(debug: boolean | undefined, ...args: unknown[]): void {
    if (debug) {
        console.log(PREFIX, ...args);
    }
}

export function warn(debug: boolean | undefined, ...args: unknown[]): void {
    if (debug) {
        console.warn(PREFIX, ...args);
    }
}
