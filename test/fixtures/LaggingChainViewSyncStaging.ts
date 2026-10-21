// @spec-test-coverage-ignore: lagging chain-view sync staging exercised by explicit SpectateService declarations
import { Codec, Type } from "@/utils";
import { stageOutboundAroundAnchor } from "@test/fixtures/HistoricSyncStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { chainSnapshot } from "@test/fixtures/MilestoneSyncStaging";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * `stageOutboundAroundAnchor` with two final blocks. The second remaining
 * peer's provider is pinned at the current block, then the held exit post of
 * the second leaver lands: the chain anchor moves to the second exit, which
 * the first remaining peer (the responder) observes and the pinned requester
 * does not. `via`: "apply" applies the responder's payload for its latest
 * height, "sync" runs the requester's real `sync` RPC to the responder.
 * `release`: "duringWait" lets the requester's provider catch up once its
 * sync is waiting on the responder's chain block, "never" keeps it pinned,
 * "dispose" keeps it pinned and stops the requester's sync service during the
 * wait. `waitEndedMs`: from the stop to the sync's result.
 */
export async function applySyncFromChainAheadResponder(
    h: MathPeerTestHarness,
    options: {
        release: "duringWait" | "never" | "dispose";
        via?: "apply" | "sync";
    }
) {
    const { forkId, anchor, remaining, heldPost } =
        await stageOutboundAroundAnchor(h, { finalBlocks: 2 });
    const responder = h.getPeer(remaining[0]);
    const requester = h.getPeer(remaining[1]);
    const lag = await h.rpcStub.lagChainView(requester.index);
    try {
        expect(await heldPost.release()).to.equal(null);
        const moved = await chainSnapshot(h);
        expect(moved.latestOutboundMessageBlockHeight).to.equal(2);
        await waitFor(
            async () =>
                (await h.query.getLocalStateSnapshot(responder)).hash ===
                moved.hash,
            h.event.protocolEventTimeoutMs()
        );
        const latestHeight = await h
            .control(responder)
            .query.getLatestBlockHeight(forkId)
            .request();
        const served = await h
            .control(responder)
            .spectate.generateSyncPayload(h.channelId, forkId, latestHeight!)
            .request({ timeoutMs: h.event.protocolEventTimeoutMs() });
        expect(served).to.not.equal(null);
        const payload = Codec.decode(
            served!.encodedSyncPayload,
            Type.SyncPayload
        );
        // premise: the requester's chain view still holds the first exit
        expect(Number(payload.chainBlock)).to.be.greaterThan(lag.pinnedBlock);
        expect((await h.query.getLocalStateSnapshot(requester)).hash).to.equal(
            anchor.hash
        );

        const stub = h.control(requester).stub;
        await stub.recordSyncRejections().request();
        try {
            const headReadsBefore = await lag.headReads();
            const applying =
                options.via === "sync"
                    ? h
                          .control(requester)
                          .spectate.sync(
                              responder.address,
                              forkId,
                              latestHeight!
                          )
                          .request({
                              timeoutMs: h.event.protocolEventTimeoutMs()
                          })
                    : h
                          .control(requester)
                          .spectate.applySyncResponse(
                              responder.address,
                              forkId,
                              latestHeight!,
                              served!.encodedSyncPayload
                          )
                          .request({
                              timeoutMs: h.event.protocolEventTimeoutMs()
                          });
            let stoppedAt: number | undefined;
            if (options.release !== "never") {
                // the sync is waiting once its pinned head was read
                await waitFor(
                    async () => (await lag.headReads()) > headReadsBefore,
                    h.event.protocolEventTimeoutMs()
                );
                if (options.release === "duringWait")
                    expect(await lag.release()).to.equal(true);
                else {
                    stoppedAt = Date.now();
                    await h.execOnHost(requester, async (sm) => {
                        sm.p2pManager.localRpc.spectateService.dispose();
                    });
                }
            }
            const accepted = await applying;
            const waitEndedMs =
                stoppedAt === undefined ? undefined : Date.now() - stoppedAt;
            return {
                accepted,
                rejections: await stub
                    .restoreRecordedSyncRejections()
                    .request(),
                responderBlacklisted: await h
                    .control(requester)
                    .query.isBlacklisted(responder.address)
                    .request(),
                connected: await h
                    .control(requester)
                    .query.isConnectedTo(responder.address)
                    .request(),
                requesterSnapshotHash: (
                    await h.query.getLocalStateSnapshot(requester)
                ).hash,
                chainSnapshotHash: moved.hash,
                waitEndedMs,
                agreementTimeMs: await h.execOnHost(
                    requester,
                    async (sm) => sm.timeConfig.agreementTime * 1000
                )
            };
        } finally {
            await stub.restoreRecordedSyncRejections().request();
        }
    } finally {
        await lag.release();
    }
}
