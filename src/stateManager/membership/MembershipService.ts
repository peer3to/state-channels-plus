import type StateManager from "../StateManager";
import { Block } from "@/models";
import { Status } from "@/types";
import { isCommittedParticipantStatus } from "@/types/flags";
import { Address, ChannelId, ChecksumAddress } from "@/types/types";
import {
    addressesEqual,
    getChecksumAddress,
    Logger,
    union,
    Codec,
    Type
} from "@/utils";
import type {
    MessageBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { id } from "ethers";

export enum SourceEligibility {
    ELIGIBLE,
    SLASHED,
    ABSENT
}

/**
 * The membership domain: the channel's participant union (on-chain current +
 * pending), source eligibility, and whether this signer is in it.
 */
export default class MembershipService {
    private readonly logger: Logger;
    private eligibilityRefresh?: Promise<boolean>;
    private onChainEligibility: Set<ChecksumAddress> = new Set();
    private offChainEligibility: Set<ChecksumAddress> = new Set();
    private readonly knownSlashes: Set<ChecksumAddress> = new Set();

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "Membership" });
    }

    // Whether I belong to this block's previous/resulting participant union:
    // the set that may sign and relay it. A leaver stays PARTICIPATING until
    // its exit snapshot lands but is outside the union of every later block;
    // signing or relaying those would present it to peers that already
    // applied its exit as a signer or source they no longer admit.
    public isSignerInBlockUnion(block: Block): boolean {
        const union = this.stateManager.storage.getParticipantsUnion(
            block.coordinates,
            block.stateSnapshotHash
        );
        return union.some((participant) =>
            addressesEqual(participant, this.stateManager.signerAddress)
        );
    }

    public getCachedSourceEligibility(source: Address): SourceEligibility {
        const address = getChecksumAddress(source);
        if (this.knownSlashes.has(address)) return SourceEligibility.SLASHED;
        if (
            this.onChainEligibility.has(address) ||
            this.offChainEligibility.has(address)
        )
            return SourceEligibility.ELIGIBLE;
        return SourceEligibility.ABSENT;
    }

    public async resolveSourceEligibility(
        source: Address
    ): Promise<SourceEligibility> {
        const cached = this.getCachedSourceEligibility(source);
        if (cached !== SourceEligibility.ABSENT) return cached;
        await this.refreshOnChainEligibility();
        return this.getCachedSourceEligibility(source);
    }

    public publishOnChainSnapshot(snapshot: StateSnapshotStruct): void {
        this.onChainEligibility = new Set(
            snapshot.snapshotData.participants.map((participant) =>
                getChecksumAddress(String(participant))
            )
        );
        const inbound = this.stateManager.storage.inboundMessages;
        const lowerBlockHash =
            snapshot.snapshotData.latestInboundMessageBlockHash;
        const head = inbound.headNotBehind(
            lowerBlockHash,
            Number(snapshot.snapshotData.latestInboundMessageBlockHeight)
        );
        const pending = inbound.tryGetMessageBlocksInRange({
            upperBlockHash: head.hash,
            lowerBlockHash
        });
        for (const block of pending.blocks)
            this.observeInboundMembership(block);
    }

    public observeInboundMembership(block: MessageBlockStruct): void {
        for (const message of block.messages) {
            if (message.messageType !== id("JOIN_CHANNEL_MESSAGE")) continue;
            const join = Codec.decode(message.data, Type.JoinChannel);
            this.onChainEligibility.add(getChecksumAddress(join.participant));
            // this signer's own join is observed by ChannelJoinService: it
            // subscribes to the inbound and snapshot events and reads the
            // local diamond's pending set
        }
    }

    public publishOffChainEligibility(participants: readonly Address[]): void {
        this.offChainEligibility = new Set(
            participants.map(getChecksumAddress)
        );
    }

    public observeOnChainSlash(participant: Address): void {
        this.knownSlashes.add(getChecksumAddress(participant));
    }

    public resetEligibility(): void {
        this.onChainEligibility.clear();
        this.offChainEligibility.clear();
        this.knownSlashes.clear();
    }

    public async refreshOnChainEligibility(): Promise<boolean> {
        if (this.eligibilityRefresh) return this.eligibilityRefresh;
        this.eligibilityRefresh = (async () => {
            const sm = this.stateManager;
            const membership =
                await sm.eventSyncService.readPinnedChainMembership(
                    sm.channelId
                );
            for (const participant of membership.slashed)
                this.observeOnChainSlash(participant);
            const synchronized =
                await sm.eventSyncService.synchronizeChainMembership(
                    sm.channelId,
                    membership
                );
            // the chain did not return a log the run needs
            if (!synchronized)
                this.logger.warn(
                    "Source eligibility refresh unavailable: chain logs missing after recovery"
                );
            return synchronized;
        })();
        try {
            return await this.eligibilityRefresh;
        } finally {
            this.eligibilityRefresh = undefined;
        }
    }

    public async getOnChainParticipantUnion(
        channelId: ChannelId = this.stateManager.channelId
    ): Promise<Address[]> {
        const sm = this.stateManager;
        const [participants, pendingParticipants] = await Promise.all([
            sm.stateChannelManagerContract.getParticipants(channelId),
            sm.stateChannelManagerContract.getPendingParticipants(channelId)
        ]);
        return [
            ...union(new Set(participants), new Set(pendingParticipants))
        ].map(String) as Address[];
    }

    public includesSigner(participants: readonly Address[]): boolean {
        return participants.some((participant) =>
            addressesEqual(participant, this.stateManager.signerAddress)
        );
    }

    /**
     * Whether the local chain mirror lists this signer as pending. It reads
     * the mirror only: the join service starts its force-join bounds from
     * this observation, and a direct chain answer must not start them early.
     */
    public async isSignerPendingInMirror(
        channelId: ChannelId = this.stateManager.channelId
    ): Promise<boolean> {
        return this.includesSigner(
            (await this.stateManager.diamondStateMachine.localDiamondContract.getPendingParticipants(
                channelId
            )) as Address[]
        );
    }

    /**
     * Whether the chain's pending set (unconsumed JOINs) lists this signer.
     * The local mirror holds only JOINs the chain processed, so a mirror that
     * lists the signer answers without a chain read; otherwise the chain
     * confirms the absence, since the JOIN can land after the mirror's
     * inbound head. A failed read rejects the caller.
     */
    public async isSignerPendingOnChain(
        channelId: ChannelId = this.stateManager.channelId
    ): Promise<boolean> {
        if (await this.isSignerPendingInMirror(channelId)) return true;
        return this.includesSigner(
            (await this.stateManager.stateChannelManagerContract.getPendingParticipants(
                channelId
            )) as Address[]
        );
    }

    /** Whether the chain's seated or pending participants list this signer. */
    public async isSignerOnChain(): Promise<boolean> {
        return this.includesSigner(await this.getOnChainParticipantUnion());
    }

    public async isSignerInLocalState(): Promise<boolean> {
        return this.includesSigner(
            await this.stateManager.getParticipantsCurrent()
        );
    }

    public async getOnChainThresholdSet(
        channelId: ChannelId = this.stateManager.channelId
    ): Promise<Address[]> {
        return (
            await this.stateManager.stateChannelManagerContract.getOnChainThresholdSet(
                channelId
            )
        ).map(String) as Address[];
    }

    /**
     * This signer's membership ended: the chain dropped its seat or pending
     * join. A committed status goes back to SYNCED. Both follow-ups subscribe
     * to that status change: ChannelJoinService ends the join, and
     * LeaveChannelService ends the exit and emits onLeftChannel.
     */
    public dropMembership(): void {
        const sm = this.stateManager;
        if (isCommittedParticipantStatus(sm.status))
            sm.setStatus(Status.SYNCED);
    }
}
