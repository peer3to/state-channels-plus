import type StateManager from "../StateManager";

import { StateSnapshot, BlockCoordinates } from "@/models";
import { Codec, Type, hash } from "@/utils";
import { Hash, Timestamp } from "@/types/types";
import {
    ExitChannelBlockStruct,
    ExitChannelStruct,
    BalanceStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

export interface SnapshotCreationResult {
    stateSnapshot: StateSnapshot;
    exitChannelBlock?: ExitChannelBlockStruct;
    totalWithdrawals: BalanceStruct;
}

export default class StateSnapshotFactory {
    constructor(private readonly stateManager: StateManager) {}

    public async createStateSnapshotBlock(
        stateMachineStateHash: Hash,
        coordinates: BlockCoordinates,
        timestamp: Timestamp,
        exitChannels?: ExitChannelStruct[]
    ): Promise<SnapshotCreationResult> {
        const { storage, diamondStateMachine } = this.stateManager;
        const previousStateSnapshot =
            storage.getPreviousStateSnapshot(coordinates);
        if (!previousStateSnapshot)
            throw new Error(
                "createStateSnapshot for block - previousStateSnapshot undefined"
            );

        const latestJoinChannelBlockHash =
            previousStateSnapshot.snapshotData.latestJoinChannelBlockHash;
        const totalDeposits = previousStateSnapshot.snapshotData.totalDeposits;

        let { latestExitChannelBlockHash, totalWithdrawals, participants } =
            previousStateSnapshot.snapshotData;

        let exitChannelBlock: ExitChannelBlockStruct | undefined;

        if (exitChannels && exitChannels.length > 0) {
            participants = await diamondStateMachine.getParticipants();
            exitChannelBlock = {
                exitChannels,
                previousBlockHash: latestExitChannelBlockHash
            };

            latestExitChannelBlockHash = hash(
                Codec.encode(exitChannelBlock, Type.ExitChannelBlock)
            );

            totalWithdrawals = await this.calculateTotalBalance(
                exitChannels,
                totalWithdrawals
            );
        }

        const stateSnapshot: StateSnapshotStruct = {
            forkId: coordinates.forkId,
            blockHeight: BigInt(coordinates.height),
            timestamp: timestamp,
            snapshotData: {
                originForkId: previousStateSnapshot.snapshotData.originForkId,
                stateMachineStateHash: stateMachineStateHash,
                participants,
                latestJoinChannelBlockHash,
                latestExitChannelBlockHash,
                totalDeposits,
                totalWithdrawals
            }
        };

        return {
            stateSnapshot: StateSnapshot.from(stateSnapshot),
            exitChannelBlock,
            totalWithdrawals
        };
    }

    private async calculateTotalBalance(
        balances: { balance: BalanceStruct }[],
        initialTotal?: BalanceStruct
    ): Promise<BalanceStruct> {
        const { diamondStateMachine } = this.stateManager;
        let total =
            initialTotal ?? (await diamondStateMachine.getZeroBalance());

        for (const balance of balances) {
            total = await diamondStateMachine.addBalance(
                total,
                balance.balance
            );
        }

        return total;
    }
}
