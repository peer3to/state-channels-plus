// @spec-test-coverage-ignore: dispute-input assertion helper shared by E2E cases; evidence belongs to the calling test declarations
import Block from "@/models/Block";
import type { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

/**
 * `stateProof` has the milestone-only shape with an unfinal tail: every
 * milestone holds blocks, and its last milestone is one run of consecutive
 * heights whose blocks after the first are the replay tail. A single run
 * from block 0 is the one unfinal genesis shape: the whole run is the tail.
 */
export function expectUnfinalTailStateProof(
    stateProof: StateProofStruct
): void {
    const { milestones } = stateProof;
    if (milestones.length === 0)
        throw new Error("expected a nonempty milestone-only state proof");
    const emptyIndex = milestones.findIndex(
        (milestone) => milestone.blockConfirmations.length === 0
    );
    if (emptyIndex !== -1)
        throw new Error(`expected blocks in milestones[${emptyIndex}]`);
    const run = milestones
        .at(-1)!
        .blockConfirmations.map((confirmation) =>
            Block.fromBlockConfirmation(confirmation)
        );
    run.forEach((block, index) => {
        if (index > 0 && block.height !== run[index - 1].height + 1)
            throw new Error(
                `expected consecutive heights in the last milestone, got ${run[index - 1].height} then ${block.height}`
            );
    });
    const isGenesisRun = milestones.length === 1 && run[0].height === 0;
    if (run.length < 2 && !isGenesisRun)
        throw new Error(
            `expected an unfinal tail after the last milestone's first block (height ${run[0].height})`
        );
}
