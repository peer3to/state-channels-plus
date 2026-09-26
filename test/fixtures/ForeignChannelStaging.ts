// @spec-test-coverage-ignore: shared staging for the foreign-channel delivery declarations
import * as factory from "../factory";
import { TargetedChannelJoinFixture } from "./TargetedChannelJoinFixture";
import { DisconnectTier } from "@/DisconnectPolicy";
import type { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathTestSession } from "@test/harness";
import type { TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/**
 * A runtime that left its first channel as an observer and now serves a
 * second one with a fresh partner. Returns the old channel's ID and fork, so a
 * case can deliver something that belongs to the channel left.
 */
async function stageReusedRuntime(label: string) {
    const { h, channelId, targeted } =
        await TargetedChannelJoinFixture.unopened(label, 3);
    await targeted.openWithPeers(channelId, [0, 1]);
    const reused = h.getPeer(2);
    expect(await targeted.connect(reused, channelId)).to.equal(true);
    await reused.p2pInstance.leaveChannel();
    const oldForkId = await h.control(h.getPeer(0)).query.getForkId().request();

    const partner = await targeted.addFreshPeer();
    const nextChannelId = ethers.id(`${label}-next`);
    expect(
        await Promise.all([
            targeted.connect(reused, nextChannelId, { autoOpen: true }),
            targeted.connect(partner, nextChannelId, { autoOpen: true })
        ])
    ).to.deep.equal([true, true]);
    return { h, channelId, oldForkId, reused, partner };
}

/** Every close the runtime requested for `peer`, and whether it holds a verdict. */
export async function consequencesFor(
    h: PeerTestHarness,
    runtime: TestPeer,
    peer: TestPeer,
    recorded: { peerAddress: string; tier: string }[]
) {
    const control = h.control(runtime);
    // A close can be requested more than once (a reply then meets a closed
    // transport); what matters is that every one is a plain close.
    const tiers = recorded
        .filter((disconnect) => disconnect.peerAddress === peer.address)
        .map((disconnect) => disconnect.tier);
    return {
        tiers: [...new Set(tiers)],
        blacklisted: await control.query.isBlacklisted(peer.address).request(),
        suspended: await control.query.isSuspended(peer.address).request(),
        strikes: await control.query.getStrikes(peer.address).request()
    };
}

export const NO_VERDICT = {
    tiers: [DisconnectTier.ALLOW],
    blacklisted: false,
    suspended: false,
    strikes: 0
};

/**
 * The partner relays a block of the channel the runtime left, signed by that
 * channel's participant, over the state-transition RPC.
 */
export async function assertForeignChannelBlockClosesWithoutVerdict() {
    const { h, channelId, oldForkId, reused, partner } =
        await stageReusedRuntime("reuse-stale-block");
    // A block of the channel left, signed by one of its participants.
    const encodedBlockConfirmation = await factory.buildAndEncodeBlock(
        h.getPeer(0).signer,
        { header: { channelId, forkId: oldForkId } }
    );
    const disconnects = await h.rpcStub.recordDisconnects(reused.index);
    try {
        await h
            .control(partner)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                reused.address
            )
            .request();
        await waitFor(async () =>
            (await disconnects.disconnects()).some(
                (disconnect) => disconnect.peerAddress === partner.address
            )
        );
        expect(
            await consequencesFor(
                h,
                reused,
                partner,
                await disconnects.disconnects()
            )
        ).to.deep.equal(NO_VERDICT);
    } finally {
        await disconnects.restore();
    }
}

/**
 * One participant asks another, over the real spectate RPC, to prove a
 * channel the responder does not serve.
 */
export async function assertSpectateRequestForAnotherChannelClosesWithoutVerdict() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 0);
    const responder = h.getPeer(0);
    const asker = h.getPeer(2);
    const disconnects = await h.rpcStub.recordDisconnects(responder.index);
    try {
        const answer = await h.execOnHost(
            asker,
            async (sm, args) =>
                await sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({ channelId: args.channelId })
                    .request(args.responder, { timeoutMs: args.timeoutMs })
                    .then(
                        () => "proved",
                        () => "rejected"
                    ),
            {
                channelId: ethers.id("spectate-another-channel"),
                responder: responder.address,
                timeoutMs: 5000
            }
        );
        return {
            answer,
            ...(await consequencesFor(
                h,
                responder,
                asker,
                await disconnects.disconnects()
            ))
        };
    } finally {
        await disconnects.restore();
    }
}

/**
 * The partner asks the runtime, over the real spectate RPC, to prove the
 * channel it left.
 */
export async function assertForeignChannelSyncRequestClosesWithoutVerdict() {
    const { h, channelId, reused, partner } =
        await stageReusedRuntime("reuse-stale-sync");
    const disconnects = await h.rpcStub.recordDisconnects(reused.index);
    try {
        const answer = await h.execOnHost(
            h.getPeer(partner.index),
            async (sm, args) =>
                await sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({ channelId: args.channelId })
                    .request(args.responder, { timeoutMs: args.timeoutMs })
                    .then(
                        () => "proved",
                        () => "rejected"
                    ),
            { channelId, responder: reused.address, timeoutMs: 5000 }
        );
        expect({
            answer,
            ...(await consequencesFor(
                h,
                reused,
                partner,
                await disconnects.disconnects()
            ))
        }).to.deep.equal({ answer: "rejected", ...NO_VERDICT });
    } finally {
        await disconnects.restore();
    }
}
