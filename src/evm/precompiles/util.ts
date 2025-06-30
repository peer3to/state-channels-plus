export function to32Bytes(n: number): Uint8Array {
    const buf = Buffer.alloc(32);
    buf.writeUInt32BE(n, 28);
    return new Uint8Array(buf);
}
