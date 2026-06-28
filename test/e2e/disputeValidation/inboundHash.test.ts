import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { Hash } from "@/types/types";
import { scenario } from "@test/harness/scenario";

// dispute.input.latestInboundMessageBlockHash is validated by walking the on-chain
// inbound chain backwards. Junk values that don't exist anywhere in the chain are
// caught by the DisputeInboundHashNotInChain fraud proof. The genesis 0x0 + height=0
// happy path lives in disputeValidation/uploadRevert/latestInboundMessageBlockHash.test.ts.

describe("E2E: dispute validation / inboundHash", function () {
    scenario(
        "dispute.input.latestInboundMessageBlockHash = random (not on-chain) → DisputeInboundHashNotInChain",
        { target: "DisputeInput.latestInboundMessageBlockHash:not-in-chain" },
        async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(0, (dispute, sm) => {
                dispute.input.latestInboundMessageBlockHash =
                    sm.p2pManager.localRpc.dispute.randomHash() as Hash;
            });

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInboundHashNotInChain,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        }
    );

    scenario(
        "dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight > 0 → DisputeInboundHashNotInChain",
        { target: "DisputeInput.lastInboundMessageBlockHeight:mismatch" },
        async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(0, (dispute, sm) => {
                dispute.input.latestInboundMessageBlockHash = sm.p2pManager
                    .localRpc.dispute.zeroHash as Hash;
                dispute.input.lastInboundMessageBlockHeight = 999999n;
            });

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast",
                timeoutMs: 10000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInboundHashNotInChain,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        }
    );
});
