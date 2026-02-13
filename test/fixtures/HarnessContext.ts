import type RpcHandler from "@/rpc/RpcHandler";
import { StateSnapshot } from "@/models";
import { ForkId } from "@/types";
import type { Address, ChannelId, Hash, Timestamp } from "@/types/types";
import { ChannelBalanceStructOutput } from "@typechain-types/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet";
import {
    BalanceStruct,
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

/** Handler stored for restore: EventHandler.onBlockCalldataPosted */
export type PeerCalldataHandler = (
    channelId: ChannelId,
    commitmentHash: Hash,
    sender: Address,
    signedBlock: SignedBlockStruct,
    timestamp: Timestamp
) => Promise<void>;

/** Handler stored for restore: StateTransitionRpcMethods.onBlockConfirmation (RPC proxy returns RpcHandler) */
export type PeerBroadcastFn = (
    blockConfirmation: BlockConfirmationStruct
) => RpcHandler;

export class HarnessContext {
    /** Original fork ID captured before dispute/fork change (set by Event.captureOriginalFork) */
    private _originalForkId?: ForkId;
    /** New fork ID after fork change (set by Context.updateActiveFork) */
    private _newForkId?: ForkId;
    /** Index of the malicious peer in Byzantine attack scenarios (set by Context.markMaliciousPeer, Byzantine blocks) */

    private _maliciousPeerIndex?: number;
    /** Last malicious peer index from most recent Byzantine attack (set by Byzantine blocks) */

    private _honestPeerIndices?: number[];
    /** Last tampered dispute object (set by Byzantine blocks) */

    private _lastTamperedDispute?: DisputeStruct;
    /** Promise that resolves to tampered dispute (set by Byzantine.interceptDisputeConstruction) */

    private _tamperedDisputePromise?: Promise<DisputeStruct>;
    /** Function to restore dispute construction after interception (set by Byzantine.interceptDisputeConstruction) */

    private _restoreDisputeConstruction?: () => void;
    /** last milestone snapshot before posting snapshot (set by Context.captureContextForSnapshotSameFork) */

    private _lastMilestoneSnapshot?: StateSnapshot;
    /** Channel balance before posting snapshot (set by Context.captureContextForSnapshotSameFork) */
    private _channelBalanceBefore?: ChannelBalanceStructOutput;
    /** Expected withdrawals delta from prepared outbound messages (set by Context.captureContextForSnapshotSameFork) */

    private _expectedWithdrawalsDelta?: BalanceStruct;

    private snapshotCountByKey: Record<string, number> = {};
    private peerSnapshotCountBefore: Record<number, number> = {};
    private peerOriginalCalldataHandlerByIndex: Record<
        number,
        PeerCalldataHandler
    > = {};
    private peerOriginalBroadcastByIndex: Record<number, PeerBroadcastFn> = {};

    get originalForkId(): ForkId {
        if (!this._originalForkId)
            throw new Error("HarnessContext: originalForkId not set");
        return this._originalForkId;
    }
    set originalForkId(v: ForkId) {
        this._originalForkId = v;
    }

    get newForkId(): ForkId {
        if (!this._newForkId)
            throw new Error("HarnessContext: newForkId not set");
        return this._newForkId;
    }
    set newForkId(v: ForkId) {
        this._newForkId = v;
    }

    get maliciousPeerIndex(): number {
        if (this._maliciousPeerIndex === undefined)
            throw new Error("HarnessContext: maliciousPeerIndex not set");
        return this._maliciousPeerIndex;
    }
    set maliciousPeerIndex(v: number) {
        this._maliciousPeerIndex = v;
    }

    get honestPeerIndices(): number[] {
        if (this._honestPeerIndices === undefined)
            throw new Error("HarnessContext: honestPeerIndices not set");
        return this._honestPeerIndices;
    }
    set honestPeerIndices(v: number[]) {
        this._honestPeerIndices = v;
    }

    get lastTamperedDispute(): DisputeStruct {
        if (this._lastTamperedDispute === undefined)
            throw new Error("HarnessContext: lastTamperedDispute not set");
        return this._lastTamperedDispute;
    }
    set lastTamperedDispute(v: DisputeStruct) {
        this._lastTamperedDispute = v;
    }

    get tamperedDisputePromise(): Promise<DisputeStruct> {
        if (!this._tamperedDisputePromise)
            throw new Error("HarnessContext: tamperedDisputePromise not set");
        return this._tamperedDisputePromise;
    }
    set tamperedDisputePromise(v: Promise<DisputeStruct>) {
        this._tamperedDisputePromise = v;
    }

    get restoreDisputeConstruction(): () => void {
        if (!this._restoreDisputeConstruction)
            throw new Error(
                "HarnessContext: restoreDisputeConstruction not set"
            );
        return this._restoreDisputeConstruction;
    }
    set restoreDisputeConstruction(v: () => void) {
        this._restoreDisputeConstruction = v;
    }

    get lastMilestoneSnapshot(): StateSnapshot {
        if (!this._lastMilestoneSnapshot)
            throw new Error(
                "HarnessContext: lastMilestoneSnapshot was not set. Call Context.captureContextForSnapshotSameFork() first."
            );
        return this._lastMilestoneSnapshot;
    }
    set lastMilestoneSnapshot(v: StateSnapshot | undefined) {
        this._lastMilestoneSnapshot = v;
    }
    hasLastMilestoneSnapshot(): boolean {
        return !!this._lastMilestoneSnapshot;
    }

    get channelBalanceBefore(): ChannelBalanceStructOutput {
        if (!this._channelBalanceBefore)
            throw new Error("HarnessContext: channelBalanceBefore not set");
        return this._channelBalanceBefore;
    }
    set channelBalanceBefore(v: ChannelBalanceStructOutput) {
        this._channelBalanceBefore = v;
    }

    get expectedWithdrawalsDelta(): BalanceStruct {
        if (!this._expectedWithdrawalsDelta)
            throw new Error("HarnessContext: expectedWithdrawalsDelta not set");
        return this._expectedWithdrawalsDelta;
    }
    set expectedWithdrawalsDelta(v: BalanceStruct) {
        this._expectedWithdrawalsDelta = v;
    }

    setSnapshotCount(keyName: string, value: number) {
        this.snapshotCountByKey[keyName] = value;
    }
    getSnapshotCount(keyName: string): number {
        const v = this.snapshotCountByKey[keyName];
        if (v === undefined)
            throw new Error(`HarnessContext: snapshotCount_${keyName} not set`);
        return v;
    }

    setPeerSnapshotCount(peerIndex: number, value: number) {
        this.peerSnapshotCountBefore[peerIndex] = value;
    }
    getPeerSnapshotCount(peerIndex: number): number {
        const v = this.peerSnapshotCountBefore[peerIndex];
        if (v === undefined)
            throw new Error(
                `HarnessContext: peer${peerIndex}SnapshotCountBefore not set`
            );
        return v;
    }

    setPeerOriginalCalldataHandler(
        peerIndex: number,
        handler: PeerCalldataHandler
    ) {
        this.peerOriginalCalldataHandlerByIndex[peerIndex] = handler;
    }
    getPeerOriginalCalldataHandler(peerIndex: number): PeerCalldataHandler {
        const v = this.peerOriginalCalldataHandlerByIndex[peerIndex];
        if (v === undefined)
            throw new Error(
                `HarnessContext: peer${peerIndex}OriginalCalldataHandler not set`
            );
        return v;
    }

    setPeerOriginalBroadcast(peerIndex: number, broadcastFn: PeerBroadcastFn) {
        this.peerOriginalBroadcastByIndex[peerIndex] = broadcastFn;
    }
    getPeerOriginalBroadcast(peerIndex: number): PeerBroadcastFn {
        const v = this.peerOriginalBroadcastByIndex[peerIndex];
        if (v === undefined)
            throw new Error(
                `HarnessContext: peer${peerIndex}OriginalBroadcast not set`
            );
        return v;
    }

    public clear() {
        this._originalForkId = undefined;
        this._newForkId = undefined;
        this._maliciousPeerIndex = undefined;
        this._honestPeerIndices = undefined;
        this._lastTamperedDispute = undefined;
        this._tamperedDisputePromise = undefined;
        this._restoreDisputeConstruction = undefined;
        this._lastMilestoneSnapshot = undefined;
        this._channelBalanceBefore = undefined;
        this._expectedWithdrawalsDelta = undefined;
        this.snapshotCountByKey = {};
        this.peerSnapshotCountBefore = {};
        this.peerOriginalCalldataHandlerByIndex = {};
        this.peerOriginalBroadcastByIndex = {};
    }
}
