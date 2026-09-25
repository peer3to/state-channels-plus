/**
 * Extra gas on top of a transaction's estimate, in percent, applied by the chain
 * signers (HostNonceManager, ClientChainSigner) to every send without a limit.
 *
 * An estimate is exact for the chain state when it is taken and has no headroom.
 * A concurrent transaction included first can make ours cost more. Seen live with
 * disputes: honest peers detect the same fraud and race to dispute; each late
 * disputer skips the applied fraud proof, but its upload costs more for every
 * disputer already in the window (_hadParticipantPostedEvidence reads the whole
 * hasPosted list). A peer estimated as the 2nd disputer (311,723) and was
 * included as the 3rd: out of gas at 305,268 inside the proxy's delegatecall
 * ("Delegatecall failed", no reason). Its retry landed at evidencePeriodEnd, so
 * the honest dispute was refused (RaceConditionDisputeEvidencePeriodExpired).
 *
 * No fixed limit is used: consumer state machines make costs vary.
 */
export const GAS_ESTIMATE_HEADROOM_PERCENT = 50n;

/** A gas limit with GAS_ESTIMATE_HEADROOM_PERCENT headroom over `estimate`. */
export function withGasHeadroom(estimate: bigint): bigint {
    return estimate + (estimate * GAS_ESTIMATE_HEADROOM_PERCENT) / 100n;
}
