import { ethers } from "ethers";
import AgreementManager from "../agreementManager";
import { StateChannelManagerProxy } from "@typechain-types";
import {
    DisputeConfirmationStruct,
    DisputeStruct,
    DisputeAuditingDataStruct,
    DisputeInputStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import {
    DebugProxy,
    hash,
    intersection,
    Codec,
    Type,
    SignatureUtils
} from "@/utils";
import P2pEventHooks from "@/P2pEventHooks";
import { Address, Bytes, ChannelId, ForkId, Signature } from "../types/types";
import { StateSnapshot } from "../models";
import Storage from "@/storage";
import ADiamondStateMachine from "../ADiamondStateMachine";
import {
    StateProofStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/StateChannelManagerEvents";
import Clock from "../Clock";
import { BytesLike } from "ethers";

const DEBUG_DISPUTE_HANDLER = true;

type TimeoutOptions = {
    // This is enough and the rest is deducted from storage/state
    blockHeightToTimeout: number; // this could also be a boolean, but will be used as a sanity check
    isForced?: boolean;
    // on-chain race condition checks
    previousBlockProducer?: Address;
    previousBlockProducerPostedCalldata?: boolean;
    participantSignatureOnPreviousBlock?: Signature;
};

class DisputeManager {
    signer: ethers.Signer;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelManagerContract: StateChannelManagerProxy;
    channelId: ChannelId;
    p2pEventHooks: P2pEventHooks;
    self = DEBUG_DISPUTE_HANDLER ? DebugProxy.createProxy(this) : this;
    storage: Storage;
    diamondStateMachine: ADiamondStateMachine;

    constructor(
        channelId: ChannelId,
        signer: ethers.Signer,
        signerAddress: Address,
        agreementManager: AgreementManager,
        stateChannelManagerContract: StateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks,
        storage: Storage,
        diamondStateMachine: ADiamondStateMachine
    ) {
        this.channelId = channelId;
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.agreementManager = agreementManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
        this.storage = storage;
        this.diamondStateMachine = diamondStateMachine;
        return this.self;
    }

    public async createDispute(
        forkId: ForkId,
        selfRemoval: boolean = false,
        timeoutOptions?: TimeoutOptions
    ): Promise<void> {
        const latestBlockHeight =
            this.storage.blocks.getNextBlockHeight(forkId) - 1;

        // StateProof, LatestStateSnapshot, LatestStateMachineState
        const [
            stateProof,
            latestStateSnapshot,
            latestStateMachineState,
            _onChainSlashes,
            _participants
        ] = await Promise.all([
            this.agreementManager.getStateProof(forkId, latestBlockHeight),
            this.storage.getStateSnapshot({
                forkId,
                height: latestBlockHeight
            }),
            this.diamondStateMachine.getState(), //TODO - this should be from storage
            this.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipantsUpToTimestamp(
                this.channelId,
                Clock.getTimeInSeconds() // this is safe as long as our local clock isn't infront of the DLT clock
            ),
            this.diamondStateMachine.getParticipants()
        ]);
        // onChainSlasshes
        // this can be a subset of on-chain slashes, so we don't need to run any race condition checks
        let onChainSlashes = new Set<Address>(_onChainSlashes);
        const participants = new Set<Address>(_participants);

        //sanity check
        if (!latestStateSnapshot || !latestStateMachineState) {
            throw new Error("createDispute - missing state information");
        }
        // sanity/race condition check
        if (
            latestStateSnapshot.stateMachineStateHash !==
            hash(latestStateMachineState)
        ) {
            throw new Error(
                "createDispute - latestStateSnapshot.stateMachineStateHash !== hash(latestStateMachineState)"
            );
        }

        // to make sure we're trying to slash only participants - even though onChainSlashes should always be a subset of participants
        onChainSlashes = intersection(onChainSlashes, participants);

        // timeout
        let timeoutStruct: TimeoutStruct;
        if (timeoutOptions) {
            // sanity/race condition check
            if (timeoutOptions.blockHeightToTimeout != latestBlockHeight + 1) {
                throw new Error(
                    "createDispute - timeoutOptions.blockHeightToTimeout invalid"
                );
            }
            const participantToTimeout =
                await this.diamondStateMachine.peekNextToWrite(
                    latestStateMachineState
                );
            timeoutStruct = {
                participant: participantToTimeout,
                blockHeight: timeoutOptions.blockHeightToTimeout,
                minTimeStamp: Clock.getTimeInSeconds(), // we're here since some higher level logic decided it want to timeout based on our own subjective clock
                isForced: timeoutOptions.isForced || false,
                previousBlockProducer:
                    timeoutOptions.previousBlockProducer || ethers.ZeroAddress,
                previousBlockProducerPostedCalldata:
                    timeoutOptions.previousBlockProducerPostedCalldata || false,
                participantSignatureOnPreviousBlock:
                    (timeoutOptions.participantSignatureOnPreviousBlock as Bytes) ||
                    ""
            };
        } else {
            timeoutStruct = this.getEmptyTimeoutStruct();
        }

        // AuditingData
        const { isPartial, auditingData } = this.getAuditingData(
            forkId,
            stateProof
        );
        if (isPartial)
            throw new Error("createDispute - isPartial auditingData");

        const disputeAuditingDataHash = hash(
            Codec.encode(auditingData, Type.DisputeAuditingData)
        );

        // disputer
        const disputer = this.signerAddress;

        const disputeInput: DisputeInputStruct = {
            channelId: this.channelId,
            genesisSnapshotDataHash: forkId,
            latestStateSnapshotHash: latestStateSnapshot.hash,
            stateProof: stateProof,
            onChainSlashes: Array.from(onChainSlashes),
            disputeAuditingDataHash: disputeAuditingDataHash,
            disputer: disputer,
            timeout: timeoutStruct,
            selfRemoval: selfRemoval
        };

        // generateDisputeOutputState
        const outputSnapshotData =
            await this.diamondStateMachine.computeDisputeOutputSnapshotData(
                disputeInput,
                latestStateSnapshot.toStruct(),
                latestStateMachineState,
                auditingData.genesisStateSnapshotData.latestJoinChannelBlockHash // latestJoinChannelBlockHash
            );
        const outputSnapshotDataHash = hash(
            Codec.encode(outputSnapshotData, Type.SnapshotData)
        );

        const dispute: DisputeStruct = {
            input: disputeInput,
            outputSnapshotDataHash: outputSnapshotDataHash
        };

        // ****** TODO - run auditing as a sanity check *******

        // TODO - dependent on the event trigger - maybe upload with auditing

        // TODO - Dispute model (like block), so it's easy doing operations on it

        const signedDispute = await SignatureUtils.signDispute(
            dispute,
            this.signer
        );
        const disputeConfirmation: DisputeConfirmationStruct = {
            signedDispute: {
                encodedDispute: signedDispute.encoded,
                signature: signedDispute.signature as BytesLike
            },
            signatures: []
        };

        this.stateChannelManagerContract.uploadDispute(disputeConfirmation);
    }

    public getAuditingData(
        forkId: ForkId,
        stateProof: StateProofStruct
    ): { isPartial: boolean; auditingData: DisputeAuditingDataStruct } {
        let isPartial = false;
        // genesisStateSnapshot
        const genesisStateSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        if (!genesisStateSnapshot)
            throw new Error(
                "getDisputeAuditingData - genesisStateSnapshot not found"
            );

        // milestoneSnapshots
        const milestoneSnapshots: StateSnapshot[] = [];
        for (const milestone of stateProof.milestones) {
            const snapshot =
                this.agreementManager.getSnapshotFromMilestone(milestone);
            if (!snapshot) {
                isPartial = true;
                milestoneSnapshots.push(genesisStateSnapshot); // this is just to push something to satisfy the soldity length requirement in `verifyMilestone`
            } else milestoneSnapshots.push(snapshot);
        }

        // latestStateSnapshot
        const latestBlock =
            this.agreementManager.getLatestBlockFromStateProof(stateProof);
        let latestStateSnapshot: StateSnapshot;
        if (!latestBlock) {
            latestStateSnapshot = genesisStateSnapshot;
        } else {
            const snapshot = this.storage.stateSnapshots.getStateSnapshotByHash(
                latestBlock.hash
            );
            if (!snapshot) {
                isPartial = true;
                latestStateSnapshot = genesisStateSnapshot; // just to use the field, verifyStateProof check will fail up to this point
            } else latestStateSnapshot = snapshot;
        }

        // latestStateStateMachineState
        const latestStateStateMachineState =
            this.storage.stateMachineStates.getStateMachineState(
                latestStateSnapshot.stateMachineStateHash
            );
        if (!latestStateStateMachineState)
            throw new Error(
                "getDisputeAuditingData - latestStateStateMachineState not found"
            );

        // exitChannelBlocks
        const fromBlockHash = latestStateSnapshot.latestExitBlockHash;
        const toBlockHash = genesisStateSnapshot.latestExitBlockHash;
        const exitChannelBlocks =
            this.storage.exitChannelBlocks.getBlocksInRange(
                fromBlockHash,
                toBlockHash
            );

        return {
            isPartial,
            auditingData: {
                genesisStateSnapshotData: genesisStateSnapshot.snapshotData,
                latestStateSnapshot: latestStateSnapshot.toStruct(),
                latestStateStateMachineState: latestStateStateMachineState,
                milestoneSnapshots: milestoneSnapshots.map((snapshot) =>
                    snapshot.toStruct()
                ),
                exitChannelBlocks: exitChannelBlocks
            }
        };
    }

    private getEmptyTimeoutStruct(): TimeoutStruct {
        return {
            participant: ethers.ZeroAddress,
            blockHeight: 0,
            minTimeStamp: 0,
            isForced: false,
            previousBlockProducer: ethers.ZeroAddress,
            previousBlockProducerPostedCalldata: false,
            participantSignatureOnPreviousBlock: ""
        };
    }

    public setChannelId(channelId: ChannelId) {
        this.channelId = channelId;
    }

    public setP2pEventHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pEventHooks = p2pEventHooks;
    }
}

export default DisputeManager;
