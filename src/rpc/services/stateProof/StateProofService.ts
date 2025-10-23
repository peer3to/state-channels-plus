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
import StateProofRpcMethods from "./StateProofRpcMethods";
import { StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";
import {
    JoinChannelBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export interface DisputeWindowVerification {
    disputeConfirmations: DisputeConfirmationStruct[];
    forkId: Hash;
    latestStateSnapshot: StateSnapshotStruct;
    latestEncodedStateMachineState: Bytes;
    joinChannelBlocksAppliedInReduce: JoinChannelBlockStruct[];
    reducedForkId: Hash;
}

export interface StateProofPayload {
    disputeWindows: DisputeWindowVerification[];
    forkGenesisSnapshot: StateSnapshotStruct;
    stateProof: StateProofStruct;
}
class StateProofService extends ARpcService<StateProofRpcMethods> {
    stateProofInitTimes: WeakMap<
        ATransport,
        {
            time: number;
            forkId: ForkId;
            blockHeight: BlockHeight;
        }
    > = new WeakMap<
        ATransport,
        {
            time: number;
            forkId: ForkId;
            blockHeight: BlockHeight;
        }
    >();

    public createRPCMethods(transport: ATransport): StateProofRpcMethods {
        return new StateProofRpcMethods(transport, this);
    }

    /**
     * Request peer to prove their fork
     * Call this whenever you queue a block
     * If they can't prove it, disconnect
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
        console.log(
            `Requesting peer to prove their state at block height ${blockHeight}`
        );
        const time = Date.now();

        // Store the init time, fork ID, and block height for timeout
        this.stateProofInitTimes.set(transport, {
            time,
            forkId: peerForkId,
            blockHeight
        });

        this.remoteRpc.stateProofService
            .onProveStateRequest(channelId, peerForkId, blockHeight, time)
            .sendOne(transport);

        // Timeout if they don't respond
        setTimeout(() => {
            if (this.stateProofInitTimes.has(transport)) {
                console.log(
                    `Peer failed to prove state for fork ${peerForkId} at block height ${blockHeight}, disconnecting`
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
    ): Promise<StateProofPayload> {
        const stateManager = this.p2pManager.stateManager;
        const agreementManager = stateManager.agreementManager;
        const diamondStateMachine = stateManager.diamondStateMachine;

        // 1) Traverse dispute windows from on-chain snapshot to derive the requested forkId
        const currentOnChainSnapshot = StateSnapshot.from(
            await diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            )
        );

        const disputeWindows: DisputeWindowVerification[] = [];

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

        const stateProof = await agreementManager.getStateProof(
            forkId,
            blockHeight
        );

        return {
            disputeWindows,
            forkGenesisSnapshot: forkGenesisSnapshot.toStruct(),
            stateProof
        };
    }

    public didRespond(transport: ATransport): boolean {
        return !this.stateProofInitTimes.has(transport);
    }

    /**
     * Verify state proof
     */
    public async verifyStateProof(
        channelId: ChannelId,
        proof: StateProofPayload
    ): Promise<boolean> {
        try {
            const stateManager = this.p2pManager.stateManager;
            const diamondStateMachine = stateManager.diamondStateMachine;

            // 1. Fetch the onChainSnapshot
            const onChainSnapshot =
                await diamondStateMachine.localDiamondContract.getStateSnapshot(
                    channelId
                );
            let finalForkId: Bytes = onChainSnapshot.forkId;

            // 2. Verify dispute windows
            for (const disputeWindow of proof.disputeWindows) {
                // 2.1) Verify dispute confirmations exist
                if (
                    !disputeWindow.disputeConfirmations ||
                    disputeWindow.disputeConfirmations.length === 0
                ) {
                    console.log("Invalid dispute window: no confirmations");
                    return false;
                }

                // 2.2) Verify dispute window data
                const disputeWindowData =
                    await diamondStateMachine.localDiamondContract.getDisputeWindows(
                        channelId,
                        [disputeWindow.forkId]
                    );

                if (disputeWindowData.length === 0) {
                    console.log("Invalid dispute window: not found on chain");
                    return false;
                }

                // 2.3) Verify reduction produces expected result
                const disputeHashes = disputeWindow.disputeConfirmations.map(
                    (conf) =>
                        Codec.decode(
                            conf.signedDispute.encodedDispute,
                            Type.Dispute
                        )
                );
                const reducedOutput =
                    await diamondStateMachine.localDiamondContract.reduce.staticCall(
                        disputeHashes
                    );

                // 2.4) Verify reduced fork ID matches the expected result
                if (
                    disputeWindowData[0].reducedResult.forkId !==
                    disputeWindow.reducedForkId
                ) {
                    console.log(
                        "Invalid dispute window: reduced fork ID mismatch"
                    );
                    return false;
                }

                finalForkId = disputeWindow.reducedForkId;
            }

            // 3. Verify fork genesis snapshot
            if (finalForkId !== proof.forkGenesisSnapshot.forkId) {
                console.log("Invalid proof: fork ID mismatch");
                return false;
            }

            const isCorrectGenesis =
                await diamondStateMachine.localDiamondContract.isGenesisSnapshotWithoutTimeCheck(
                    proof.forkGenesisSnapshot
                );
            if (!isCorrectGenesis) {
                console.log("Invalid proof: incorrect genesis snapshot");
                return false;
            }

            // 4. Verify state proof milestones
            // Extract milestone snapshots from the milestones (same as spectate)
            const milestoneSnapshots = proof.stateProof.milestones.map(
                (milestone) => {
                    // Get snapshot from milestone - this should match spectate logic
                    const snapshot =
                        stateManager.agreementManager.getSnapshotFromMilestone(
                            milestone
                        );
                    if (!snapshot) {
                        throw new Error(
                            "Missing milestone snapshot for provided proof"
                        );
                    }
                    return snapshot.toStruct();
                }
            );

            const [isValid, _] =
                await diamondStateMachine.localDiamondContract.verifyMilestones(
                    proof.stateProof.milestones,
                    milestoneSnapshots,
                    proof.forkGenesisSnapshot.snapshotData
                );
            if (!isValid) {
                console.log("Invalid proof: milestone verification failed");
                return false;
            }

            return true;
        } catch (error) {
            console.log(`State proof verification failed: ${error}`);
            return false;
        }
    }
}

export default StateProofService;
