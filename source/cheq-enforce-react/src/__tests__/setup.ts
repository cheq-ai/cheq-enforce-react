// happy-dom reads --localstorage-file from process.argv, producing a broken
// localStorage when no path is provided. Override with a reliable in-memory
// implementation before any test module is loaded.
function makeStorage(): Storage {
    const store = new Map<string, string>();
    return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
    } as Storage;
}

Object.defineProperty(globalThis, 'localStorage', {
    value: makeStorage(),
    writable: true,
    configurable: true,
});
