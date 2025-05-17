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
        timestamp: BigNumberish,
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
            this.agreementManager.forkService.collectMilestoneSnapshots(
                forkCnt
            );
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
            timestamp,
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
        proofs: ProofStruct[],
        timestamp: BigNumberish,
        timeout?: TimeoutStruct
    ): Promise<{
        dispute: DisputeStruct;
        disputeAuditingData: DisputeAuditingDataStruct;
    }> {
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

        const disputeAuditingData = this.createDisputeAuditingData(
            forkCnt,
            transactionCnt,
            disputeOutputStateSnapshot,
            timestamp,
            defaultDispute,
            ethers.MaxInt256
        );
        const disputeAuditingDataHash = ethers.keccak256(
            EvmUtils.encodeDisputeAuditingData(disputeAuditingData)
        );
        let timeoutDispute = timeout ?? defaultTimeout;
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
            timeout: timeoutDispute,
            selfRemoval: false
        };
        return { dispute, disputeAuditingData };
    }

    public async createNewDispute(
        forkCnt: number,
        transactionCnt: number,
        proofs: ProofStruct[],
        timestamp: BigNumberish
    ): Promise<void> {
        const dispute = await this.createDisputeStruct(
            forkCnt,
            transactionCnt,
            proofs,
            timestamp
        );

        await retry(
            async () => {
                const txResponse =
                    await this.stateChannelManagerContract.createDispute(
                        dispute.dispute
                    );
                const txReceipt = await txResponse.wait();
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

    public async auditDispute(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<AddressLike[]> {
        let slashParticipants: AddressLike[] = [];
        await retry(
            async () => {
                slashParticipants =
                    (await this.stateChannelManagerContract.auditDispute(
                        dispute,
                        disputeAuditingData
                    )) as unknown as AddressLike[];
                return slashParticipants;
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
        return slashParticipants;
    }

    public async challengeDispute(
        dispute: DisputeStruct,
        newDispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct
    ): Promise<void> {
        await retry(
            async () => {
                const txResponse =
                    await this.stateChannelManagerContract.challengeDispute(
                        dispute,
                        newDispute,
                        disputeAuditingData
                    );
                const txReceipt = await txResponse.wait();
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

    // listen to new dispoute and do audit after receciving the dispute and also do extra checks
    // like did the dispute return slashes, and does it use the latest state snapshot
    // TODO!!
    public onDispute(dispute: DisputeStruct): Promise<void> {
        // TODO
        return Promise.resolve();
    }
}

export default DisputeHandler;
