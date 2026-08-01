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
