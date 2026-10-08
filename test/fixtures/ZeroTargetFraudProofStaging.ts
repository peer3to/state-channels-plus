// @spec-test-coverage-ignore: zero-target dispute fraud proof staging shared by mapped e2e tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash } from "@/utils";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ethers, Signer } from "ethers";

// an invalid dispute fraud proof yields the zero verdict; naming zero as the
// target must not count as a match and kill an honest committed dispute
export async function submitZeroTargetProof(
    h: MathPeerTestHarness,
    honestDisputerIndex: number,
    resolveSubmitter: () => Promise<Signer>
) {
    await h.lifecycle.timeoutSetup(4);
    await h.assert.dispute.initiatedWait({
        peersIndices: [honestDisputerIndex]
    });
    // peers 1,2,3 dispute the timed-out peer 0 -> 3 commitments
    await h.assert.dispute.committedWait({
        expectedCount: 3,
        mode: "atLeast"
    });
    const dispute = h.getPeer(honestDisputerIndex).eventSpies
        .onInitiatingDispute!.lastCall.args[1] as DisputeStruct;
    const commitment = hash(Codec.encode(dispute, Type.Dispute));
    // the proof must reach the guard -> the dispute is committed before it lands
    expect(
        await h.channelManager.getWindowCommitments(
            h.channelId,
            dispute.input.forkId
        )
    ).to.include(commitment);
    const slashedBefore = await h.channelManager.getOnChainSlashedParticipants(
        h.channelId
    );

    // the honest dispute has no header mismatch -> the handler returns zero
    const receipt = await h.tamper.submitForgedFraudProof(
        honestDisputerIndex,
        DisputeFraudProofType.DisputeStateProofHeaderMismatch,
        () => ({ __: false }),
        { participant: ethers.ZeroAddress, submitter: await resolveSubmitter() }
    );

    const killed = receipt.logs
        .map((log) => h.channelManager.interface.parseLog(log))
        .filter((event) => event?.name === "DisputeKilled");
    expect(killed, "zero-target proof must not kill a dispute").to.have.length(
        0
    );
    expect(
        await h.channelManager.getWindowCommitments(
            h.channelId,
            dispute.input.forkId
        ),
        "dispute stays committed"
    ).to.include(commitment);
    const slashed = await h.channelManager.getOnChainSlashedParticipants(
        h.channelId
    );
    expect(slashed, "honest disputer must not be slashed").to.not.include(
        h.getPeer(honestDisputerIndex).address
    );
    return { slashedBefore, slashed };
}
