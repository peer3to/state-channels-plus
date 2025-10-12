import { Block } from "../../src/models";
import { BlockValidationResult, TimeConfig } from "../../src/types";
import { stateSnapshot } from "../factory";
import sinon from "sinon";
import { ZeroHash } from "ethers";
import Clock from "../../src/Clock";
import { SnapshotDataStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export const ValidationFailure = {
    // Time validation failures (step 10 - last)
    OBJECTIVE_TIMESTAMP_TOO_LATE: "OBJECTIVE_TIMESTAMP_TOO_LATE",
    OBJECTIVE_TIMESTAMP_INVALID: "OBJECTIVE_TIMESTAMP_INVALID",
    SUBJECTIVE_TIMESTAMP_INVALID: "SUBJECTIVE_TIMESTAMP_INVALID",
    POSTED_ON_CHAIN_TOO_LATE: "POSTED_ON_CHAIN_TOO_LATE",

    // Leader validation failures (step 9)
    WRONG_LEADER: "WRONG_LEADER",

    // Linking validation failures (step 8)
    WRONG_GENESIS: "WRONG_GENESIS",
    NOT_LINKED_NON_GENESIS: "NOT_LINKED_NON_GENESIS",

    // Height validation failures (step 7)
    FUTURE_BLOCK: "FUTURE_BLOCK",

    // Fork dispute validation failures (step 6)
    FORK_DISPUTED_LOCALLY: "FORK_DISPUTED_LOCALLY",
    FORK_DISPUTED_ON_CHAIN: "FORK_DISPUTED_ON_CHAIN",

    // Conflict validation failures (step 5)
    DOUBLE_SIGN: "DOUBLE_SIGN",
    INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
    CONFLICTING_NOT_LINKED: "CONFLICTING_NOT_LINKED",

    // Author validation failures (step 4)
    AUTHOR_NOT_PARTICIPANT: "AUTHOR_NOT_PARTICIPANT",

    // Duplicate validation failures (step 3)
    QUEUED_INVALID_SIGNERS: "QUEUED_INVALID_SIGNERS",
    NO_NEW_SIGNATURES: "NO_NEW_SIGNATURES",
    INVALID_NEW_SIGNERS: "INVALID_NEW_SIGNERS",

    // Channel validation failures (step 2)
    CHANNEL_NOT_OPEN: "CHANNEL_NOT_OPEN",

    // Channel ID validation failures (step 1 - first)
    WRONG_CHANNEL_ID: "WRONG_CHANNEL_ID",
    NULL_CHANNEL_ID: "NULL_CHANNEL_ID"
} as const;

export type ValidationFailure =
    (typeof ValidationFailure)[keyof typeof ValidationFailure];

export class BlockBuilder {
    private blockData: any;
    private mockSetup: MockSetup;

    constructor(mockSetup: MockSetup) {
        this.mockSetup = mockSetup;
        this.blockData = this.createDefaultValidBlock();
    }

    static create(mockSetup: MockSetup): BlockBuilder {
        return new BlockBuilder(mockSetup);
    }

    /**
     * Configure the block to fail at a specific validation step
     */
    failWith(failure: ValidationFailure): BlockBuilder {
        this.setupMocksForFailure(failure);
        this.configureBlockForFailure(failure);
        return this;
    }

    build(): Block {
        return this.blockData as Block;
    }

    private createDefaultValidBlock(): any {
        return {
            channelId: "0xchannel123",
            forkId: "0xfork123",
            height: 1,
            author: "0xauthor123",
            timestamp: 950, // Valid: previous (900) + 50 <= previous + p2pTime (1000)
            previousBlockHash: "0xprevhash",
            hash: "0xblockhash",
            coordinates: { forkId: "0xfork123", height: 1 },
            onChainTimestamp: undefined,
            confirmationSignatures: new Set(["0xsig1", "0xsig2"]),
            confirmationSignerAddresses: new Set(["0xauthor123", "0xsigner1"]),
            signatureToAddress: sinon.stub().returns("0xsigner1"),
            getRelevantTimestamp: sinon.stub().returns(950),
            encode: sinon.stub().returns("0xencodedblock")
        };
    }

    private setupMocksForFailure(failure: ValidationFailure): void {
        this.mockSetup.setupForSuccess();

        switch (failure) {
            case ValidationFailure.WRONG_CHANNEL_ID:
                // Channel ID will be set to wrong value in configureBlockForFailure
                break;

            case ValidationFailure.NULL_CHANNEL_ID:
                this.mockSetup.mockStateManager.channelId = null;
                break;

            case ValidationFailure.CHANNEL_NOT_OPEN:
                this.mockSetup.mockStateManager.forkId = ZeroHash;
                break;

            case ValidationFailure.QUEUED_INVALID_SIGNERS:
                this.mockSetup.mockStorage.queues.isBlockQueued.returns(true);
                this.mockSetup.mockStorage.getParticipants
                    .withArgs(sinon.match.any)
                    .returns(["0xauthor123", "0xvalidsigner"]);
                break;

            case ValidationFailure.NO_NEW_SIGNATURES:
                const existingBlockSame = this.createExistingBlock([
                    "0xsig1",
                    "0xsig2"
                ]);
                this.mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xblockhash")
                    .returns(existingBlockSame);
                break;

            case ValidationFailure.INVALID_NEW_SIGNERS:
                const existingBlockPartial = this.createExistingBlock([
                    "0xsig1"
                ]);
                this.mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xblockhash")
                    .returns(existingBlockPartial);
                this.mockSetup.mockStorage.getParticipants
                    .withArgs(sinon.match.any)
                    .returns(["0xauthor123", "0xvalidsigner"]);
                break;

            case ValidationFailure.AUTHOR_NOT_PARTICIPANT:
                this.mockSetup.mockStorage.getParticipants
                    .withArgs(sinon.match.any)
                    .returns(["0xotherparticipant"]);
                break;

            case ValidationFailure.DOUBLE_SIGN:
                const conflictingSameAuthor = this.createConflictingBlock(
                    "0xauthor123",
                    "0xdifferenthash"
                );
                this.mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 1)
                    .returns(conflictingSameAuthor);
                break;

            case ValidationFailure.INVALID_STATE_TRANSITION:
                const conflictingDiffAuthor = this.createConflictingBlock(
                    "0xdifferentauthor",
                    "0xdifferenthash"
                );
                this.mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 1)
                    .returns(conflictingDiffAuthor);
                sinon
                    .stub(this.mockSetup.validationService as any, "isLinked")
                    .returns(true);
                break;

            case ValidationFailure.CONFLICTING_NOT_LINKED:
                const conflictingNotLinked = this.createConflictingBlock(
                    "0xdifferentauthor",
                    "0xdifferenthash"
                );
                this.mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 1)
                    .returns(conflictingNotLinked);
                sinon
                    .stub(this.mockSetup.validationService as any, "isLinked")
                    .returns(false);
                break;

            case ValidationFailure.FORK_DISPUTED_LOCALLY:
                this.mockSetup.mockStorage.disputes.didIDispute.returns(true);
                break;

            case ValidationFailure.FORK_DISPUTED_ON_CHAIN:
                this.mockSetup.mockDiamondStateMachine.localDiamondContract.isForkDisputed.resolves(
                    true
                );
                break;

            case ValidationFailure.FUTURE_BLOCK:
                this.mockSetup.mockStorage.blocks.getNextBlockHeight.returns(0); // Expecting 0, block is 1
                break;

            case ValidationFailure.WRONG_GENESIS:
                this.mockSetup.mockStorage.stateSnapshots.getGenesisSnapshotDataByForkId.returns(
                    {
                        hash: "0xrightgenesis"
                    }
                );
                break;

            case ValidationFailure.NOT_LINKED_NON_GENESIS:
                const prevBlock = this.createPreviousBlock("0xrightprev");
                this.mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 0)
                    .returns(prevBlock);
                break;

            case ValidationFailure.WRONG_LEADER:
                this.mockSetup.mockDiamondStateMachine.getNextToWrite.resolves(
                    "0xdifferentleader"
                );
                // Ensure the author is still a participant, so it doesn't fail at participant validation
                this.mockSetup.mockStorage.getParticipants
                    .withArgs(sinon.match.any)
                    .returns(["0xauthor123", "0xnotleader", "0xsigner1"]);
                break;

            case ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID:
                // Will be configured in configureBlockForFailure
                break;

            case ValidationFailure.OBJECTIVE_TIMESTAMP_TOO_LATE:
                // Will be configured in configureBlockForFailure
                break;

            case ValidationFailure.POSTED_ON_CHAIN_TOO_LATE:
                sinon
                    .stub(
                        this.mockSetup.validationService as any,
                        "isPostedOnChainTooLate"
                    )
                    .resolves(true);
                break;

            case ValidationFailure.SUBJECTIVE_TIMESTAMP_INVALID:
                this.mockSetup.clockStub.returns(8000); // Way outside agreementTime
                break;
        }
    }

    private configureBlockForFailure(failure: ValidationFailure): void {
        switch (failure) {
            case ValidationFailure.WRONG_CHANNEL_ID:
                this.blockData.channelId = "0xwrongchannel";
                break;

            case ValidationFailure.QUEUED_INVALID_SIGNERS:
                this.blockData.confirmationSignerAddresses = new Set([
                    "0xinvalidsigner"
                ]);
                break;

            case ValidationFailure.INVALID_NEW_SIGNERS:
                this.blockData.confirmationSignatures = new Set([
                    "0xsig1",
                    "0xsig2"
                ]);
                this.blockData.signatureToAddress = sinon
                    .stub()
                    .returns("0xinvalidsigner");
                break;

            case ValidationFailure.AUTHOR_NOT_PARTICIPANT:
                this.blockData.author = "0xnonparticipant";
                break;

            case ValidationFailure.WRONG_GENESIS:
                this.blockData.height = 0;
                this.blockData.previousBlockHash = "0xwronggenesis";
                this.blockData.coordinates = { forkId: "0xfork123", height: 0 };
                break;

            case ValidationFailure.NOT_LINKED_NON_GENESIS:
                this.blockData.previousBlockHash = "0xwrongprev";
                break;

            case ValidationFailure.WRONG_LEADER:
                this.blockData.author = "0xnotleader";
                break;

            case ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID:
                this.blockData.timestamp = 2500; // Way beyond p2pTime (900 + 1000 = 1900)
                break;

            case ValidationFailure.OBJECTIVE_TIMESTAMP_TOO_LATE:
                this.blockData.timestamp = 2500; // Invalid against previous timestamp
                const prevBlockWithOnChain =
                    this.createPreviousBlockWithOnChain();
                this.mockSetup.mockStorage.getPreviousBlockOrSnapshot.returns({
                    block: prevBlockWithOnChain
                });
                this.mockSetup.mockStorage.blocks.getBlock
                    .withArgs("0xfork123", 0)
                    .returns(prevBlockWithOnChain);
                break;
        }
    }

    private createExistingBlock(signatures: string[]): any {
        return {
            confirmationSignatures: new Set(signatures),
            hash: "0xblockhash"
        };
    }

    private createConflictingBlock(author: string, hash: string): any {
        return {
            author,
            hash,
            height: 1
        };
    }

    private createPreviousBlock(hash: string): any {
        return {
            height: 0,
            hash,
            timestamp: 900,
            getRelevantTimestamp: sinon.stub().returns(900)
        };
    }

    private createPreviousBlockWithOnChain(): any {
        return {
            height: 0,
            hash: "0xprevhash",
            timestamp: 900,
            onChainTimestamp: 950,
            getRelevantTimestamp: sinon.stub().returns(950)
        };
    }
}

export class MockSetup {
    public mockStorage: any;
    public mockDiamondStateMachine: any;
    public mockStateChannelManagerContract: any;
    public mockTimeConfig!: TimeConfig;
    public mockStateManager: any;
    public mockStrategy: any;
    public mockSigner: any;
    public mockP2pEventHooks: any;
    public clockStub!: sinon.SinonStub;
    public validationService: any; // Will be set by the test
    public mockSnapshotData: any; // Will be set by the test

    constructor() {
        this.setupMocks();
    }

    private setupMocks(): void {
        // Mock Clock
        this.clockStub = sinon.stub(Clock, "getTimeInSeconds").returns(1100);
        sinon.stub(Clock, "getAverageOnChainBlockTime").returns(12);

        this.mockSigner = {
            signMessage: sinon.stub().resolves("0xsignature"),
            getAddress: sinon
                .stub()
                .resolves("0x1234567890123456789012345678901234567890")
        };

        this.mockStorage = {
            queues: {
                isBlockQueued: sinon.stub().returns(false),
                queueBlock: sinon.stub(),
                tryDequeue: sinon.stub().returns([])
            },
            blocks: {
                getBlock: sinon.stub().returns(undefined),
                getNextBlockHeight: sinon.stub().returns(2),
                getLatestBlockHeight: sinon.stub().returns(10),
                getLatestBlock: sinon.stub().returns(undefined),
                setOnChainTimestamp: sinon.stub(),
                storeBlock: sinon.stub()
            },
            disputes: {
                didIDispute: sinon.stub().returns(false),
                getDisputeConfirmation: sinon.stub().returns({
                    signedDispute: { encodedDispute: "0xencodeddispute" }
                })
            },
            stateSnapshots: {
                getGenesisSnapshotDataByForkId: sinon.stub().returns({
                    hash: "0xprevhash"
                }),
                getStateSnapshotByHash: sinon.stub().returns(stateSnapshot()),
                storeStateSnapshot: sinon.stub()
            },
            exitChannelBlocks: {
                getExitChannelBlock: sinon.stub().returns({
                    exitChannels: [],
                    previousBlockHash: "0x0000000000000000"
                }),
                getExitChannelBlockEntry: sinon.stub().returns({
                    block: {
                        exitChannels: [],
                        previousBlockHash: "0x0000000000000000"
                    }
                }),
                getLatestExitChannelBlockHash: sinon
                    .stub()
                    .returns("0x0000000000000000"),
                getTotalWithdrawals: sinon
                    .stub()
                    .returns({ amount: 0n, data: "0x" }),
                storeExitChannelBlock: sinon.stub()
            },
            joinChannelBlocks: {
                getJoinChannelBlockEntry: sinon.stub().returns({
                    block: {
                        previousBlockHash: "0x0000000000000000"
                    }
                }),
                getLatestJoinChannelBlockHash: sinon
                    .stub()
                    .returns("0x0000000000000000"),
                getTotalDeposits: sinon
                    .stub()
                    .returns({ amount: 0n, data: "0x" }),
                storeJoinChannelBlock: sinon.stub()
            },
            exitPoints: {
                getExitPointsInRange: sinon.stub().returns([1, 3, 5, 7]),
                storeExitPoint: sinon.stub()
            },
            stateMachineStates: {
                getStateMachineState: sinon.stub().returns("0xencodedstate"),
                storeStateMachineState: sinon.stub()
            },
            getParticipants: sinon.stub().returns(["0xauthor123", "0xsigner1"]),
            getPreviousBlockOrSnapshot: sinon.stub().returns({
                block: {
                    height: 0,
                    timestamp: 900,
                    hash: "0xprevhash",
                    getRelevantTimestamp: sinon.stub().returns(900)
                }
            }),
            getPreviousStateSnapshot: sinon.stub().returns(stateSnapshot()),
            getStateSnapshot: sinon.stub().returns(stateSnapshot())
        };

        this.mockDiamondStateMachine = {
            getNextToWrite: sinon.stub().resolves("0xauthor123"),
            getParticipants: sinon
                .stub()
                .resolves(["0x1234567890123456789012345678901234567890"]),
            setState: sinon.stub().resolves(),
            getState: sinon.stub().resolves("0xencodedstate"),
            stateTransition: sinon.stub().resolves({
                success: true,
                successCallback: () => {},
                exitChannels: []
            }),
            getZeroBalance: sinon.stub().resolves({ amount: 0n, data: "0x" }),
            addBalance: sinon.stub().resolves({ amount: 100n, data: "0x" }),
            localDiamondContract: {
                isForkDisputed: sinon.stub().resolves(false),
                isBlockAuthentic: sinon.stub().resolves(true)
            }
        };

        this.mockStateChannelManagerContract = {
            getParticipants: sinon.stub().resolves(["0xauthor123"]),
            getPendingParticipants: sinon.stub().resolves([]),
            getBlockCallDataCommitment: sinon.stub().resolves({ found: false }),
            queryFilter: sinon.stub().resolves([]),
            filters: {
                BlockCalldataPosted: sinon.stub().returns("filter")
            },
            getStateSnapshot: sinon.stub().resolves({
                forkId: "0x1234567890abcdef",
                blockHeight: 3n,
                timestamp: 1000,
                snapshotData: {
                    originForkId: "0x1234567890abcdef",
                    stateMachineStateHash: "0xabcdef1234567890",
                    participants: [
                        "0x1234567890123456789012345678901234567890"
                    ],
                    latestJoinChannelBlockHash: "0x0000000000000000",
                    latestExitChannelBlockHash: "0x0000000000000000",
                    totalDeposits: { amount: 0n, data: "0x" },
                    totalWithdrawals: { amount: 0n, data: "0x" }
                }
            }),
            updateStateSnapshotSameFork: sinon.stub().resolves({
                wait: async () => ({})
            }),
            multicall: sinon.stub().resolves({
                wait: async () => ({})
            }),
            postBlockCalldata: sinon.stub().resolves({
                wait: async () => ({})
            }),
            isForkDisputed: sinon.stub().resolves(false),
            getReducedResult: sinon.stub().resolves([null, false]),
            getWindowCommitments: sinon.stub().resolves([]),
            reduce: {
                staticCall: sinon.stub().resolves({
                    latestBlock: { stateSnapshotHash: "0xlatestsnaphash" },
                    latestJoinChannelBlockHash: "0xlatestjoinblockhash"
                })
            },
            reduceAndFinalize: sinon.stub().resolves({
                wait: async () => ({})
            }),
            interface: {
                encodeFunctionData: sinon.stub().returns("0xencodeddata")
            }
        };

        this.mockTimeConfig = {
            p2pTime: 1000,
            agreementTime: 2000,
            chainFallbackTime: 3000,
            evidenceTime: 4000
        };

        this.mockStateManager = {
            channelId: "0xchannel123",
            forkId: "0xfork123"
        };

        this.mockP2pEventHooks = {
            onTurn: sinon.stub(),
            onPostingCalldata: sinon.stub()
        };

        this.mockStrategy = this.createMockStrategy();

        this.mockSnapshotData = {
            originForkId: "0x1234567890abcdef",
            stateMachineStateHash: "0xabcdef1234567890",
            participants: ["0x1234567890123456789012345678901234567890"],
            latestJoinChannelBlockHash: "0x0000000000000000",
            latestExitChannelBlockHash: "0x0000000000000000",
            totalDeposits: { amount: 0n, data: "0x" },
            totalWithdrawals: { amount: 0n, data: "0x" }
        } as SnapshotDataStruct;
    }

    async initializeClock(): Promise<void> {
        const mockProvider = {
            getBlock: async () => ({ timestamp: Math.floor(Date.now() / 1000) })
        };
        await Clock.init(mockProvider as any);
    }

    private createMockStrategy(): any {
        return {
            wrongChannel: sinon
                .stub()
                .resolves(BlockValidationResult.DISCONNECT),
            channelNotOpened: sinon
                .stub()
                .resolves(BlockValidationResult.NOT_READY),
            notAllSingersAreParticipants: sinon
                .stub()
                .resolves(BlockValidationResult.DISCONNECT),
            noNewSignaturesOnExistingBlock: sinon
                .stub()
                .resolves(BlockValidationResult.DUPLICATE),
            goodNewSignaturesOnExistingBlock: sinon
                .stub()
                .resolves(BlockValidationResult.BROADCAST),
            blockAuthorIsNotParticipant: sinon
                .stub()
                .resolves(BlockValidationResult.DISCONNECT),
            doubleSignDetected: sinon
                .stub()
                .resolves(BlockValidationResult.DISPUTE),
            invalidStateTransitionDetected: sinon
                .stub()
                .resolves(BlockValidationResult.DISPUTE),
            wrongGenesisDetected: sinon
                .stub()
                .resolves(BlockValidationResult.DISPUTE),
            conflictingButNotLinkedBlockDetected: sinon
                .stub()
                .resolves(BlockValidationResult.DISCONNECT),
            blockForkIsDisputed: sinon
                .stub()
                .resolves(BlockValidationResult.NOT_READY),
            blockIsNotNextAndIsInTheFuture: sinon
                .stub()
                .resolves(BlockValidationResult.NOT_READY),
            blockIsNotLinkedAndIsNotFirstBlock: sinon
                .stub()
                .resolves(BlockValidationResult.DISCONNECT),
            objectiveInvalidTimestampDetected: sinon
                .stub()
                .resolves(BlockValidationResult.DISPUTE),
            subjectiveInvalidTimestampDetected: sinon
                .stub()
                .resolves(BlockValidationResult.NOT_ENOUGH_TIME)
        };
    }

    setupForSuccess(): void {
        // Set up all conditions for success - exact copy from working debug test
        this.mockStateManager.channelId = "0xchannel123";
        this.mockStateManager.forkId = "0xfork123";
        this.mockStorage.queues.isBlockQueued.returns(false);
        this.mockStorage.blocks.getBlock.returns(undefined); // No duplicates or conflicts
        this.mockStorage.getParticipants
            .withArgs(sinon.match.any)
            .returns(["0xauthor123", "0xsigner1"]);
        this.mockStorage.disputes.didIDispute.returns(false);
        this.mockDiamondStateMachine.localDiamondContract.isForkDisputed.resolves(
            false
        );
        this.mockStorage.blocks.getNextBlockHeight.returns(2); // Expecting height 1

        // Set up linking for non-genesis block
        const prevBlock = {
            height: 0,
            hash: "0xprevhash",
            timestamp: 900,
            getRelevantTimestamp: sinon.stub().returns(900)
        };
        this.mockStorage.blocks.getBlock
            .withArgs("0xfork123", 0)
            .returns(prevBlock);
        this.mockStorage.getPreviousBlockOrSnapshot.returns({
            block: prevBlock
        });

        // Set up leader validation
        this.mockDiamondStateMachine.getNextToWrite.resolves("0xauthor123");

        // Set up time validation
        this.clockStub.returns(1100); // Within agreement time
    }

    cleanup(): void {
        sinon.restore();
    }
}

export const EXPECTED_RESULTS: Record<
    ValidationFailure,
    BlockValidationResult
> = {
    [ValidationFailure.WRONG_CHANNEL_ID]: BlockValidationResult.DISCONNECT,
    [ValidationFailure.NULL_CHANNEL_ID]: BlockValidationResult.DISCONNECT,
    [ValidationFailure.CHANNEL_NOT_OPEN]: BlockValidationResult.NOT_READY,
    [ValidationFailure.QUEUED_INVALID_SIGNERS]:
        BlockValidationResult.DISCONNECT,
    [ValidationFailure.NO_NEW_SIGNATURES]: BlockValidationResult.DUPLICATE,
    [ValidationFailure.INVALID_NEW_SIGNERS]: BlockValidationResult.DISCONNECT,
    [ValidationFailure.AUTHOR_NOT_PARTICIPANT]:
        BlockValidationResult.DISCONNECT,
    [ValidationFailure.DOUBLE_SIGN]: BlockValidationResult.DISPUTE,
    [ValidationFailure.INVALID_STATE_TRANSITION]: BlockValidationResult.DISPUTE,
    [ValidationFailure.CONFLICTING_NOT_LINKED]:
        BlockValidationResult.DISCONNECT,
    [ValidationFailure.FORK_DISPUTED_LOCALLY]: BlockValidationResult.NOT_READY,
    [ValidationFailure.FORK_DISPUTED_ON_CHAIN]: BlockValidationResult.NOT_READY,
    [ValidationFailure.FUTURE_BLOCK]: BlockValidationResult.NOT_READY,
    [ValidationFailure.WRONG_GENESIS]: BlockValidationResult.DISPUTE,
    [ValidationFailure.NOT_LINKED_NON_GENESIS]:
        BlockValidationResult.DISCONNECT,
    [ValidationFailure.WRONG_LEADER]: BlockValidationResult.DISPUTE,
    [ValidationFailure.OBJECTIVE_TIMESTAMP_INVALID]:
        BlockValidationResult.DISPUTE,
    [ValidationFailure.OBJECTIVE_TIMESTAMP_TOO_LATE]:
        BlockValidationResult.DISPUTE,
    [ValidationFailure.POSTED_ON_CHAIN_TOO_LATE]: BlockValidationResult.DISPUTE,
    [ValidationFailure.SUBJECTIVE_TIMESTAMP_INVALID]:
        BlockValidationResult.NOT_ENOUGH_TIME
};
