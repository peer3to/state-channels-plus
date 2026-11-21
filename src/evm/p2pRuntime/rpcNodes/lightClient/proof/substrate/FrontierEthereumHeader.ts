import ScaleReader from "./ScaleReader";
import StorageProofError from "../StorageProofError";
import { encodeRlp, hexlify, keccak256, toBeArray } from "ethers";

const HASH_LENGTH = 32;
const ADDRESS_LENGTH = 20;
const BLOOM_LENGTH = 256;
const U256_LENGTH = 32;
const U64_LENGTH = 8;
const NONCE_LENGTH = 8;

/**
 * The header of the Ethereum block a Frontier runtime built, read from the
 * start of pallet-ethereum's `CurrentBlock` entry. The entry's transactions
 * follow the header and are not read.
 */
export default class FrontierEthereumHeader {
    readonly beneficiary: string;
    readonly difficulty: bigint;
    readonly number: bigint;
    readonly gasLimit: bigint;
    /** Milliseconds: the runtime's own clock, which the block's Ethereum view rounds down to seconds. */
    readonly timestampMs: bigint;
    readonly mixHash: string;
    /** Keccak-256 of the RLP-encoded header: the Ethereum block hash. */
    readonly hash: string;

    /** `encodedBlock` is the SCALE-encoded `CurrentBlock` entry. */
    constructor(encodedBlock: Uint8Array) {
        const reader = new ScaleReader(encodedBlock, "An Ethereum block");
        const parentHash = reader.take(HASH_LENGTH);
        const ommersHash = reader.take(HASH_LENGTH);
        const beneficiary = reader.take(ADDRESS_LENGTH);
        const stateRoot = reader.take(HASH_LENGTH);
        const transactionsRoot = reader.take(HASH_LENGTH);
        const receiptsRoot = reader.take(HASH_LENGTH);
        const logsBloom = reader.take(BLOOM_LENGTH);
        this.difficulty = reader.readUnsigned(U256_LENGTH);
        this.number = reader.readUnsigned(U256_LENGTH);
        this.gasLimit = reader.readUnsigned(U256_LENGTH);
        const gasUsed = reader.readUnsigned(U256_LENGTH);
        this.timestampMs = reader.readUnsigned(U64_LENGTH);
        const extraData = reader.take(reader.readCompactLength());
        const mixHash = reader.take(HASH_LENGTH);
        const nonce = reader.take(NONCE_LENGTH);
        this.beneficiary = hexlify(beneficiary);
        this.mixHash = hexlify(mixHash);
        this.hash = keccak256(
            encodeRlp([
                parentHash,
                ommersHash,
                beneficiary,
                stateRoot,
                transactionsRoot,
                receiptsRoot,
                logsBloom,
                // an integer as RLP holds it: big-endian without leading
                // zeros, empty for zero
                toBeArray(this.difficulty),
                toBeArray(this.number),
                toBeArray(this.gasLimit),
                toBeArray(gasUsed),
                toBeArray(this.timestampMs),
                extraData,
                mixHash,
                nonce
            ])
        );
    }

    /** Throws {@link StorageProofError} unless this is the header of the block `ethereumBlockHash` names. */
    assertHash(ethereumBlockHash: string): void {
        if (this.hash !== ethereumBlockHash.toLowerCase())
            throw new StorageProofError(
                `The proven Ethereum block is ${this.hash}, not the header's block ${ethereumBlockHash}`
            );
    }
}
