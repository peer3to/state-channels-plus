import StorageProofError from "../StorageProofError";
import { toBigInt } from "ethers";

/** Reads SCALE-encoded bytes front to back. */
export default class ScaleReader {
    private offset = 0;

    /** `subject` names what is read in the error of a short read, e.g. "A proof node". */
    constructor(
        private readonly data: Uint8Array,
        private readonly subject: string
    ) {}

    get isAtEnd(): boolean {
        return this.offset === this.data.length;
    }

    readByte(): number {
        return this.take(1)[0];
    }

    /** A fixed-width unsigned integer of `length` bytes, which SCALE writes little-endian. */
    readUnsigned(length: number): bigint {
        return toBigInt(this.take(length).slice().reverse());
    }

    take(length: number): Uint8Array {
        const end = this.offset + length;
        if (end > this.data.length)
            throw new StorageProofError(`${this.subject} ends early`);
        const taken = this.data.subarray(this.offset, end);
        this.offset = end;
        return taken;
    }

    /** A SCALE compact length. */
    readCompactLength(): number {
        const first = this.readByte();
        switch (first & 0b11) {
            case 0:
                return first >> 2;
            case 1:
                return (first | (this.readByte() << 8)) >> 2;
            case 2: {
                const rest = this.take(3);
                const value =
                    first | (rest[0] << 8) | (rest[1] << 16) | (rest[2] << 24);
                return value >>> 2;
            }
            default:
                throw new StorageProofError(
                    `${this.subject} has a length nothing can hold`
                );
        }
    }
}

/** The SCALE compact encoding of an unsigned 32-bit integer. */
export function encodeCompact(value: number): Uint8Array {
    if (value < 1 << 6) return new Uint8Array([value << 2]);
    if (value < 1 << 14)
        return new Uint8Array([((value << 2) | 0b01) & 0xff, value >> 6]);
    if (value < 2 ** 30) {
        const encoded = (value << 2) | 0b10;
        return new Uint8Array([
            encoded & 0xff,
            (encoded >>> 8) & 0xff,
            (encoded >>> 16) & 0xff,
            (encoded >>> 24) & 0xff
        ]);
    }
    // big-integer mode: four value bytes follow the mode byte
    return new Uint8Array([
        0b11,
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff
    ]);
}
