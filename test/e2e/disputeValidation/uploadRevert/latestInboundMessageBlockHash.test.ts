import { MathTestSession as TestSession } from "@test/harness";
import { ethers } from "ethers";

describe("E2E: dispute validation / uploadRevert / latestInboundMessageBlockHash", function () {
    it("dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight = 0 → dispute upload succeeds (genesis anchor is always a valid ancestor)", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetupCalldataPath();

        // bytes32(0) is the genesis anchor — always valid at upload time even when
        // the on-chain inbound chain has advanced past genesis. `_isDisputeInboundHashValid`
        // walks the inbound chain backwards and accepts any valid ancestor + height match.
        await h.tamper.postTamperedDispute(1, (dispute) => {
            dispute.input.latestInboundMessageBlockHash = ethers.ZeroHash;
            dispute.input.lastInboundMessageBlockHeight = 0n;
        });

        // Upload succeeded → at least one dispute committed on-chain on the active fork.
        await h.assert.dispute.committedWait({
            peersIndices: [1],
            expectedCount: 1
        });
    });

    // dispute.input.latestInboundMessageBlockHash junk variants (non-genesis hash, or
    // genesis hash with height>0) are exercised in disputeInputFields/inboundHash.test.ts —
    // they trigger DisputeInboundHashNotInChain via the fraud-proof pipeline, not via
    // upload revert, so they live under the field-level coverage tree.
});
