import { accountCodeKey, systemAccountKey } from "./frontierStateKeys";
import ScaleReader from "./ScaleReader";
import SubstrateTrieProof from "./SubstrateTrieProof";
import AAccountProofVerifier, {
    type ProvenAccount
} from "../AAccountProofVerifier";
import StorageProofError from "../StorageProofError";
import type { Bytes, ChecksumAddress, Hash } from "@/types/types";
import { hexlify, toBigInt } from "ethers";

const U32_LENGTH = 4;
const U128_LENGTH = 16;
/** `AccountInfo`: nonce and three reference counts, then four balances. */
const ACCOUNT_INFO_LENGTH = 4 * U32_LENGTH + 4 * U128_LENGTH;

/** A SCALE fixed-width unsigned integer, which is little-endian. */
function readUnsigned(reader: ScaleReader, length: number): bigint {
    return toBigInt(reader.take(length).slice().reverse());
}

/**
 * Accounts of a Frontier chain whose accounts are the 20-byte addresses
 * themselves: nonce and balance from `System.Account`, code from pallet-evm's
 * `AccountCodes`, proven by a Substrate read proof against the state root of
 * the Substrate header.
 */
export default class FrontierAccountProofVerifier extends AAccountProofVerifier {
    /**
     * The chain's existential deposit, a runtime constant: the part of a
     * balance pallet-evm keeps back so that a transfer cannot remove the
     * account.
     */
    private readonly existentialDeposit: bigint;

    constructor(existentialDeposit: bigint) {
        super();
        this.existentialDeposit = existentialDeposit;
    }

    provenAccount(
        stateRoot: Hash,
        address: ChecksumAddress,
        proofNodes: Bytes[]
    ): ProvenAccount {
        const key = systemAccountKey(address);
        const value = new SubstrateTrieProof(proofNodes).read(stateRoot, key);
        // the chain stores no entry for an account that never existed
        if (value === null) return { nonce: 0n, balance: 0n };
        if (value.length !== ACCOUNT_INFO_LENGTH)
            throw new StorageProofError(
                `The proof holds a ${value.length}-byte account for ${address}`
            );
        const reader = new ScaleReader(value, "An account");
        const nonce = readUnsigned(reader, U32_LENGTH);
        // consumers, providers and sufficients
        reader.take(3 * U32_LENGTH);
        const free = readUnsigned(reader, U128_LENGTH);
        const reserved = readUnsigned(reader, U128_LENGTH);
        const frozen = readUnsigned(reader, U128_LENGTH);
        // pallet-evm reports what a transfer may take and keep the account
        // alive: a freeze counts against the reserved balance first, and the
        // existential deposit always stays
        const frozenOfFree = frozen > reserved ? frozen - reserved : 0n;
        const untouchable =
            frozenOfFree > this.existentialDeposit
                ? frozenOfFree
                : this.existentialDeposit;
        return { nonce, balance: free > untouchable ? free - untouchable : 0n };
    }

    provenCode(
        stateRoot: Hash,
        address: ChecksumAddress,
        proofNodes: Bytes[]
    ): string {
        const key = accountCodeKey(address);
        const value = new SubstrateTrieProof(proofNodes).read(stateRoot, key);
        // the map stores no entry for an account without code
        if (value === null) return "0x";
        const reader = new ScaleReader(value, "A contract's code");
        const code = reader.take(reader.readCompactLength());
        if (!reader.isAtEnd)
            throw new StorageProofError(
                `The proof holds code of ${address} that is longer than it announces`
            );
        return hexlify(code);
    }
}
