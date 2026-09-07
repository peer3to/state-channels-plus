import { BlockValidationResult, Status } from "@/types/flags";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { LogStore } from "@/utils/logging/logStore";
import { NodeLogger } from "@/utils/logging/node/NodeLogger";
import * as factory from "@test/factory";
import { expect } from "chai";
import { ethers } from "ethers";

describe("LoggerUtils", function () {
    it("formats known and unknown numeric enum members without changing strings", function () {
        expect(LoggerUtils.enumToString(Status, Status.SYNCED)).to.equal(
            "SYNCED"
        );
        expect(LoggerUtils.enumToString(Status, -1)).to.equal("UNKNOWN(-1)");
        expect(
            LoggerUtils.enumToString<Record<string, string | number>>(
                Status,
                "custom"
            )
        ).to.equal("custom");
    });

    it("logs objective time failure using captured time and previous timestamps", function () {
        const block = factory.block();
        const store = new LogStore(1024 * 1024, true);
        const logger = new NodeLogger(
            {},
            {},
            "verbose",
            store,
            { attachErrorListener: false },
            new Set(),
            true
        );
        try {
            LoggerUtils.logTimeValidationFailed(logger, {
                block,
                nowSeconds: block.timestamp + 10,
                checkType: "objective",
                validationResult: BlockValidationResult.DISPUTE,
                allowedSkewSeconds: 3,
                violatedRule: "previous timestamp",
                previousTimestamp: 1,
                previousOriginalTimestamp: 0
            });
            const entry = store.getAllLogs()[0];
            expect(entry.level).to.equal("warn");
            expect(entry.message).to.equal(
                "Time validation failed - block timestamp outside allowed window"
            );
            expect(entry.meta[0]).to.deep.equal({
                checkType: "objective",
                violatedRule: "previous timestamp",
                validationResult: "DISPUTE",
                blockHeight: block.height,
                nowSeconds: block.timestamp + 10,
                blockTimestamp: block.timestamp,
                differenceSeconds: 10,
                allowedSkewSeconds: 3,
                excessSeconds: 7,
                previousTimestamp: 1,
                previousOriginalTimestamp: 0
            });
        } finally {
            logger.dispose();
        }
    });

    it("omits previous timestamp fields for subjective time failures", function () {
        const block = factory.block();
        const store = new LogStore(1024 * 1024, true);
        const logger = new NodeLogger(
            {},
            {},
            "verbose",
            store,
            { attachErrorListener: false },
            new Set(),
            true
        );
        try {
            LoggerUtils.logTimeValidationFailed(logger, {
                block,
                nowSeconds: block.timestamp - 2,
                checkType: "subjective",
                validationResult: BlockValidationResult.NOT_ENOUGH_TIME,
                allowedSkewSeconds: 3,
                violatedRule: "arrival",
                previousTimestamp: 1
            });
            const metadata = store.getAllLogs()[0].meta[0];
            expect(metadata.differenceSeconds).to.equal(2);
            expect(metadata.excessSeconds).to.equal(0);
            expect(metadata).not.to.have.property("previousTimestamp");
            expect(metadata).not.to.have.property("previousOriginalTimestamp");
        } finally {
            logger.dispose();
        }
    });

    it("builds contract-call metadata from encoded calldata", function () {
        const contractInterface = new ethers.Interface([
            "function setValue(uint256 value)"
        ]);
        const encodedData = contractInterface.encodeFunctionData("setValue", [
            42n
        ]);
        const contractAddress = ethers.Wallet.createRandom().address;

        expect(
            LoggerUtils.getContractCallMetadata(encodedData, contractAddress)
        ).to.deep.equal({
            contractAddress,
            functionSelector: encodedData.slice(0, 10),
            calldataBytes: ethers.dataLength(encodedData)
        });
    });

    describe("getCustomEvmErrorMetadata", function () {
        it("names every revert arg from the error ABI", function () {
            const expectedParticipant = factory.randomAddress();
            const actualSubmitter = factory.randomAddress();

            const metadata = LoggerUtils.getCustomEvmErrorMetadata(
                factory.customEvmError("ErrorJoinChannelInvalidSubmitter", [
                    expectedParticipant,
                    actualSubmitter
                ])
            );

            // nothing here lists those field names - they come off the decoded
            // result, so any custom error describes itself in the log
            expect(metadata).to.deep.equal({
                errorName: "ErrorJoinChannelInvalidSubmitter",
                args: { expectedParticipant, actualSubmitter }
            });
        });

        it("keeps numeric revert args as bigints", function () {
            const submittedSnapshotInboundHash = factory.hash();
            const expectedTargetInboundHash = factory.hash();
            const runningInboundHash = factory.hash();

            const metadata = LoggerUtils.getCustomEvmErrorMetadata(
                factory.customEvmError(
                    "ErrorDisputeInboundMessageBlocksInvalid",
                    [
                        submittedSnapshotInboundHash,
                        expectedTargetInboundHash,
                        runningInboundHash,
                        1,
                        3,
                        2
                    ]
                )
            );

            // the log pipeline stringifies bigints on its way out, so they must
            // arrive here intact rather than narrowed to a lossy number
            expect(metadata?.args).to.deep.equal({
                submittedSnapshotInboundHash,
                expectedTargetInboundHash,
                runningInboundHash,
                breakIndex: 1n,
                submittedBlockCount: 3n,
                failureReason: 2n
            });
        });

        it("an error without args still reports its name", function () {
            expect(
                LoggerUtils.getCustomEvmErrorMetadata(
                    factory.customEvmError("ErrorNoDisputesProvided")
                )
            ).to.deep.equal({
                errorName: "ErrorNoDisputesProvided",
                args: []
            });
        });

        it("no decoded custom error yields no metadata", function () {
            // tryDecodeCustomError returns null; an optional caller has undefined
            expect(LoggerUtils.getCustomEvmErrorMetadata(null)).to.equal(
                undefined
            );
            expect(LoggerUtils.getCustomEvmErrorMetadata(undefined)).to.equal(
                undefined
            );
        });
    });

    it("reports each message block's previousBlockHash", function () {
        const blocks = factory.linkedMessageBlocks(3);

        const metadata = blocks.map((messageBlock) =>
            LoggerUtils.getMessageBlockMetadata(messageBlock)
        );

        // the linkage `_verifyInboundMessageBlocks` walks; without it a log of
        // a failed inbound check cannot say where the chain broke
        expect(metadata.map((entry) => entry.previousBlockHash)).to.deep.equal(
            blocks.map((messageBlock) => String(messageBlock.previousBlockHash))
        );
    });

    it("pairs the submitted snapshot head with the computed reduction target", function () {
        const submittedSnapshotInboundHash = factory.hash();
        const computedTargetInboundHash = factory.hash();
        const inboundMessageBlocks = factory.linkedMessageBlocks(
            2,
            submittedSnapshotInboundHash
        );
        const reduceData = factory.reduceData({
            latestStateSnapshot: {
                snapshotData: factory.snapshotData({
                    latestInboundMessageBlockHash: submittedSnapshotInboundHash
                }),
                forkId: factory.zeroHex(),
                blockHeight: 0n,
                timestamp: 0n
            },
            reducedOutput: factory.reduceOutput({
                latestInboundMessageBlockHash: computedTargetInboundHash
            }),
            inboundMessageBlocks
        });

        const metadata = LoggerUtils.getReductionInboundMetadata(reduceData);

        expect(metadata.submittedSnapshotInboundHash).to.equal(
            submittedSnapshotInboundHash
        );
        expect(metadata.computedTargetInboundHash).to.equal(
            computedTargetInboundHash
        );
        expect(metadata.submittedInboundBlocks).to.deep.equal(
            inboundMessageBlocks.map((messageBlock) =>
                LoggerUtils.getMessageBlockMetadata(messageBlock)
            )
        );
    });
});
