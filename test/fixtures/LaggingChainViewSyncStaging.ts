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
 * does not. `responderHeadLags`: the responder's provider is pinned at the
 * same block while another node keeps streaming its logs, so its local
 * diamond holds the moved anchor while its head is behind it. `via`: "apply"
 * applies the responder's payload for its latest height, "sync" runs the
 * requester's real `sync` RPC to the responder. `release`: "duringWait" lets
 * the requester's provider catch up once its sync is waiting on the chain
 * block and mines a real block, "never" keeps it pinned, "dispose" keeps it
 * pinned and stops the requester's sync service during the wait.
 * `elapsedMs`: from the apply call to its result; `waitEndedMs`: from the
 * stop to the result.
 */
export async function applySyncFromChainAheadResponder(
    h: MathPeerTestHarness,
    options: {
        release: "duringWait" | "never" | "dispose";
        via?: "apply" | "sync";
        responderHeadLags?: boolean;
    }
) {
    const { forkId, anchor, remaining, heldPost } =
        await stageOutboundAroundAnchor(h, { finalBlocks: 2 });
    const responder = h.getPeer(remaining[0]);
    const requester = h.getPeer(remaining[1]);
    const lag = await h.rpcStub.lagChainView(requester.index);
    const responderLag = options.responderHeadLags
        ? await h.rpcStub.lagChainView(responder.index, { holdLogs: false })
        : undefined;
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
            const appliedAt = Date.now();
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
                // the sync is in its wait once it entered it and read the
                // pinned head there
                await waitFor(
                    async () =>
                        (await lag.chainHeadWaitsEntered()) > 0 &&
                        (await lag.headReads()) > 0,
                    h.event.protocolEventTimeoutMs()
                );
                if (options.release === "duringWait") {
                    expect(await lag.release()).to.equal(true);
                    await h.rpcStub.mineTransferBlock();
                } else {
                    stoppedAt = Date.now();
                    await h.execOnHost(requester, async (sm) => {
                        sm.p2pManager.localRpc.spectateService.dispose();
                    });
                }
            }
            const accepted = await applying;
            const resolvedAt = Date.now();
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
                anchorHash: anchor.hash,
                chainSnapshotHash: moved.hash,
                elapsedMs: resolvedAt - appliedAt,
                waitEndedMs:
                    stoppedAt === undefined
                        ? undefined
                        : resolvedAt - stoppedAt,
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
        await responderLag?.release();
    }
}
