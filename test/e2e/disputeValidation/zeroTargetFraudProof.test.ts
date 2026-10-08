import { randomWallet } from "@test/factory";
import { submitZeroTargetProof } from "@test/fixtures/ZeroTargetFraudProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: dispute validation / zero-target dispute fraud proof", function () {
    it("outsider zero-target proof against an honest committed dispute -> no kill, no slash", async function () {
        const h = TestSession.getHarness();
        const outsider = randomWallet();
        const { slashedBefore, slashed } = await submitZeroTargetProof(
            h,
            1,
            async () => {
                await (
                    await h.getPeer(3).p2pInstance.chainSigner.sendTransaction({
                        to: outsider.address,
                        value: ethers.parseEther("1")
                    })
                ).wait();
                return outsider.connect(h.channelManager.runner!.provider!);
            }
        );

        expect(slashed, "outsider proof changes no slash").to.deep.equal(
            slashedBefore
        );
    });

    it("participant zero-target proof against an honest committed dispute -> submitter slashed, disputer survives", async function () {
        const h = TestSession.getHarness();
        const byzantineIndex = 2;
        await submitZeroTargetProof(h, 1, async () => {
            h.contextApi.markMaliciousPeer({
                maliciousPeerIndex: byzantineIndex
            });
            return h.getPeer(byzantineIndex).p2pInstance.chainSigner;
        });

        await h.assert.dispute.slashedOnChain(
            h.getPeer(byzantineIndex).address,
            "participant submitting an invalid proof must be on-chain slashed"
        );
    });
});
