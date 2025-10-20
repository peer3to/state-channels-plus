import { ARpcService } from "@/rpc";
import {
    ChannelId,
    ForkId,
    Timestamp,
    BlockHeight,
    Bytes,
    Hash
} from "@/types/types";
import ATransport from "@/transport/ATransport";
import P2PManager from "@/P2PManager";
import SpectateService, { SyncPayload } from "../spectate/SpectateService";
import StateProofRpcMethods from "./StateProofRpcMethods";
import { StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";
import {
    JoinChannelBlockStruct,
    ExitChannelBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

class StateProofService extends ARpcService<StateProofRpcMethods> {
    stateProofInitTimes: WeakMap<
        ATransport,
        {
            time: number;
            myForkId: ForkId;
            peerForkId: ForkId;
            blockHeight: BlockHeight;
        }
    > = new WeakMap<
        ATransport,
        {
            time: number;
            myForkId: ForkId;
            peerForkId: ForkId;
            blockHeight: BlockHeight;
        }
    >();

    spectateService: SpectateService;

    constructor(p2pManager: P2PManager, spectateService: SpectateService) {
        super(p2pManager);
        this.spectateService = spectateService;
    }

    public createRPCMethods(transport: ATransport): StateProofRpcMethods {
        return new StateProofRpcMethods(transport, this);
    }

    /**
     * Determine the canonical (correct) fork by querying on-chain state
     * Traverses dispute windows to find the non-disputed fork
     */
    public async determineCanonicalFork(channelId: ChannelId): Promise<ForkId> {
        const stateChannelManagerContract =
            this.p2pManager.stateManager.stateChannelManagerContract;
        const diamondStateMachine =
            this.p2pManager.stateManager.diamondStateMachine;

        // Get current on-chain snapshot
        const onChainSnapshot =
            await stateChannelManagerContract.getStateSnapshot(channelId);
        let currentForkId = onChainSnapshot.forkId;

        // Traverse through disputed forks to find the canonical one
        let isDisputed = await stateChannelManagerContract.isForkDisputed(
            channelId,
            currentForkId
        );

        while (isDisputed) {
            // Check if this fork has been reduced
            const isReduced =
                await diamondStateMachine.localDiamondContract.isReduceChallengePeriodExpired(
                    channelId,
                    currentForkId
                );

            if (!isReduced) {
                // Not reduced yet, current fork is still canonical
                break;
            }

            // Get the reduced fork
            const disputeWindows =
                await stateChannelManagerContract.getDisputeWindows(channelId, [
                    currentForkId
                ]);

            if (
                disputeWindows.length === 0 ||
                !disputeWindows[0].reducedResult.forkId
            ) {
                // No reduction found, current fork is canonical
                break;
            }

            currentForkId = disputeWindows[0].reducedResult.forkId;
            isDisputed = await stateChannelManagerContract.isForkDisputed(
                channelId,
                currentForkId
            );
        }

        return currentForkId as ForkId;
    }

    /**
     * Challenge peer to prove their fork
     * Call this whenever you queue a block - if they can prove their fork is canonical, sync to them
     * If they can't prove it or it's not canonical, disconnect
     *
     * @param transport The peer's transport
     * @param channelId The channel ID
     * @param peerForkId The peer's fork ID (from the block they sent)
     */
    public requestStateProof(
        transport: ATransport,
        channelId: ChannelId,
        peerForkId: ForkId,
        blockHeight: BlockHeight
    ) {
        console.log(`Challenging peer to prove their fork ${peerForkId}`);
        const time = Date.now();
        const myForkId = this.p2pManager.stateManager.forkId;

        // Store the init time and fork IDs for verification
        this.stateProofInitTimes.set(transport, {
            time,
            myForkId,
            peerForkId,
            blockHeight
        });

        this.remoteRpc.stateProofService
            .onProveStateRequest(channelId, peerForkId, blockHeight, time)
            .sendOne(transport);

        // Timeout if they don't respond
        setTimeout(() => {
            if (this.stateProofInitTimes.has(transport)) {
                console.log(
                    `Peer failed to prove fork ${peerForkId}, disconnecting`
                );
                this.p2pManager.disconnectAndBlacklistPeer(transport);
                this.stateProofInitTimes.delete(transport);
            }
        }, this.p2pManager.stateManager.timeConfig.agreementTime * 1000);
    }

    /**
     * Generate a state-proof sync payload for a specific fork and block height.
     */
    public async generateStateProofPayload(
        channelId: ChannelId,
        forkId: ForkId,
        blockHeight: BlockHeight
    ): Promise<SyncPayload> {
        const stateManager = this.p2pManager.stateManager;
        const agreementManager = stateManager.agreementManager;
        const diamondStateMachine = stateManager.diamondStateMachine;

        // 1) Traverse dispute windows from on-chain snapshot to derive the requested forkId
        const currentOnChainSnapshot = StateSnapshot.from(
            await diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            )
        );

        const disputeWindows: {
            disputeConfirmations: DisputeConfirmationStruct[];
            forkId: Hash;
            latestStateSnapshot: StateSnapshotStruct;
            latestEncodedStateMachineState: Bytes;
            joinChannelBlocksAppliedInReduce: JoinChannelBlockStruct[];
            reducedForkId: Hash;
        }[] = [];

        let currentForkId = currentOnChainSnapshot.forkId;
        let isDisputed =
            await diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                currentForkId
            );

        while (isDisputed) {
            // Collect dispute confirmations for this window
            const disputeConfirmations =
                await agreementManager.getForkDisputeConfirmations(
                    channelId,
                    currentForkId,
                    diamondStateMachine.localDiamondContract
                );

            const disputeHashes = disputeConfirmations.map((dc) =>
                Codec.decode(dc.signedDispute.encodedDispute, Type.Dispute)
            );

            // Reduce to next fork
            const reducedOutput =
                await diamondStateMachine.localDiamondContract.reduce.staticCall(
                    disputeHashes
                );

            const reduceData = await agreementManager.getReduceData(
                currentForkId,
                reducedOutput
            );

            const [snapshotData] =
                await diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                    currentForkId,
                    reducedOutput,
                    reduceData.latestStateSnapshot,
                    reduceData.encodedStateMachineState,
                    reduceData.joinChannelBlocks
                );
            const reducedForkId = ethers.keccak256(
                Codec.encode(snapshotData, Type.SnapshotData)
            );

            disputeWindows.push({
                disputeConfirmations,
                forkId: currentForkId as Hash,
                latestStateSnapshot: reduceData.latestStateSnapshot,
                latestEncodedStateMachineState:
                    reduceData.encodedStateMachineState,
                joinChannelBlocksAppliedInReduce: reduceData.joinChannelBlocks,
                reducedForkId
            });

            currentForkId = reducedForkId;
            isDisputed =
                await diamondStateMachine.localDiamondContract.isForkDisputed(
                    channelId,
                    currentForkId
                );
        }

        if (currentForkId != forkId)
            throw new Error(
                "Reduce and iterate didn't derive the requested fork"
            );

        // 2) Build proof for requested blockHeight on the derived fork
        const forkGenesisSnapshot =
            stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                forkId
            );
        if (!forkGenesisSnapshot)
            throw new Error(`No genesis snapshot found for fork ${forkId}`);

        const exitChannelBlocksUpToLatestGenesis =
            stateManager.storage.exitChannelBlocks.getBlocksInRange(
                forkGenesisSnapshot.latestExitBlockHash,
                currentOnChainSnapshot.latestExitBlockHash
            );

        const stateProof = await agreementManager.getStateProof(
            forkId,
            blockHeight
        );

        const milestoneSnapshotsStructs: StateSnapshotStruct[] =
            stateProof.milestones
                .map((m) => agreementManager.getSnapshotFromMilestone(m))
                .filter((snp): snp is StateSnapshot => !!snp)
                .map((snp) => snp.toStruct());

        const latestFinalizedSnapshot =
            milestoneSnapshotsStructs.length > 0
                ? StateSnapshot.from(
                      milestoneSnapshotsStructs[
                          milestoneSnapshotsStructs.length - 1
                      ]
                  )
                : forkGenesisSnapshot;

        const latestFinalizedEncodedState =
            stateManager.storage.stateMachineStates.getStateMachineState(
                latestFinalizedSnapshot.snapshotData.stateMachineStateHash
            );
        if (!latestFinalizedEncodedState)
            throw new Error(
                "No encoded state found for latest finalized snapshot"
            );

        const exitChannelBlocksOfTheLatestFork: ExitChannelBlockStruct[] =
            stateManager.storage.exitChannelBlocks.getBlocksInRange(
                latestFinalizedSnapshot.latestExitBlockHash,
                forkGenesisSnapshot.latestExitBlockHash
            );

        return {
            disputeWindows,
            latestForkGenesisSnapshot: forkGenesisSnapshot.toStruct(),
            stateProof,
            milestoneSnapshots: milestoneSnapshotsStructs,
            latestFinalizedEncodedState,
            exitChannelBlocksUpToLatestGenesis,
            exitChannelBlocksOfTheLatestFork
        };
    }

    /**
     * Verify that the provided proof is for the challenged fork and is valid
     */
    public async verifyPeerStateProof(
        channelId: ChannelId,
        syncPayload: SyncPayload,
        expectedPeerForkId: ForkId
    ): Promise<{ isValid: boolean; isCanonical: boolean }> {
        // First check: Does the proof match the fork we challenged them on?
        if (
            syncPayload.latestForkGenesisSnapshot.forkId !== expectedPeerForkId
        ) {
            console.log(
                `Proof fork mismatch: expected ${expectedPeerForkId}, got ${syncPayload.latestForkGenesisSnapshot.forkId}`
            );
            return { isValid: false, isCanonical: false };
        }

        // Second check: Verify this is the canonical fork according to chain
        const canonicalForkId = await this.determineCanonicalFork(channelId);
        const isCanonical = expectedPeerForkId === canonicalForkId;

        if (!isCanonical) {
            console.log(
                `Peer proved ${expectedPeerForkId} but canonical fork is ${canonicalForkId}`
            );
            return { isValid: true, isCanonical: false };
        }

        return { isValid: true, isCanonical: true };
    }

    public didRespond(transport: ATransport): boolean {
        return !this.stateProofInitTimes.has(transport);
    }
}

export default StateProofService;
