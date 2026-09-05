// @spec-test-coverage-ignore: real dispute admission staging shared by mapped workflow tests
import { expect } from "chai";
import { hexlify } from "ethers";
import { Codec, Type, hash, sleep } from "@/utils";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";

export async function assertStateOnlyContribution(
    h: MathPeerTestHarness,
    withCalldata: boolean
): Promise<void> {
    await h.lifecycle.start(3, 4);
    const forkId = h.activeForkId!;
    const opener = h.getPeer(0);
    const contributor = h.getPeer(1);
    // Explicit uploads own these two attempts. Prepare both before the window
    // opens, so host preparation is not part of the evidence-period budget.
    for (const peer of h.peers)
        await h.control(peer).stub.stubSuppressDisputeInitiation().request();
    await h.control(opener).dispute.setForceExit(true).request();
    const opening = await h.dispute.fetchConstructedDispute(
        opener.index,
        forkId
    );
    const contribution = await h.dispute.fetchConstructedDispute(
        contributor.index,
        forkId
    );
    expect(opening.dispute.input.requireExistingDisputeWindow).to.equal(false);
    expect(contribution.dispute.input.requireExistingDisputeWindow).to.equal(
        true
    );
    expect(contribution.dispute.input.selfRemoval).to.equal(false);
    contribution.dispute.postedAuditingData = withCalldata;
    await h.tamper.resignDispute(
        contributor.signer,
        contribution.dispute,
        contribution.disputeConfirmation
    );
    await (
        await opener.p2pInstance.stateChannelManagerContract.uploadDispute(
            opening.disputeConfirmation
        )
    ).wait();
    const contract = contributor.p2pInstance.stateChannelManagerContract;
    const upload = withCalldata
        ? contract.interface.encodeFunctionData("uploadDisputeWithCalldata", [
              contribution.disputeConfirmation,
              contribution.auditingData
          ])
        : contract.interface.encodeFunctionData("uploadDispute", [
              contribution.disputeConfirmation
          ]);
    const transaction = await contract.multicall([upload]);
    await transaction.wait();
    const verdict = await h
        .control(h.getPeer(2))
        .dispute.runDisputeValidation(
            hexlify(Codec.encode(contribution.dispute, Type.Dispute)),
            {
                encodedAuditingData: hexlify(
                    Codec.encode(
                        contribution.auditingData,
                        Type.DisputeAuditingData
                    )
                )
            }
        )
        .request();
    expect(verdict.outcome).to.equal("returned");
    expect(verdict.storedProof).to.equal(undefined);
    if (verdict.outcome === "returned") expect(verdict.isValid).to.equal(true);
    expect(
        await h.channelManager.getDisputeWindowCreationTimestamp(
            h.channelId,
            forkId
        )
    ).to.be.greaterThan(0n);
    await h.dispute.resolveDisputeWait({
        forkId,
        honestPeerIndices: [1, 2],
        assertMaliciousRemoved: false
    });
    expect(await h.query.onChainSlashedParticipants(1)).to.not.include(
        contributor.address
    );
    expect(
        await h.control(contributor).query.getParticipants().request()
    ).to.include(contributor.address);
}

export async function assertMissingWindowRefused(
    h: MathPeerTestHarness,
    expired: boolean
): Promise<void> {
    await h.lifecycle.start(3, 4);
    const forkId = h.activeForkId!;
    for (const peer of h.peers) {
        await h.control(peer).stub.stubSuppressDisputeInitiation().request();
        await h.control(peer).stub.stubHoldReductionTasks().request();
    }
    const contributor = h.getPeer(1);
    const contribution = await h.dispute.fetchConstructedDispute(1, forkId);
    expect(contribution.dispute.input.requireExistingDisputeWindow).to.equal(
        true
    );
    if (expired) {
        await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
        const opening = await h.dispute.fetchConstructedDispute(0, forkId);
        await (
            await h
                .getPeer(0)
                .p2pInstance.stateChannelManagerContract.uploadDispute(
                    opening.disputeConfirmation
                )
        ).wait();
        await sleep(h.event.evidencePeriodWaitMs(1));
    }
    const contract = contributor.p2pInstance.stateChannelManagerContract;
    await expect(contract.uploadDispute(contribution.disputeConfirmation))
        .to.be.revertedWithCustomError(
            contract,
            "RaceConditionDisputeWindowNotOpen"
        )
        .withArgs(h.channelId, forkId);
    await expect(
        contract.multicall([
            contract.interface.encodeFunctionData("uploadDispute", [
                contribution.disputeConfirmation
            ])
        ])
    )
        .to.be.revertedWithCustomError(
            contract,
            "RaceConditionDisputeWindowNotOpen"
        )
        .withArgs(h.channelId, forkId);
    const commitments = await h
        .control(contributor)
        .query.getDisputeWindowCommitments(forkId)
        .request();
    expect(commitments).to.not.include(
        hash(Codec.encode(contribution.dispute, Type.Dispute))
    );
    expect(await h.query.onChainSlashedParticipants(1)).to.not.include(
        contributor.address
    );
}
