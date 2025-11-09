import { expect } from "chai";
import sinon from "sinon";
import StateManager from "@/stateManager/StateManager";
import { Address, ForkId, Timestamp } from "@/types/types";
import { Block } from "@/models";
import {
    SignedBlockStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { MockSetup } from "./testUtils";
import { createLogger, Logger } from "@/utils";

describe("StateManager", () => {
    let stateManager: StateManager;
    let mockSetup: MockSetup;
    let logger: Logger;
    beforeEach(async () => {
        sinon.restore();

        mockSetup = new MockSetup();
        await mockSetup.initializeClock();

        mockSetup.mockTimeConfig = {
            p2pTime: 15,
            agreementTime: 5,
            chainFallbackTime: 30,
            evidenceTime: 30
        };

        logger = createLogger({ component: "StateManager" });

        stateManager = new StateManager(
            mockSetup.mockSigner,
            "0x1234567890123456789012345678901234567890" as Address,
            mockSetup.mockStateChannelManagerContract as any,
            mockSetup.mockDiamondStateMachine as any,
            mockSetup.mockTimeConfig,
            mockSetup.mockP2pEventHooks as any,
            mockSetup.mockStorage as any,
            logger
        );

        stateManager.setChannelId("0xabcdef1234567890" as any);
        stateManager.forkId = "0x1234567890abcdef" as ForkId;
    });

    afterEach(() => {
        mockSetup.cleanup();
    });

    describe("onSignedBlock", () => {
        it("should process signed block correctly", async () => {
            const signedBlock: SignedBlockStruct = {
                encodedBlock: "0xencodedblock",
                signature: "0xsignature"
            };

            // Mock Block.fromBlockConfirmation to avoid actual decoding
            sinon.stub(Block, "fromBlockConfirmation").returns({
                author: "0x1234567890123456789012345678901234567890",
                forkId: "0x1234567890abcdef",
                height: 1,
                transaction: { header: { transactionCnt: 1n } },
                stateSnapshotHash: "0xsnaphash",
                blockConfirmationStruct: {
                    signedBlock,
                    signatures: []
                }
            } as any);

            const result = await stateManager.onSignedBlock(signedBlock);

            expect(result).to.be.a("boolean");
        });
    });

    describe("applyTransaction", () => {
        it("should apply transaction and return result", async () => {
            const transaction: TransactionStruct = {
                header: {
                    channelId: "0xabcdef1234567890",
                    participant: "0x1234567890123456789012345678901234567890",
                    forkId: "0x1234567890abcdef",
                    transactionCnt: 1n,
                    timestamp: 1000
                },
                body: {
                    encodedData: "0xtransactionbody",
                    data: "0xdata"
                }
            };

            const result = await stateManager.applyTransaction(transaction);

            expect(result).to.have.property("success");
            expect(result).to.have.property("encodedState");
            expect(result).to.have.property("successCallback");
            expect(result).to.have.property("exitChannels");
            expect(result).to.have.property("leftParticipants");
        });
    });

    describe("playTransaction", () => {
        it("should throw error when channel not open", async () => {
            const transaction: TransactionStruct = {
                header: {
                    channelId: "0xabcdef1234567890",
                    participant: "0x1234567890123456789012345678901234567890",
                    forkId: "0x1234567890abcdef",
                    transactionCnt: 1n,
                    timestamp: 1000
                },
                body: {
                    encodedData: "0xtransactionbody",
                    data: "0xdata"
                }
            };

            // Mock channel as closed
            stateManager.validationService.isChannelOpen = sinon
                .stub()
                .returns(false);

            await expect(
                stateManager.playTransaction(transaction)
            ).to.be.rejectedWith("Channel not open");
        });

        it("should throw error when not player's turn", async () => {
            const transaction: TransactionStruct = {
                header: {
                    channelId: "0xabcdef1234567890",
                    participant: "0x1234567890123456789012345678901234567890",
                    forkId: "0x1234567890abcdef",
                    transactionCnt: 1n,
                    timestamp: 1000
                },
                body: {
                    encodedData: "0xtransactionbody",
                    data: "0xdata"
                }
            };

            // Mock channel as open but not player's turn
            stateManager.validationService.isChannelOpen = sinon
                .stub()
                .returns(true);
            mockSetup.mockDiamondStateMachine.getNextToWrite.resolves(
                "0xdifferentplayer"
            );

            await expect(
                stateManager.playTransaction(transaction)
            ).to.be.rejectedWith("Not player turn");
        });
    });

    describe("getParticipantsCurrent", () => {
        it("should return current participants", async () => {
            const participants = await stateManager.getParticipantsCurrent();
            expect(participants).to.deep.equal([
                "0x1234567890123456789012345678901234567890"
            ]);
        });
    });

    describe("dispose", () => {
        it("should dispose resources correctly", async () => {
            // Mock p2pManager dispose
            const p2pManagerDisposeSpy = sinon
                .stub(stateManager.p2pManager, "dispose")
                .resolves();
            const eventListenerDisposeSpy = sinon.stub(
                stateManager.stateChannelEventListener,
                "dispose"
            );

            await stateManager.dispose();

            expect(stateManager.isDisposed).to.be.true;
            expect(eventListenerDisposeSpy.called).to.be.true;
            expect(p2pManagerDisposeSpy.called).to.be.true;
        });
    });

    describe("setReductionTimeout", () => {
        it("should set reduction timeout correctly", () => {
            const forkId = "0x1234567890abcdef" as ForkId;
            const triggerTimestamp = 2000;

            // Ensure the stateManager's forkId matches the one we're testing
            stateManager.forkId = forkId;

            stateManager.setReductionTimeout(forkId, triggerTimestamp);

            expect(stateManager.reductionTriggerMap.has(forkId)).to.be.true;
            const reductionHandle =
                stateManager.reductionTriggerMap.get(forkId);
            expect(reductionHandle).to.not.be.undefined;
            expect(reductionHandle!.triggerTimestamp).to.equal(
                triggerTimestamp
            );
            expect(reductionHandle!.handle).to.not.be.undefined;
        });
    });

    describe("onDisputeCommitted", () => {
        it("should throw not implemented error", async () => {
            const dispute = {} as any;
            const timestamp = 1000 as Timestamp;

            await expect(
                stateManager.onDisputeCommitted(dispute, timestamp)
            ).to.be.rejectedWith("TODO - Not implemented");
        });
    });

    describe("fetchUpdatedOnChainBlock", () => {
        it("should return undefined when commitment not found", async () => {
            mockSetup.mockStateChannelManagerContract.getBlockCallDataCommitment.resolves(
                { found: false }
            );

            const result = await stateManager.fetchUpdatedOnChainBlock(
                "0xfork123",
                1,
                "0xauthor123"
            );

            expect(result).to.be.undefined;
        });

        it("should handle errors gracefully", async () => {
            mockSetup.mockStateChannelManagerContract.getBlockCallDataCommitment.rejects(
                new Error("Network error")
            );

            const result = await stateManager.fetchUpdatedOnChainBlock(
                "0xfork123",
                1,
                "0xauthor123"
            );

            expect(result).to.be.undefined;
        });
    });

    describe("fetchBlockCommitmentCalldata", () => {
        it("should return undefined when multiple logs found", async () => {
            mockSetup.mockStateChannelManagerContract.queryFilter.resolves([
                { args: { signedBlock: {}, timestamp: 1500n } },
                { args: { signedBlock: {}, timestamp: 1600n } }
            ]);

            const result = await stateManager.fetchBlockCommitmentCalldata(
                "0xfork123",
                1,
                "0xauthor123",
                "0xcommitment"
            );

            expect(result).to.be.undefined;
        });

        it("should return undefined for no logs", async () => {
            mockSetup.mockStateChannelManagerContract.queryFilter.resolves([]);

            const result = await stateManager.fetchBlockCommitmentCalldata(
                "0xfork123",
                1,
                "0xauthor123",
                "0xcommitment"
            );

            expect(result).to.be.undefined;
        });
    });
});
