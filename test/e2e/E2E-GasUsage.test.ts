import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

/**
 * E2E Tests for the aggregated gas usage table
 *
 * Maps to: src/evm/gasUsage/
 *          src/evm/signer/HostNonceManager.ts
 *
 * A peer's table must hold the real receipt of every chain transaction that
 * peer sent, and nothing else.
 */
describe("E2E: Gas Usage", function () {
    it("records the block calldata a peer posted on chain and nothing it never called", async function () {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(3);
        await h.transition.advanceState({ count: 1 });
        await h.assert.sync.peersInSyncWait();

        const block = await h
            .control(h.getPeer(0))
            .query.getBlockByHeight(forkId, 0)
            .request();
        expect(block, "block 0 must be stored").to.not.be.null;
        // only the block's own author may post its calldata
        const author = h.peers.find((peer) => peer.address === block!.author)!;
        expect(author, "block 0 author must be a peer").to.not.be.undefined;

        await h
            .control(author)
            .validation.postBlockCalldataOnChain(block!.encodedSignedBlock)
            .request();

        // the shipped public read, across the chain-signer port
        const gasUsage = await author.p2pInstance.getGasUsageTable();

        const post = gasUsage.find(
            (row) => row.functionName === "postBlockCalldata"
        );
        expect(post, "the calldata post must be recorded").to.not.be.undefined;
        expect(post!.contractAddress).to.equal(
            await author.p2pInstance.stateChannelManagerContract.getAddress()
        );
        expect(post!.functionSelector).to.equal(
            ethers.id("postBlockCalldata((bytes,bytes),uint256)").slice(0, 10)
        );
        expect(post!.successCount).to.equal(1);
        expect(post!.revertedCount).to.equal(0);
        expect(post!.revertedGasUsed).to.equal("0");
        expect(
            BigInt(post!.successGasUsed) > 0n,
            "a mined post burns gas"
        ).to.equal(true);
        expect(post!.successGasUsed).to.equal(post!.minGasUsed);
        expect(post!.successGasUsed).to.equal(post!.maxGasUsed);
        // the harness opens the channel from the test process, so no peer
        // signer ever sent `open`
        expect(gasUsage.some((row) => row.functionName === "open")).to.equal(
            false
        );
        // both readers settle through the same owner, so they agree
        const { gasUsage: harnessRows } = await h
            .control(author)
            .query.getGasUsageTable()
            .request();
        expect(harnessRows).to.deep.equal(gasUsage);
    });
});
