/**
 * 16 random hex digits from the platform CSPRNG. `randomUUID` needs a secure context, and this is
 * browser-compiled.
 */
export function randomHexId(): string {
    return Array.from(
        globalThis.crypto.getRandomValues(new Uint8Array(8)),
        (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
}
