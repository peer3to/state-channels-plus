// @spec-test-coverage-ignore: dispute-window inbound sync staging exercised by explicit SpectateService and E2E-Spectate declarations
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncPayload } from "@/types";
import type { ForkId, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

const RESPONDER_INDEX = 0;
const REQUESTER_INDEX = 2;

function inboundMessageBlockHash(block: MessageBlockStruct): Hash {
    return hash(Codec.encode(block, Type.MessageBlock));
}

/**
 * Append a fabricated successor of the window's last applied inbound block:
 * it links to that block and repeats its messages one height above it.
 */
export function appendForgedInboundSuccessor(payload: SyncPayload): void {
    const inbound =
        payload.disputeWindows[0].inboundMessageBlocksAppliedInReduce;
    const tip = inbound.at(-1)!;
    inbound.push({
        ...tip,
        previousBlockHash: inboundMessageBlockHash(tip),
        blockHeight: BigInt(tip.blockHeight) + 1n
    });
}

/**
 * A reducible disputed fork whose reduce applies a top-up of peer 0 that
 * peer 2's inbound storage never holds. From before the top-up, peer 2 holds
 * either its whole InboundMessagesProcessed handler (`chainEvent`) or only
 * the handler's storage write (`storageWrite`, so its local diamond still
 * applies the top-up and a local reduction can run). Every peer's reduction
 * entry points are held. Peer 0 serves a payload for the source fork and
 * `mutate` alters it. With `finalizeOnChain`, peer 0 then lands only the
 * reduction on chain, so the window is chain-final while the chain snapshot
 * stays on the source fork. Peer 2 applies the payload. The holds stay until
 * `releaseHolds`.
 */
async function stageAndApplyDisputeWindowInboundSync(
    h: MathPeerTestHarness,
    options: {
        finalizeOnChain: boolean;
        requesterInboundHold: "chainEvent" | "storageWrite";
        mutate: (payload: SyncPayload) => void;
    }
) {
    let inboundHold: {
        release: (options: { replay: boolean }) => Promise<void>;
    };
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        // peer 2 lacks the top-up, so only the others are awaited
        disputingPeerIndices: [0, 3],
        beforeDispute: async () => {
            inboundHold =
                options.requesterInboundHold === "chainEvent"
                    ? await h.rpcStub.holdInboundMessageEvents(REQUESTER_INDEX)
                    : await h.rpcStub.holdInboundMessageStorage(
                          REQUESTER_INDEX
                      );
            // a top-up of an existing participant keeps the block turns intact
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(RESPONDER_INDEX).address,
                observePeerIndices: [0, 1, 3]
            });
        }
    });
    const responder = h.getPeer(RESPONDER_INDEX);
    const requester = h.getPeer(REQUESTER_INDEX);
    const requesterControl = h.control(requester);
    const reductionRaces = await Promise.all(
        h.peers.map((peer) => h.rpcStub.holdReductionRace(peer.index))
    );
    const releaseHolds = async (replay: boolean) => {
        await inboundHold.release({ replay });
        for (const race of reductionRaces)
            await race.release({
                replayEvents: replay,
                keepTasksHeld: !replay
            });
    };

    const response = await h.execOnHost(
        requester,
        async (sm, args) =>
            sm.p2pManager.remoteRpc.spectateService
                .onSpectateRequest({
                    channelId: sm.channelId,
                    forkId: args.forkId
                })
                .request(args.source),
        { source: responder.address, forkId: sourceForkId }
    );
    const payload = Codec.decode(response.encodedSyncPayload, Type.SyncPayload);
    expect(payload.disputeWindows.map((window) => window.forkId)).to.deep.equal(
        [sourceForkId]
    );
    const reducedForkId = payload.disputeWindows[0].reducedForkId as ForkId;
    const servedInboundHashes =
        payload.disputeWindows[0].inboundMessageBlocksAppliedInReduce.map(
            inboundMessageBlockHash
        );
    // premise: the reduce applies the top-up, which peer 2 does not hold
    expect(servedInboundHashes.length).to.be.greaterThan(0);
    for (const blockHash of servedInboundHashes)
        expect(
            await requesterControl.query
                .getInboundMessageBlock(blockHash)
                .request()
        ).to.equal(null);
    options.mutate(payload);
    const appliedInboundHashes =
        payload.disputeWindows[0].inboundMessageBlocksAppliedInReduce.map(
            inboundMessageBlockHash
        );

    if (options.finalizeOnChain)
        expect(
            await h.scenario.finalizeReductionOnChainOnly(
                RESPONDER_INDEX,
                sourceForkId
            )
        ).to.equal(true);
    // premise: the chain has not adopted the reduced fork
    expect(
        StateSnapshot.from(await h.channelManager.getStateSnapshot(h.channelId))
            .forkID
    ).to.equal(sourceForkId);

    const inboundHeadBefore = await requesterControl.query
        .getLatestInboundMessageHash()
        .request();
    const requesterStub = requesterControl.stub;
    await requesterStub.recordSyncRejections().request();
    let accepted: boolean;
    let rejections: string[];
    try {
        accepted = await h.execOnHost(
            requester,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService.applySyncResponse(
                    args.source,
                    { channelId: sm.channelId, forkId: args.forkId },
                    args.encodedSyncPayload
                ),
            {
                source: responder.address,
                forkId: sourceForkId,
                encodedSyncPayload: Codec.encode(
                    payload,
                    Type.SyncPayload
                ) as string
            }
        );
        rejections = await requesterStub
            .restoreRecordedSyncRejections()
            .request();
    } finally {
        await requesterStub.restoreRecordedSyncRejections().request();
    }

    const storedInboundHashes: Hash[] = [];
    for (const blockHash of new Set([
        ...servedInboundHashes,
        ...appliedInboundHashes
    ]))
        if (
            await requesterControl.query
                .getInboundMessageBlock(blockHash)
                .request()
        )
            storedInboundHashes.push(blockHash);

    return {
        accepted,
        rejections,
        sourceForkId,
        reducedForkId,
        servedInboundHashes,
        appliedInboundHashes,
        storedInboundHashes,
        inboundHeadBefore,
        inboundHeadAfter: await requesterControl.query
            .getLatestInboundMessageHash()
            .request(),
        releaseHolds
    };
}

/** `stageAndApplyDisputeWindowInboundSync` with the storage-write hold; releases the holds without replay. */
export async function applyDisputeWindowInboundSyncPayload(
    h: MathPeerTestHarness,
    options: {
        finalizeOnChain: boolean;
        mutate: (payload: SyncPayload) => void;
    }
) {
    const { releaseHolds, ...result } =
        await stageAndApplyDisputeWindowInboundSync(h, {
            ...options,
            requesterInboundHold: "storageWrite"
        });
    await releaseHolds(false);
    return result;
}

/**
 * Peer 2, a participant, syncs a chain-final but unadopted window whose
 * inbound list a byzantine responder extended with a fabricated successor.
 * The chain then adopts the reduced fork and the participants author blocks
 * on it, so peer 2 signs its own block. Neither peer 2 nor any other
 * participant may ever hold the fabricated block, and peer 2 gets the
 * genuine top-up from its chain event.
 */
export async function assertSyncedParticipantNeverSignsInjectedInbound(
    h: MathPeerTestHarness
): Promise<void> {
    const participantIndices = [0, REQUESTER_INDEX, 3];
    const {
        accepted,
        rejections,
        sourceForkId,
        reducedForkId,
        servedInboundHashes,
        appliedInboundHashes,
        releaseHolds
    } = await stageAndApplyDisputeWindowInboundSync(h, {
        finalizeOnChain: true,
        requesterInboundHold: "chainEvent",
        mutate: appendForgedInboundSuccessor
    });
    expect(rejections).to.deep.equal([]);
    expect(accepted).to.equal(true);
    const forgedHash = appliedInboundHashes.at(-1)!;
    const genuineTopUpHash = servedInboundHashes.at(-1)!;

    await releaseHolds(true);
    const { newForkId } = await h.dispute.resolveDisputeWait({
        forkId: sourceForkId,
        honestPeerIndices: participantIndices
    });
    expect(newForkId).to.equal(reducedForkId);
    const requester = h.getPeer(REQUESTER_INDEX);
    // the replayed chain event delivers the genuine block the sync dropped
    await h.eventCountsBarrier.waitFor(
        async () =>
            (await h
                .control(requester)
                .query.getInboundMessageBlock(genuineTopUpHash)
                .request()) !== null,
        {
            timeoutMs: h.event.protocolEventTimeoutMs(),
            timeoutMessage: "peer 2 did not receive the genuine top-up"
        }
    );

    // one block per participant -> peer 2 authors and signs one of them
    await h.transition.advanceState({
        count: participantIndices.length,
        waitForPeers: participantIndices,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: participantIndices });
    const responderHead = await h
        .control(h.getPeer(RESPONDER_INDEX))
        .query.getLatestInboundMessageHash()
        .request();
    for (const index of participantIndices) {
        const peer = h.getPeer(index);
        expect(
            await h
                .control(peer)
                .query.getInboundMessageBlock(forgedHash)
                .request()
        ).to.equal(null);
        expect(
            await h.control(peer).query.getLatestInboundMessageHash().request()
        ).to.equal(responderHead);
    }
    expect(responderHead).to.equal(genuineTopUpHash);
}
