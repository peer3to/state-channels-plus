// @spec-test-coverage-ignore: staging for the timeout fold order cases (e2e commit order, unit evidence comparison)
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { ForkId } from "@/types";
import { Codec, Type } from "@/utils";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ZeroAddress } from "ethers";

// peer 0 times the stalled writer out; peer 1 leaves; peer 3 only audits
const TIMEOUT_DISPUTER_INDEX = 0;
const LEAVER_INDEX = 1;
const STALLED_WRITER_INDEX = 2;
const REMAINING_PEER_INDICES = [0, 3];

/**
 * Four peers after blocks 0..1; peer 2 is the next writer and stays silent.
 * Only peer 0 times it out. Peer 1 leaves with a self-removal dispute that
 * carries no timeout claim. `order` decides which of the two disputes is
 * committed first. Returns the disputed fork once both are committed.
 */
export async function stageTimeoutAndSelfRemoval(
    h: MathPeerTestHarness,
    order: "timeoutFirst" | "selfRemovalFirst"
): Promise<ForkId> {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        transitionCount: 2,
        // two uploads and their audits must fit one evidence period
        timeConfig: { evidenceTime: 16 }
    });
    const forkId = h.activeForkId!;
    h.contextApi.markAfkPeer({ afkPeerIndex: STALLED_WRITER_INDEX });
    await h.rpcStub.suppressTimeoutCheck(LEAVER_INDEX);
    await h.rpcStub.suppressTimeoutCheck(3);
    const disputer = h.control(h.getPeer(TIMEOUT_DISPUTER_INDEX));

    if (order === "timeoutFirst") {
        await h.assert.dispute.initiatedWait({
            peersIndices: [TIMEOUT_DISPUTER_INDEX]
        });
        await h.assert.dispute.committedWait({
            peersIndices: REMAINING_PEER_INDICES,
            expectedCount: 1
        });
        await postSelfRemoval(h, forkId);
    } else {
        // the timeout is stored only after its build is released
        await disputer.stub.holdTimeoutBuild().request();
        try {
            // the build starts once the writer's deadline has passed, so the
            // self-removal window opens after the timeout's minTimeStamp
            await disputer.stub.awaitTimeoutBuildEntered().request({
                timeoutMs: h.event.protocolEventTimeoutMs({
                    withFirstBlockGrace: true
                })
            });
            await postSelfRemoval(h, forkId);
            await h.assert.dispute.committedWait({
                peersIndices: REMAINING_PEER_INDICES,
                expectedCount: 1
            });
            await disputer.stub.releaseTimeoutBuild().request();
            await h.assert.dispute.initiatedWait({
                peersIndices: [TIMEOUT_DISPUTER_INDEX]
            });
        } finally {
            await disputer.stub.restoreTimeoutBuildRecording().request();
        }
    }
    await h.assert.dispute.committedWait({
        peersIndices: REMAINING_PEER_INDICES,
        expectedCount: 2
    });
    return forkId;
}

/** The fork reduces to a successor that holds only peers 0 and 3. */
export async function expectSuccessorRemovesStalledWriterAndLeaver(
    h: MathPeerTestHarness,
    forkId: ForkId
): Promise<void> {
    await h.dispute.resolveDisputeWait({
        forkId,
        honestPeerIndices: REMAINING_PEER_INDICES,
        expectedDisputesCommittedPerPeer: 2,
        assertMaliciousRemoved: false
    });
    const expected = REMAINING_PEER_INDICES.map(
        (index) => h.getPeer(index).address
    );
    for (const index of REMAINING_PEER_INDICES) {
        const participants = await h
            .control(h.getPeer(index))
            .query.getParticipants()
            .request();
        expect(
            participants.map(String),
            `peer ${index}'s successor participants`
        ).to.have.members(expected);
    }
}

/** Peer 1 leaves: its self-removal dispute, posted as built (no timeout claim). */
async function postSelfRemoval(
    h: MathPeerTestHarness,
    forkId: ForkId
): Promise<void> {
    const leaver = h.getPeer(LEAVER_INDEX);
    await h.control(leaver).dispute.setForceExit(true).request();
    h.context.leftChannelPeerIndices = [
        ...h.context.leftChannelPeerIndices,
        LEAVER_INDEX
    ];
    const { dispute } = await h.dispute.fetchConstructedDispute(
        LEAVER_INDEX,
        forkId
    );
    // premise: the self-removal carries no timeout claim
    expect(dispute.input.selfRemoval).to.equal(true);
    expect(dispute.input.timeout.participant).to.equal(ZeroAddress);
    await h.tamper.postTamperedDispute(LEAVER_INDEX, () => {}, {
        forkId,
        markMalicious: false
    });
}

/**
 * Three peers after blocks 0..1; peer 2 is the next writer and stays silent.
 * Peer 0 stores its timeout claim against peer 2 but starts no dispute; peer 1
 * never times peer 2 out. Returns the fork once the claim is stored.
 */
export async function stageStoredTimeoutClaim(
    h: MathPeerTestHarness
): Promise<ForkId> {
    await h.lifecycle.timeoutSetup(3, 2);
    const forkId = h.activeForkId!;
    await h.rpcStub.suppressTimeoutCheck(1);
    await h.dispute.suppressDisputeInitiation([0]);
    const control = h.control(h.getPeer(0));
    // the store is counted only while the build is held
    await control.stub.holdTimeoutBuild().request();
    try {
        await control.stub.awaitTimeoutBuildEntered().request({
            timeoutMs: h.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            })
        });
        await control.stub.releaseTimeoutBuild().request();
        await control.stub.awaitTimeoutStored().request({
            timeoutMs: h.event.protocolEventTimeoutMs()
        });
    } finally {
        await control.stub.restoreTimeoutBuildRecording().request();
    }
    return forkId;
}

/** Whether `peerIndex`'s own dispute adds evidence to `theirDispute` (its builder's comparison). */
export async function compareEvidence(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    theirDispute: DisputeStruct
): Promise<boolean> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        // the host body has no module scope: decode with the injected Codec
        async (sm, args, { Codec, Type }) =>
            sm.disputeManager["disputeBuilder"]["hasMoreEvidence"](
                args.forkId,
                Codec.decode(args.encodedTheirDispute, Type.Dispute)
            ),
        {
            forkId,
            encodedTheirDispute: Codec.encode(theirDispute, Type.Dispute)
        }
    );
}
