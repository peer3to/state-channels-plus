import Block from "./Block";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

export default class StateProof {
    readonly milestones: { blocks: Block[] }[];

    private constructor(milestones: { blocks: Block[] }[]) {
        this.milestones = milestones;
    }

    static tryFrom(stateProof: StateProofStruct): StateProof | null {
        const milestones: { blocks: Block[] }[] = [];
        for (const milestone of stateProof.milestones) {
            const blocks: Block[] = [];
            for (const bc of milestone.blockConfirmations) {
                const block = Block.tryFromBlockConfirmation(bc);
                if (!block) return null;
                blocks.push(block);
            }
            milestones.push({ blocks });
        }
        return new StateProof(milestones);
    }
}
