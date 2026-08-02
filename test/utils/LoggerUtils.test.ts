import { expect } from "chai";
import { ethers } from "ethers";
import { LoggerUtils } from "@/utils/LoggerUtils";
import * as factory from "@test/factory";

describe("LoggerUtils", function () {
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
                    factory.customEvmError("ErrorInvalidLatestState")
                )
            ).to.deep.equal({
                errorName: "ErrorInvalidLatestState",
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
