import { ForkId } from "@/types/types";
import { StateSnapshot } from "@/models";
import { BalanceStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ChannelBalanceStructOutput } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/StateChannelCommon";

/**
 * Test context fields used by blocks for cross-block state sharing
 * These fields are set by certain blocks and consumed by others
 */
export interface HarnessContext {
    /** Original fork ID captured before dispute/fork change (set by Event.captureOriginalFork) */
    originalForkId?: ForkId;

    /** New fork ID after fork change (set by Context.updateActiveFork) */
    newForkId?: ForkId;

    /** Index of the malicious peer in Byzantine attack scenarios (set by Context.markMaliciousPeer, Byzantine blocks) */
    maliciousPeerIndex?: number;

    /** Last malicious peer index from most recent Byzantine attack (set by Byzantine blocks) */
    lastMaliciousPeerIndex?: number;

    /** Indices of honest peers in Byzantine attack scenarios (set by Context.markMaliciousPeer) */
    honestPeerIndices?: number[];

    /** Last tampered dispute object (set by Byzantine blocks) */
    lastTamperedDispute?: DisputeStruct;

    /** Promise that resolves to tampered dispute (set by Byzantine.interceptDisputeConstruction) */
    tamperedDisputePromise?: Promise<DisputeStruct>;

    /** Function to restore dispute construction after interception (set by Byzantine.interceptDisputeConstruction) */
    restoreDisputeConstruction?: () => void;

    /** last milestone snapshot before posting snapshot (set by Context.captureContextForSnapshotSameFork) */
    lastMilestoneSnapshot?: StateSnapshot;

    /** Channel balance before posting snapshot (set by Context.captureContextForSnapshotSameFork) */
    channelBalanceBefore?: ChannelBalanceStructOutput;

    /** Expected withdrawals delta from prepared outbound messages (set by Context.captureContextForSnapshotSameFork) */
    expectedWithdrawalsDelta?: BalanceStruct;

    /** Dynamic snapshot count storage for named contexts - indexed by context key (set by Assert.storeSnapshotCount) */
    [key: `snapshotCount_${string}`]: number;

    /** Dynamic snapshot count storage for peers - indexed by peer index (set by Context blocks) */
    [key: `peer${number}SnapshotCountBefore`]: number;

    /** Original calldata handler for peers - stored before stubbing (set by Byzantine.stubCalldataHandler) */
    [key: `peer${number}OriginalCalldataHandler`]:
        | ((...args: any[]) => Promise<void>)
        | undefined;

    /** Original broadcast function for peers - stored before stubbing (set by Byzantine.stubBroadcast) */
    [key: `peer${number}OriginalBroadcast`]:
        | ((...args: any[]) => any)
        | undefined;
}
