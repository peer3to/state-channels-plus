import { ZeroAddress } from "ethers";

import { Codec, Type, hash } from "@/utils";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

/**
 * Host-side, named dispute-tamper strategies. Mirrors the harness-side
 * `DisputeTampering` statics, but lives here so they can run inside the host's
 * wrapped `constructDispute` (they use `Codec`/`hash`, which a shipped
 * `new Function` body could not reach).
 */
export type DisputeTamperStrategy =
    | "tamperAuditingDataHash"
    | "tamperDoubleFault"
    | "tamperInvalidStateProof"
    | "tamperPartialAuditing"
    | "flipSelfRemovalWithoutOutputRecompute";

export const DISPUTE_TAMPER_STRATEGIES: Record<
    DisputeTamperStrategy,
    (dispute: DisputeStruct) => void
> = {
    tamperAuditingDataHash: (dispute) => {
        dispute.input.disputeAuditingDataHash = hash("0x42");
    },
    tamperDoubleFault: (dispute) => {
        dispute.input.disputeAuditingDataHash = hash("0x42");
        dispute.input.latestStateSnapshotHash = hash("0x43");
    },
    tamperInvalidStateProof: (dispute) => {
        dispute.input.latestStateSnapshotHash = hash("0x42");
    },
    tamperPartialAuditing: (dispute) => {
        const stateProof = dispute.input.stateProof;
        if (
            stateProof.milestones.length === 0 ||
            stateProof.milestones[0].blockConfirmations.length === 0
        ) {
            throw new Error("No milestones to tamper");
        }
        const firstBc = stateProof.milestones[0].blockConfirmations[0];
        const block = Codec.decode(
            firstBc.signedBlock.encodedBlock,
            Type.Block
        );
        block.stateSnapshotHash = hash("0xDEADBEEF");
        firstBc.signedBlock.encodedBlock = Codec.encode(block, Type.Block);
    },
    flipSelfRemovalWithoutOutputRecompute: (dispute) => {
        dispute.input.selfRemoval = true;
        dispute.input.timeout.participant = ZeroAddress;
        dispute.input.onChainSlashes = [];
    }
};
