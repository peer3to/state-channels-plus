import { StateProofStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import Block from "./Block";

export default class StateProof {
    readonly milestones: { blocks: Block[] }[];
    readonly signedBlocks: Block[];

    private constructor(
        milestones: { blocks: Block[] }[],
        signedBlocks: Block[]
    ) {
        this.milestones = milestones;
        this.signedBlocks = signedBlocks;
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
        const signedBlocks: Block[] = [];
        for (const sb of stateProof.signedBlocks) {
            const block = Block.tryFromSignedBlock(sb);
            if (!block) return null;
            signedBlocks.push(block);
        }
        return new StateProof(milestones, signedBlocks);
    }
}
