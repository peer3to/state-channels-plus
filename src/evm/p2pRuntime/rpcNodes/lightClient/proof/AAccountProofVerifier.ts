import type { Bytes, ChecksumAddress, Hash } from "@/types/types";

/** An account's nonce and balance as the chain's Ethereum RPC reports them. */
export type ProvenAccount = { nonce: bigint; balance: bigint };

/**
 * Checks an account's nonce, balance and code against a state root the caller
 * trusts. Each kind of node proves them in its own representation: one
 * subclass per representation.
 */
export default abstract class AAccountProofVerifier {
    /**
     * The nonce and balance of the account at `address` under `stateRoot`. An
     * account proven not to exist has nonce and balance zero. Throws
     * {@link StorageProofError} when `proofNodes` does not prove the account.
     */
    abstract provenAccount(
        stateRoot: Hash,
        address: ChecksumAddress,
        proofNodes: Bytes[]
    ): ProvenAccount;

    /**
     * The code of the account at `address` under `stateRoot`, `0x` for an
     * account proven to hold none. Throws {@link StorageProofError} when
     * `proofNodes` does not prove the code.
     */
    abstract provenCode(
        stateRoot: Hash,
        address: ChecksumAddress,
        proofNodes: Bytes[]
    ): string;
}
