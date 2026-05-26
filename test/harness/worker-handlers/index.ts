// W1 §6 bucket (iii) / D-22 - default named handler registrations. side-effect
// import this module once per isolate (orchestrator at test boot; worker via
// the bundle manifest in PeerWorker spawn args). every shipped handler is
// harvested from a real test call site - no speculative entries.

import { Codec, Type } from "@/utils";
import type { SyncPayload } from "@/types";
import type { SyncRequest } from "@/rpc/services/spectate/SpectateService";
import type SpectateServiceRpcMethods from "@/rpc/services/spectate/SpectateRpcMethods";

import { registerDisconnectFilter } from "./disconnect-filters";
import { registerRpcStubHandler } from "./rpc-stub-handlers";

// step 1 - E2E-SpectateStaleProofGuard caller: stubs spectateService.onSpectateRequest
// to respond with a stale-height proof. install-time args: { staleBlockHeight: number }.
// today-caller: test/e2e/E2E-SpectateStaleProofGuard.test.ts:32-62
registerRpcStubHandler("spectate.respondWithStaleProof", async (ctx) => {
    const self = ctx.thisCtx as SpectateServiceRpcMethods;
    const [syncRequest] = ctx.args as [SyncRequest];
    const { staleBlockHeight } = ctx.handlerArgs as {
        staleBlockHeight: number;
    };

    const senderTransport = self.senderTransport;
    const peerAddress = senderTransport.peerAddress;
    if (!peerAddress) return;

    const syncPayload = (await self.service.generateSyncPayload(
        syncRequest.channelId,
        syncRequest.forkId,
        staleBlockHeight
    )!) as SyncPayload;

    const encodedSyncPayload = Codec.encode(syncPayload, Type.SyncPayload);
    self.remoteRpc.spectateService
        .onSpectateResponse(syncRequest.channelId, encodedSyncPayload)
        .sendOne(peerAddress);
});

// step 1 - no other shipped rpc-stub handlers today. the second call site
// (E2E-IsForkDisputed) uses a test-local `called=true` toggle - that's the
// canonical case for registerTemporaryRpcStubHandler.

// step 1 - RPCActions.requestFakeDisputeWithSpiedDisconnect caller: filters
// out calls to disconnectAndBlacklistPeerByEvmAddress targeting one specific
// evm address (the requestingPeer). install-time args: { skipAddress: string }.
// returning `false` drops the call; `true` lets the original through.
// today-caller: test/harness/actions/RPCActions.ts:447-463
registerDisconnectFilter("network.dropSpecificAddress", (ctx) => {
    const { skipAddress } = ctx.filterArgs as { skipAddress: string };
    return ctx.address !== skipAddress;
});

export {};
