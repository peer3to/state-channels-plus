import { ethers } from "ethers";

import type {
    MessageBlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

import type { ReduceData } from "@/types";
import type { Bytes, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";

import type StateManager from "../StateManager";

export type ReductionComputation = {
    reduceData: ReduceData;
    reducedSnapshotData: SnapshotDataStruct;
    reducedEncodedStateMachineState: Bytes;
    reducedOutboundMessageBlock?: MessageBlockStruct;
    reducedForkId: ForkId;
};

export default class ReductionComputationService {
    constructor(private readonly stateManager: StateManager) {}

    public async compute(
        forkId: ForkId,
        disputes: DisputeStruct[]
    ): Promise<ReductionComputation> {
        const reducedOutput =
            await this.stateManager.stateChannelManagerContract.reduce.staticCall(
                disputes
            );
        return this.computeFromOutput(forkId, reducedOutput);
    }

    public async computeLocally(
        forkId: ForkId,
        disputes: DisputeStruct[]
    ): Promise<ReductionComputation> {
        const reducedOutput =
            await this.stateManager.diamondStateMachine.localDiamondContract.reduce.staticCall(
                disputes
            );
        return this.computeFromOutput(forkId, reducedOutput);
    }

    public buildReduceAndFinalizeCalldata(
        disputes: DisputeStruct[],
        latestStateSnapshot: ReduceData["latestStateSnapshot"],
        encodedStateMachineState: ReduceData["encodedStateMachineState"],
        inboundMessageBlocks: ReduceData["inboundMessageBlocks"],
        reducedForkId: ForkId
    ): string {
        return this.stateManager.stateChannelManagerContract.interface.encodeFunctionData(
            "reduceAndFinalize",
            [
                disputes,
                latestStateSnapshot,
                encodedStateMachineState,
                inboundMessageBlocks,
                reducedForkId
            ]
        );
    }

    private async computeFromOutput(
        forkId: ForkId,
        reducedOutput: ReduceData["reducedOutput"]
    ): Promise<ReductionComputation> {
        // Use getReduceData to properly handle genesis case (when latestBlock is undefined)
        const reduceData =
            await this.stateManager.agreementManager.getReduceData(
                forkId,
                reducedOutput
            );
        const [
            reducedSnapshotData,
            reducedEncodedStateMachineState,
            reducedOutboundMessageBlock
        ] =
            await this.stateManager.diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                forkId,
                reducedOutput,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.inboundMessageBlocks
            );
        const reducedForkId = ethers.keccak256(
            Codec.encode(reducedSnapshotData, Type.SnapshotData)
        );

        return {
            reduceData,
            reducedSnapshotData,
            reducedEncodedStateMachineState,
            reducedOutboundMessageBlock:
                reducedOutboundMessageBlock || undefined,
            reducedForkId
        };
    }
}
