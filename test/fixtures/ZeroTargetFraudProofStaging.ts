// @spec-test-coverage-ignore: zero-target dispute fraud proof staging shared by mapped e2e tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
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

    // the honest dispute has no header mismatch -> the handler returns zero
    const proof = {
        proofType: toSolidityDisputeFraudProofType(
            DisputeFraudProofType.DisputeStateProofHeaderMismatch
        ),
        participant: ethers.ZeroAddress,
        dispute,
        encodedProof: "0x"
    };
    const submitter = await resolveSubmitter();
    const receipt = await (
        await h.channelManager
            .connect(submitter)
            .applyDisputeFraudProofs([proof])
    ).wait();

    const killed = receipt!.logs
        .map((log) => h.channelManager.interface.parseLog(log))
        .filter((event) => event?.name === "DisputeKilled");
    expect(killed, "zero-target proof must not kill a dispute").to.have.length(
        0
    );
    const slashed = await h.channelManager.getOnChainSlashedParticipants(
        h.channelId
    );
    const disputerAddress = h.getPeer(honestDisputerIndex).address;
    expect(
        slashed.some((a) => a.toLowerCase() === disputerAddress.toLowerCase()),
        "honest disputer must not be slashed"
    ).to.equal(false);
    return slashed;
}
