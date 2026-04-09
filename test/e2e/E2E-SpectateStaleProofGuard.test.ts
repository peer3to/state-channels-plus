import { TestSession, PeerTestHarness } from "@test/harness";
import { expect } from "chai";
import { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import { Codec, Type } from "@/utils";
import SpectateServiceRpcMethods from "@/rpc/services/spectate/SpectateRpcMethods";
import { SyncPayload } from "@/types";

PeerTestHarness.setDefaultLogLevel("error");

describe("E2E: Spectate stale-proof guard", function () {
    it("aborts sync when on-chain snapshot is more advanced than what participant proved", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        await h.transition.advanceState({
            count: 4,
            waitForFinalization: true
        });
        await h.transition.postSnapshot();

        const staleBlockHeight = 1;

        // Stub both participants to respond with a stale proof regardless of what
        // was actually requested by the spectator.
        for (const peerIndex of [0, 1]) {
            h.rpcStub.stubServiceCreateRpcMethod({
                peerIndex,
                serviceName: "spectateService",
                methodName: "onSpectateRequest",
                stubbedMethod: async function (
                    this: SpectateServiceRpcMethods,
                    syncRequest: SyncRequest
                ) {
                    const senderTransport = this.senderTransport;
                    const peerAddress = senderTransport.peerAddress;
                    if (!peerAddress) return;

                    const syncPayload = (await this.service.generateSyncPayload(
                        syncRequest.channelId,
                        syncRequest.forkId,
                        //  STALE BLOCK HEIGHT
                        staleBlockHeight
                    )!) as SyncPayload;

                    const encodedSyncPayload = Codec.encode(
                        syncPayload,
                        Type.SyncPayload
                    );
                    this.remoteRpc.spectateService
                        .onSpectateResponse(
                            syncRequest.channelId,
                            encodedSyncPayload
                        )
                        .sendOne(peerAddress);
                }
            });
        }

        // addPeerWait throws if the spectator doesn't reach SYNCED within the timeout.
        // With stale proofs, the guard aborts every sync attempt, so SYNCED is never reached.
        let threwTimeout = false;
        try {
            await h.join.addPeerWait({ statusTimeoutMs: 5000 });
        } catch (e: any) {
            threwTimeout = true;
        }

        expect(threwTimeout).to.equal(
            true,
            "Spectator should not have reached SYNCED with stale proofs"
        );

        const spectator = h.getPeer(2);
        expect(
            spectator.stateManager.p2pManager.openConnections.length
        ).to.equal(0, "Spectator should have 0 open connections after abort");
    });
});
