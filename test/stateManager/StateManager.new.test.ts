import { expect } from "chai";
import sinon from "sinon";
import { stateSnapshot } from "../factory";
import { StateManagerTestBuilder, defaults } from "./StateManagerTestBuilder";

// Common test data structures
const exitChannelBlock = {
    exitChannels: [],
    previousBlockHash: defaults.emptyBlockHash // Points to on-chain hash
};

const signedBlock = {
    encodedBlock: "0xencoded",
    signature: "0xsignature"
};

const blockConfirmation = {
    signedBlock,
    signatures: []
};

// Test scenarios
const testScenarios = {
    emptyProof: {
        milestones: [],
        signedBlocks: []
    },

    singleMilestoneProof: {
        milestones: [
            {
                blockConfirmations: [blockConfirmation]
            }
        ],
        signedBlocks: []
    }
};

describe("StateManager - Refactored", () => {
    afterEach(() => {
        sinon.restore();
    });

    describe("prepareUpdateSnapshotSameFork", () => {
        it("should return undefined when no relevant milestones are found", async () => {
            // Arrange: Create StateManager with minimal setup
            const stateManager = new StateManagerTestBuilder()
                .withChannel(defaults.channelId)
                .withFork(defaults.forkId)
                .build();

            // Act
            const result = await stateManager.prepareUpdateSnapshotSameFork(
                defaults.forkId
            );

            // Assert
            expect(result).to.be.undefined;
        });

        it("should return undefined when latest snapshot equals current on-chain", async () => {
            // Arrange: Create a snapshot with same blockHeight as on-chain (3)
            const mockSnapshot = stateSnapshot({
                blockHeight: 3,
                forkId: defaults.forkId
            });

            const builder = new StateManagerTestBuilder()
                .withChannel(defaults.channelId)
                .withFork(defaults.forkId);

            builder
                .getAgreementManager()
                .withProof({
                    forkId: defaults.forkId,
                    height: 0,
                    proof: testScenarios.singleMilestoneProof
                })
                .withMilestoneSnapshot(mockSnapshot);

            const stateManager = builder.build();

            // Act
            const result = await stateManager.prepareUpdateSnapshotSameFork(
                defaults.forkId
            );

            // Assert - Should be undefined because milestone blockHeight (3) == on-chain blockHeight (3)
            expect(result).to.be.undefined;
        });

        it("should successfully prepare update data when valid milestones exist", async () => {
            // Arrange: Create a snapshot with higher blockHeight (5) than on-chain (3)
            const mockSnapshot = stateSnapshot({
                blockHeight: 5,
                forkId: defaults.forkId,
                snapshotData: {
                    ...stateSnapshot().snapshotData,
                    latestExitChannelBlockHash: "0x1234567890abcdef"
                }
            });

            const builder = new StateManagerTestBuilder()
                .withChannel(defaults.channelId)
                .withFork(defaults.forkId)
                .withDummyBlock() // So getNextBlockHeight returns 1, making latestBlockHeight = 0
                .withExitChannelBlock("0x1234567890abcdef", exitChannelBlock);

            builder
                .getAgreementManager()
                .withProof({
                    forkId: defaults.forkId,
                    height: 0,
                    proof: testScenarios.singleMilestoneProof
                })
                .withMilestoneSnapshot(mockSnapshot);

            const stateManager = builder.build();

            // Act
            const result = await stateManager.prepareUpdateSnapshotSameFork(
                defaults.forkId
            );

            // Assert - Should return update data because milestone blockHeight (5) > on-chain blockHeight (3)
            expect(result).to.not.be.undefined;
            expect(result!.milestoneProofs).to.have.length(1);
            expect(result!.milestoneSnapshots).to.have.length(1);
            expect(result!.exitChannelBlocks).to.be.an("array");
        });
    });
});
