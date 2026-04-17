import type { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export function expectSignedBlocksOnlyStateProof(
    stateProof: StateProofStruct
): void {
    const { milestones, signedBlocks } = stateProof;
    if (milestones.length !== 0) {
        throw new Error(
            `expected signedBlocks-only state proof (no milestones), got milestones=${milestones.length}`
        );
    }
    if (signedBlocks.length === 0) {
        throw new Error(
            "expected non-empty signedBlocks for non-genesis dispute"
        );
    }
}
