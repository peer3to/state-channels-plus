import ScaleReader, { encodeCompact } from "./ScaleReader";
import type { SubstrateHeaderJson } from "../../lightClientWire";
import StorageProofError from "../StorageProofError";
import { blake2b } from "@noble/hashes/blake2b";
import { concat, dataLength, getBytes, hexlify } from "ethers";

/** The digest item kind of a consensus log, and Frontier's engine id, "fron". */
const FRONTIER_CONSENSUS_LOG = "0x0466726f6e";
/** Frontier post-log variants that start with the Ethereum block hash. */
const HASHES_LOG = 1;
const BLOCK_HASH_LOG = 3;
const HASH_LENGTH = 32;

/**
 * A Substrate block header of a Frontier chain: the block's hash, the state
 * root storage proofs are checked against, and the hash of the Ethereum block
 * the runtime built in it.
 */
export default class SubstrateHeader {
    readonly number: number;
    /** The hash of the block before this one. */
    readonly parentHash: string;
    readonly stateRoot: string;
    /** Blake2-256 of the SCALE-encoded header. */
    readonly hash: string;
    private readonly digestLogs: string[];

    constructor(header: SubstrateHeaderJson) {
        this.number = Number(header.number);
        this.parentHash = header.parentHash.toLowerCase();
        this.stateRoot = header.stateRoot;
        this.digestLogs = header.digest.logs;
        for (const root of [
            header.parentHash,
            header.stateRoot,
            header.extrinsicsRoot
        ])
            if (dataLength(root) !== HASH_LENGTH)
                throw new StorageProofError(
                    "A header hash is not 32 bytes long"
                );
        const encodedHeader = concat([
            header.parentHash,
            encodeCompact(this.number),
            header.stateRoot,
            header.extrinsicsRoot,
            encodeCompact(this.digestLogs.length),
            ...this.digestLogs
        ]);
        this.hash = hexlify(
            blake2b(getBytes(encodedHeader), { dkLen: HASH_LENGTH })
        );
    }

    /**
     * The hash of the Ethereum block of this Substrate block, which Frontier
     * writes into the header digest. Throws {@link StorageProofError} when
     * the digest does not hold exactly one such log.
     */
    ethereumBlockHash(): string {
        const frontierLogs = this.digestLogs.filter((log) =>
            log.toLowerCase().startsWith(FRONTIER_CONSENSUS_LOG)
        );
        if (frontierLogs.length !== 1)
            throw new StorageProofError(
                `The header digest holds ${frontierLogs.length} Frontier logs`
            );
        const reader = new ScaleReader(
            getBytes(frontierLogs[0]),
            "A header digest log"
        );
        reader.take(dataLength(FRONTIER_CONSENSUS_LOG));
        const postLog = new ScaleReader(
            reader.take(reader.readCompactLength()),
            "A header digest log"
        );
        const variant = postLog.readByte();
        if (variant !== HASHES_LOG && variant !== BLOCK_HASH_LOG)
            throw new StorageProofError(
                "The header's Frontier log holds no block hash"
            );
        return hexlify(postLog.take(HASH_LENGTH));
    }
}
