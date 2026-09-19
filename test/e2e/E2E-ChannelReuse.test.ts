import { Status } from "@/types";
import { assertClean } from "@test/fixtures/DiscoveryRuntimePortStaging";
import { TargetedChannelJoinFixture } from "@test/fixtures/TargetedChannelJoinFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("E2E: Channel reuse", function () {
    it("an observer that left reaches another channel on the same runtime", async function () {
        const { h, channelId, targeted } =
            await TargetedChannelJoinFixture.unopened("reuse-observer", 3);
        await targeted.openWithPeers(channelId, [0, 1]);
        const observer = h.getPeer(2);
        expect(await targeted.connect(observer, channelId)).to.equal(true);
        expect(await h.control(observer).query.getStatus().request()).to.equal(
            Status.SYNCED
        );

        await observer.p2pInstance.leaveChannel();

        const nextChannelId = ethers.id("reuse-observer-next");
        const partner = await targeted.addFreshPeer();
        expect(
            await Promise.all([
                targeted.connect(observer, nextChannelId, { autoOpen: true }),
                targeted.connect(partner, nextChannelId, { autoOpen: true })
            ])
        ).to.deep.equal([true, true]);
        // The reused runtime tracks only its new channel; the peers of the old
        // one keep theirs and never counted it as a participant.
        expect({
            reusedChannel: await h
                .control(observer)
                .query.getChannelId()
                .request(),
            disposed: await targeted.isDisposed(observer),
            oldChannelParticipant: (
                await h.channelManager.getParticipants(channelId)
            ).includes(observer.address),
            firstPeerChannel: await h
                .control(h.getPeer(0))
                .query.getChannelId()
                .request()
        }).to.deep.equal({
            reusedChannel: nextChannelId,
            disposed: false,
            oldChannelParticipant: false,
            firstPeerChannel: channelId
        });
    });

    it("one runtime completes two leave and reconnect cycles", async function () {
        const { h, channelId, targeted } =
            await TargetedChannelJoinFixture.unopened("reuse-two-cycles", 3);
        await targeted.openWithPeers(channelId, [0, 1]);
        const reused = h.getPeer(2);
        expect(await targeted.connect(reused, channelId)).to.equal(true);
        await reused.p2pInstance.leaveChannel();

        // Both cycles leave from an observer, so the subject stays the reset
        // rather than the committed-participant exit covered elsewhere.
        const secondChannelId = ethers.id("reuse-two-cycles-second");
        const first = await targeted.addFreshPeer();
        const second = await targeted.addFreshPeer();
        expect(
            await targeted.openWithPeers(secondChannelId, [
                first.index,
                second.index
            ])
        ).to.deep.equal([true, true]);
        expect(await targeted.connect(reused, secondChannelId)).to.equal(true);
        await reused.p2pInstance.leaveChannel();

        // The second reset is the subject, so the third target stays unopened:
        // selecting it proves the ID was unbound again without paying for
        // another negotiated open.
        const thirdChannelId = ethers.id("reuse-two-cycles-third");
        const connected = await targeted.connect(reused, thirdChannelId);
        expect({
            connected,
            channelId: await h.control(reused).query.getChannelId().request(),
            disposed: await targeted.isDisposed(reused)
        }).to.deep.equal({
            connected: false,
            channelId: thirdChannelId,
            disposed: false
        });
    });

    it("a sync still in flight from the channel left neither writes into the runtime nor settles its next sync", async function () {
        const { h, channelId, targeted } =
            await TargetedChannelJoinFixture.unopened("reuse-stale-sync", 3);
        await targeted.openWithPeers(channelId, [0, 1]);
        const observer = h.getPeer(2);
        const syncs = await h.rpcStub.countSettledSpectateSyncs(observer.index);
        const hold = await h.rpcStub.holdSpectateSyncApplication(
            observer.index
        );
        // The first sync parks after its response arrived, then the runtime
        // leaves underneath it: the pending connect settles with the reset.
        const firstConnect = targeted.connect(observer, channelId);
        await waitFor(async () => (await hold.entered()) === 1);
        await observer.p2pInstance.leaveChannel();
        expect(await firstConnect).to.equal(false);

        await hold.release();
        await waitFor(async () => (await syncs.settled()) === 1);
        // The stale sync persisted nothing, so the runtime is still clean...
        await assertClean(h, observer);
        // ...and it did not mark the next initial sync done, so connecting
        // again runs a real sync instead of returning before one.
        expect(await targeted.connect(observer, channelId)).to.equal(true);
        await syncs.restore();
    });

    it("a sync resuming mid-reset sees the channel already left and does not penalise its responder", async function () {
        const { h, channelId, targeted } =
            await TargetedChannelJoinFixture.unopened("reuse-mid-reset", 3);
        await targeted.openWithPeers(channelId, [0, 1]);
        const observer = h.getPeer(2);
        const syncs = await h.rpcStub.countSettledSpectateSyncs(observer.index);
        const application = await h.rpcStub.holdSpectateSyncApplication(
            observer.index
        );
        const drain = await h.rpcStub.holdEventDrain(observer.index);
        const firstConnect = targeted.connect(observer, channelId);
        await waitFor(async () => (await application.entered()) === 1);
        const [responder] = await h
            .control(observer)
            .stub.waitForSpectateSyncCalls(1)
            .request();

        // Park the reset right after it retired the channel: the responder's
        // profile and the stores still exist, so a stale sync could still
        // write into them or blame the peer that answered. Discovery is also
        // still live here, so a cut peer would reconnect: count the cuts
        // aimed at the responder rather than reading its connectivity.
        const leave = observer.p2pInstance.leaveChannel();
        await waitFor(async () => (await drain.entered()) === 1);
        await h.execOnHost(
            observer,
            (sm, args) => {
                const p2p = sm.p2pManager;
                const cut = p2p.disconnectConnection.bind(p2p);
                const ban =
                    p2p.disconnectAndBlacklistPeerByEvmAddress.bind(p2p);
                const probe = {
                    cuts: 0,
                    restore: () => {
                        p2p.disconnectConnection = cut;
                        p2p.disconnectAndBlacklistPeerByEvmAddress = ban;
                    }
                };
                Reflect.set(sm, "resetPenaltyProbe", probe);
                const isResponder = (address: unknown) =>
                    String(address).toLowerCase() ===
                    args.responder.toLowerCase();
                p2p.disconnectConnection = (transport) => {
                    if (isResponder(transport.peerAddress)) probe.cuts += 1;
                    return cut(transport);
                };
                p2p.disconnectAndBlacklistPeerByEvmAddress = (address) => {
                    if (isResponder(address)) probe.cuts += 1;
                    return ban(address);
                };
            },
            { responder }
        );
        await application.release();
        await waitFor(async () => (await syncs.settled()) === 1);
        const midReset = await h.execOnHost(
            observer,
            (sm, args) => ({
                status: sm.status,
                persisted:
                    !!sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        args.forkId
                    ),
                responderBlacklisted: sm.p2pManager.isBlacklisted(
                    args.responder
                ),
                responderCuts: Reflect.get(sm, "resetPenaltyProbe").cuts
            }),
            {
                forkId: String(
                    await h.control(h.getPeer(0)).query.getForkId().request()
                ),
                responder
            }
        );

        await h.execOnHost(observer, (sm) => {
            Reflect.get(sm, "resetPenaltyProbe").restore();
        });
        await drain.release();
        await leave;
        expect(await firstConnect).to.equal(false);
        expect(midReset).to.deep.equal({
            status: Status.OPENED,
            persisted: false,
            responderBlacklisted: false,
            responderCuts: 0
        });
        await syncs.restore();
    });

    it("explicit disposal still shuts down a runtime that was reused", async function () {
        const { h, channelId, targeted } =
            await TargetedChannelJoinFixture.unopened("reuse-then-dispose", 3);
        await targeted.openWithPeers(channelId, [0, 1]);
        const reused = h.getPeer(2);
        expect(await targeted.connect(reused, channelId)).to.equal(true);
        await reused.p2pInstance.leaveChannel();

        const nextChannelId = ethers.id("reuse-then-dispose-next");
        const partner = await targeted.addFreshPeer();
        await Promise.all([
            targeted.connect(reused, nextChannelId, { autoOpen: true }),
            targeted.connect(partner, nextChannelId, { autoOpen: true })
        ]);

        await reused.p2pInstance.dispose();

        expect(await targeted.isDisposed(reused)).to.equal(true);
    });
});
