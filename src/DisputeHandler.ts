import { AddressLike, BigNumberish, BytesLike, ethers } from "ethers";
import AgreementManager from "./agreementManager";
import { AStateChannelManagerProxy } from "@typechain-types";
import {
    ProofStruct,
    DisputeStruct,
    TimeoutStruct,
    StateProofStruct
} from "@typechain-types/contracts/V1/DisputeTypes";
import {
    BalanceStruct,
    ExitChannelBlockStruct,
    SignedBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { EvmUtils, DebugProxy, retry } from "@/utils";
import P2pEventHooks from "@/P2pEventHooks";
import ProofManager from "./ProofManager";
import { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";

let DEBUG_DISPUTE_HANDLER = true;

// Constants for commonly used values
const NO_PARTICIPANT_TO_FOLD = "0x00";
const INITIAL_TRANSACTION_COUNT = 0;

type ForkCnt = number;

interface DisputeOutputState {
    encodedModifiedState: string;
    exitBlock: ExitChannelBlockStruct;
    totalDeposits: BalanceStruct;
    totalWithdrawals: BalanceStruct;
}
class DisputeHandler {
    signer: ethers.Signer;
    signerAddress: AddressLike;
    agreementManager: AgreementManager;
    stateChannelManagerContract: AStateChannelManagerProxy;
    channelId: BytesLike;
    localProofs: Map<ForkCnt, ProofStruct[]> = new Map();
    disputes: Map<ForkCnt, DisputeStruct> = new Map();
    disputedForks: Map<ForkCnt, boolean> = new Map();
    p2pEventHooks: P2pEventHooks;
    self = DEBUG_DISPUTE_HANDLER ? DebugProxy.createProxy(this) : this;
    proofManager: ProofManager;

    constructor(
        channelId: BytesLike,
        signer: ethers.Signer,
        signerAddress: AddressLike,
        agreementManager: AgreementManager,
        stateChannelManagerContract: AStateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks
    ) {
        this.channelId = channelId;
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.agreementManager = agreementManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
        this.proofManager = new ProofManager(agreementManager);
        return this.self;
    }

    public setP2pEventHooks(p2pEventHooks: P2pEventHooks): void {
        this.p2pEventHooks = p2pEventHooks;
    }

    public setChannelId(channelId: BytesLike): void {
        this.channelId = channelId;
    }

    // creating a dispute auditing data struct
    public createDisputeAuditingData(
        forkCnt: number,
        transactionCnt: number,
        outputStateSnapshot: StateSnapshotStruct,
        prevDispute: DisputeStruct,
        prevDisputeTimestamp: BigNumberish
    ): DisputeAuditingDataStruct {
        const genesisStateSnapshot =
            this.agreementManager.getForkGenesisStateSnapshot(forkCnt);
        if (!genesisStateSnapshot) {
            throw new Error(
                `DisputeHandler - createDisputeAuditingData - no genesis state snapshot for fork: ${forkCnt}`
            );
        }
        const latestStateSnapshot = this.agreementManager.getSnapShot(
            forkCnt,
            transactionCnt
        );
        if (!latestStateSnapshot) {
            throw new Error(
                `DisputeHandler - createDisputeAuditingData - no latest state snapshot for fork: ${forkCnt}`
            );
        }
        const milestoneSnapshots =
            this.agreementManager.getMilestoneSnapshots(forkCnt);
        const latestStateStateMachineState =
            this.agreementManager.getStateMachineState(forkCnt, transactionCnt);
        if (!latestStateStateMachineState) {
            throw new Error(
                `DisputeHandler - createDisputeAuditingData - no latest state state machine state for fork: ${forkCnt}`
            );
        }
        const joinChannelBlocks = this.agreementManager.getJoinChannelChain(
            this.channelId
        );

        const disputeAuditingData: DisputeAuditingDataStruct = {
            genesisStateSnapshot: genesisStateSnapshot,
            latestStateSnapshot: latestStateSnapshot,
            outputStateSnapshot: outputStateSnapshot,
            milestoneSnapshots: milestoneSnapshots,
            latestStateStateMachineState: latestStateStateMachineState,
            joinChannelBlocks: joinChannelBlocks,
            previousDispute: prevDispute,
            previousDisputeTimestamp: prevDisputeTimestamp
        };
        return disputeAuditingData;
    }

    private collectStateProof(forkCnt: number): StateProofStruct {
        const forkProof =
            this.agreementManager.forkService.getForkProof(forkCnt)!;
        const signedBlocks =
            this.agreementManager.getForkProofSignedBlocks(forkCnt);
        const stateProof: StateProofStruct = {
            forkProof: forkProof,
            signedBlocks: signedBlocks
        };
        return stateProof;
    }

    private createDefaultDisputeStruct(): {
        dispute: DisputeStruct;
        timeout: TimeoutStruct;
    } {
        const timeout: TimeoutStruct = {
            participant: ethers.ZeroAddress,
            blockHeight: ethers.MaxUint256,
            minTimeStamp: ethers.MaxUint256,
            forkCnt: 0,
            isForced: false,
            previousBlockProducer: ethers.ZeroAddress,
            previousBlockProducerPostedCalldata: false
        };

        let dispute: DisputeStruct = {
            channelId: this.channelId,
            genesisStateSnapshotHash: "",
            latestStateSnapshotHash: "",
            stateProof: {
                forkProof: {
                    forkMilestoneProofs: []
                },
                signedBlocks: []
            },
            fraudProofs: [],
            onChainSlashes: [],
            onChainLatestJoinChannelBlockHash: "",
            outputStateSnapshotHash: "",
            exitChannelBlocks: [],
            disputeAuditingDataHash: "",
            disputer: this.signerAddress,
            disputeIndex: 0,
            previousRecursiveDisputeIndex: ethers.MaxUint256,
            timeout,
            selfRemoval: false
        };
        return { dispute, timeout };
    }

    private async createDisputeStruct(
        forkCnt: number,
        transactionCnt: number,
        proofs: ProofStruct[]
    ): DisputeStruct {
        const disputeIndex =
            await this.stateChannelManagerContract.getDisputeLength(
                this.channelId
            );
        const genesisStateSnapshotHash =
            this.agreementManager.getForkGenesisStateSnapshot(
                forkCnt
            )!.stateMachineStateHash;
        const latestStateSnapshotHash = this.agreementManager.getSnapShot(
            forkCnt,
            transactionCnt
        )!.stateMachineStateHash;
        const stateProof = this.collectStateProof(forkCnt);
        const onChainSlashes =
            await this.stateChannelManagerContract.getOnChainSlashedParticipants(
                this.channelId
            );
        const onChainLatestJoinChannelBlockHash =
            this.agreementManager.getLatestJoinChannelBlockHash(this.channelId);
        const latestExitChannelBlockHash =
            this.agreementManager.getLatestJoinChannelBlockHash(this.channelId);
        const exitChannelBlocks = this.agreementManager.getExitChannelChain(
            this.channelId
        );

        const {
            encodedModifiedState,
            exitBlock,
            totalDeposits,
            totalWithdrawals
        } = (await this.stateChannelManagerContract.generateDisputeOutputState(
            this.agreementManager.getStateMachineState(
                forkCnt,
                transactionCnt
            )!,
            proofs,
            { channelId: this.channelId },
            onChainSlashes,
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            this.agreementManager.getJoinChannelChain(this.channelId),
            this.agreementManager.getSnapShot(forkCnt, transactionCnt)!
        )) as unknown as DisputeOutputState;

        const participants =
            (await this.stateChannelManagerContract.getStatemachineParticipants(
                encodedModifiedState
            )) as unknown as AddressLike[];
        const disputeOutputStateSnapshot: StateSnapshotStruct = {
            stateMachineStateHash: ethers.keccak256(
                ethers.toUtf8Bytes(encodedModifiedState)
            ),
            participants,
            forkCnt: forkCnt + 1,
            latestExitChannelBlockHash,
            latestJoinChannelBlockHash: onChainLatestJoinChannelBlockHash,
            totalDeposits,
            totalWithdrawals
        };
        const disputeOutputStateSnapshotHash = ethers.keccak256(
            EvmUtils.encodeStateSnapshot(disputeOutputStateSnapshot)
        );

        const { dispute: defaultDispute, timeout: defaultTimeout } =
            this.createDefaultDisputeStruct();
        const disputeAuditingDataHash = ethers.keccak256(
            EvmUtils.encodeDisputeAuditingData(
                this.createDisputeAuditingData(
                    forkCnt,
                    transactionCnt,
                    disputeOutputStateSnapshot,
                    defaultDispute,
                    ethers.MaxInt256
                )
            )
        );

        let dispute: DisputeStruct = {
            channelId: this.channelId,
            genesisStateSnapshotHash: genesisStateSnapshotHash,
            latestStateSnapshotHash: latestStateSnapshotHash,
            stateProof: stateProof,
            fraudProofs: proofs,
            onChainSlashes,
            onChainLatestJoinChannelBlockHash,
            outputStateSnapshotHash: disputeOutputStateSnapshotHash,
            exitChannelBlocks,
            disputeAuditingDataHash,
            disputer: this.signerAddress,
            disputeIndex: disputeIndex,
            previousRecursiveDisputeIndex: ethers.MaxUint256,
            timeout: defaultTimeout,
            selfRemoval: false
        };
    }

    public async createNewDispute(
        forkCnt: number,
        transactionCnt: number,
        proofs: ProofStruct[]
    ): Promise<void> {
        const dispute = await this.createDisputeStruct(
            forkCnt,
            transactionCnt,
            proofs
        );

        await retry(
            async () => {
                const txResponse =
                    await this.stateChannelManagerContract.createDispute(
                        dispute
                    );
                console.log("TX HASH ##", txResponse.hash);
                const txReceipt = await txResponse.wait();
                console.log("DISPUTE CREATED ##", txReceipt);
                return txReceipt;
            },
            {
                maxRetries: 1, // Current implementation retries once
                onRetry: (attempt, error) => {
                    console.log("ERROR - DISPUTE CATCH ##", error);
                    console.log(
                        `Retrying dispute creation, attempt ${attempt}`
                    );
                }
            }
        );
    }

    public setForkDisputed(forkCnt: number): void {
        this.disputedForks.set(forkCnt, true);
    }
    public isForkDisputed(forkCnt: number): boolean {
        return this.disputedForks.get(forkCnt) ?? false;
    }
    private addProof(forkCnt: number, proof: ProofStruct): void {
        const proofs = this.localProofs.get(forkCnt) || [];
        proofs.push(proof);
        this.localProofs.set(forkCnt, proofs);
    }

    private shouldUpdateDispute(dispute: DisputeStruct): boolean {
        const forkCnt = Number(dispute.forkCnt);
        const existingDispute = this.disputes.get(forkCnt);

        return (
            !existingDispute ||
            dispute.challengeCnt > existingDispute.challengeCnt
        );
    }

    private updateDisputeIfNewer(dispute: DisputeStruct): boolean {
        if (this.shouldUpdateDispute(dispute)) {
            const forkCnt = Number(dispute.forkCnt);
            this.disputes.set(forkCnt, dispute);
            return true;
        }

        return false;
    }

    private async rechallengeRecursive(dispute: DisputeStruct): Promise<void> {
        if (!this.updateDisputeIfNewer(dispute)) {
            return; // Early return if we already have a newer dispute
        }

        //proofs
        const proofs = this.extractProofs(dispute);
        if (proofs.length == 0) return; //no proofs - no need to rechallenge
        try {
            const {
                encodedLatestFinalizedState,
                encodedLatestCorrectState,
                virtualVotingBlocks
            } = this.agreementManager.getFinalizedAndLatestWithVotes(
                dispute.forkCnt,
                this.signerAddress
            );
            this.p2pEventHooks.onInitiatingDispute?.();
            const _txReceipt = await this.stateChannelManagerContract
                .challengeDispute(
                    this.channelId,
                    dispute.forkCnt,
                    Number(dispute.challengeCnt) + 1,
                    proofs,
                    virtualVotingBlocks,
                    encodedLatestFinalizedState,
                    encodedLatestCorrectState,
                    { gasLimit: 2000000 } //TODO! - gas limit
                )
                .then((txResponse) => txResponse.wait());
        } catch (e) {
            // TODO! - in hardhat test network (unlike production networks) - on revert - there is no txReceipt -> it will throw and be caught here
        }
        const newDispute = await this.stateChannelManagerContract.getDispute(
            dispute.channelId
        );
        if (newDispute.challengeCnt == dispute.challengeCnt) {
            throw new Error(
                "DisputeHandler - rechallengeRecursive - challenge failed"
            );
        }
        return this.rechallengeRecursive(newDispute);
    }

    // Extracts dispute proofs to be tracked locally
    private extractProofs(dispute: DisputeStruct): ProofStruct[] {
        const forkCnt = Number(dispute.forkCnt);
        const transactionCnt = Number(dispute.foldedTransactionCnt);

        // Can challenge timeout?
        if (dispute.timedoutParticipant !== ethers.ZeroAddress) {
            const timeoutProof = this.proofManager.createFoldRechallengeProof(
                forkCnt,
                transactionCnt
            );
            if (timeoutProof) {
                this.addProof(forkCnt, timeoutProof);
            }
        }
        // Handle newer state proof
        const lastTransactionCnt = this.getLastTransactionCount(dispute);
        const newerStateProof = this.proofManager.createNewerStateProof(
            forkCnt,
            dispute.postedStateDisputer,
            lastTransactionCnt
        );

        if (newerStateProof) this.addProof(forkCnt, newerStateProof);

        // Return filtered proofs
        return this.filterProofs(dispute);
    }

    private getLastTransactionCount(dispute: DisputeStruct): number {
        if (dispute.virtualVotingBlocks.length === 0) return 0;

        // Extract from the last block
        const lastBlock = EvmUtils.decodeBlock(
            dispute.virtualVotingBlocks.at(-1)!.encodedBlock
        );
        return Number(lastBlock.transaction.header.transactionCnt);
    }

    // listen to new dispoute and do audit after receciving the dispute
    // TODO!!
    public onDisputeCreated(dispute: DisputeStruct): Promise<void> {
        this.setForkDisputed(Number(dispute.forkCnt));
        return this.rechallengeRecursive(dispute);
    }
}

export default DisputeHandler;
