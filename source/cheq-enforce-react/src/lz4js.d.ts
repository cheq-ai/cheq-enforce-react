declare module "lz4js" {
    export function compressBound(n: number): number;
    export function makeBuffer(size: number): Uint8Array;
    export function compressBlock(
        src: Uint8Array,
        dst: Uint8Array,
        sIndex: number,
        sLength: number,
        hashTable: Uint32Array
    ): number;
}
