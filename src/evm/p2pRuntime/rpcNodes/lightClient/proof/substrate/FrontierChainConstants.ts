/**
 * What a Frontier runtime fixes in its code, so that the chain's state does
 * not hold it and no proof can decide it.
 */
export type FrontierChainConstants = {
    /** The balance pallet-evm keeps back so a transfer cannot remove an account. */
    existentialDeposit: bigint;
    /** What a contract reads as the block's base fee: the runtime's minimum gas price. */
    baseFeePerGas: bigint;
};

/**
 * The constants of the peer3 runtime (`zero-fee-runtime`, peer3-parachain at
 * d845dbfb): `EXISTENTIAL_DEPOSIT` in `runtime/src/lib.rs`, and a fee
 * calculator of `()` in `runtime/src/configs/frontier.rs`.
 */
export const PEER3_CHAIN_CONSTANTS: FrontierChainConstants = {
    existentialDeposit: 1_000_000_000n,
    baseFeePerGas: 0n
};
