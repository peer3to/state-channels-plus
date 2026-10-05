// @spec-test-coverage-ignore: dispute-window inbound sync staging exercised by explicit SpectateService and E2E-Spectate declarations
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncPayload } from "@/types";
import type { ForkId, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
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
 * peer 2's inbound storage never gets from its subscription. From before the
 * top-up, peer 2 holds its whole InboundMessagesProcessed handler
 * (`chainEvent`), holds only the handler's storage write (`storageWrite`, so
 * its local diamond still applies the top-up and a local reduction can run),
 * or loses the subscribed log (`droppedLog`, which chain-log recovery can
 * heal). Every peer's reduction entry points are held. Peer 0 serves a
 * payload for the source fork and `mutate` alters it. Peer 2 applies it
 * while `reduction` picks who reduces the window:
 * - `local`: nobody else, so peer 2's sync reduces it in its local diamond;
 * - `chainBeforeSync`: peer 0 lands only the reduction on chain first;
 * - `chainAfterFinalityRead`: peer 0 lands it after peer 2's finality read
 *   and before peer 2 fetches the window;
 * - `concurrentLocalSync`: after peer 2 persists the window, a second sync of
 *   peer 0's genuine payload reduces it in peer 2's local diamond first.
 * The chain snapshot stays on the source fork. The holds stay until
 * `releaseHolds`.
 */
async function stageAndApplyDisputeWindowInboundSync(
    h: MathPeerTestHarness,
    options: {
        reduction:
            | "local"
            | "chainBeforeSync"
            | "chainAfterFinalityRead"
            | "concurrentLocalSync";
        requesterInboundHold: "chainEvent" | "storageWrite" | "droppedLog";
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
            const dropped =
                options.requesterInboundHold === "droppedLog"
                    ? await h.rpcStub.dropInboundMessageLogs(REQUESTER_INDEX)
                    : undefined;
            inboundHold = dropped
                ? { release: async () => await dropped.release() }
                : options.requesterInboundHold === "chainEvent"
                  ? await h.rpcStub.holdInboundMessageEvents(REQUESTER_INDEX)
                  : await h.rpcStub.holdInboundMessageStorage(REQUESTER_INDEX);
            // a top-up of an existing participant keeps the block turns intact
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(RESPONDER_INDEX).address,
                observePeerIndices: [0, 1, 3]
            });
            await dropped?.waitUntilDropped();
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
    // premise: the reduce applies the top-up
    expect(servedInboundHashes.length).to.be.greaterThan(0);
    // a held handler keeps it from peer 2; a dropped log can already be
    // recovered while peer 2 audits the dispute
    if (options.requesterInboundHold !== "droppedLog")
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

    if (options.reduction === "chainBeforeSync")
        expect(
            await h.scenario.finalizeReductionOnChainOnly(
                RESPONDER_INDEX,
                sourceForkId
            )
        ).to.equal(true);

    const inboundHeadBefore = await requesterControl.query
        .getLatestInboundMessageHash()
        .request();
    const requesterStub = requesterControl.stub;
    const applyPayload = (encodedSyncPayload: string) =>
        h.execOnHost(
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
                encodedSyncPayload
            }
        );
    const encodedPayload = Codec.encode(payload, Type.SyncPayload) as string;
    await requesterStub.recordSyncRejections().request();
    let accepted: boolean;
    let rejections: string[];
    try {
        if (
            options.reduction === "local" ||
            options.reduction === "chainBeforeSync"
        )
            accepted = await applyPayload(encodedPayload);
        else {
            await requesterStub
                .holdSyncWindowPersistence(
                    options.reduction === "chainAfterFinalityRead"
                        ? "beforeFetch"
                        : "afterPersist"
                )
                .request();
            const pending = applyPayload(encodedPayload);
            try {
                await waitFor(
                    async () =>
                        (await requesterStub
                            .getSyncWindowPersistenceEntered()
                            .request()) === 1
                );
                if (options.reduction === "chainAfterFinalityRead")
                    expect(
                        await h.scenario.finalizeReductionOnChainOnly(
                            RESPONDER_INDEX,
                            sourceForkId
                        )
                    ).to.equal(true);
                else
                    expect(
                        await applyPayload(
                            response.encodedSyncPayload as string
                        )
                    ).to.equal(true);
            } finally {
                await requesterStub.releaseSyncWindowPersistence().request();
                accepted = await pending;
            }
        }
        rejections = await requesterStub
            .restoreRecordedSyncRejections()
            .request();
    } finally {
        await requesterStub.restoreRecordedSyncRejections().request();
    }
    // premise: the chain has not adopted the reduced fork
    expect(
        StateSnapshot.from(await h.channelManager.getStateSnapshot(h.channelId))
            .forkID
    ).to.equal(sourceForkId);

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
        reduction:
            | "local"
            | "chainBeforeSync"
            | "chainAfterFinalityRead"
            | "concurrentLocalSync";
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
 * on it, so peer 2 authors and signs one of them. Neither peer 2 nor any
 * other participant may ever hold the fabricated block, and peer 2's block
 * carries none of it. Peer 2 gets the genuine top-up from its replayed chain
 * event (`heldEvent`) or, when its subscribed log was lost (`droppedLog`),
 * from chain-log recovery.
 */
export async function assertSyncedParticipantNeverSignsInjectedInbound(
    h: MathPeerTestHarness,
    requesterInboundLoss: "heldEvent" | "droppedLog"
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
        reduction: "chainBeforeSync",
        requesterInboundHold:
            requesterInboundLoss === "heldEvent" ? "chainEvent" : "droppedLog",
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
    const requesterQuery = h.control(requester).query;
    // the sync dropped the window's list -> only a chain event or chain-log
    // recovery delivers the genuine block
    await h.eventCountsBarrier.waitFor(
        async () =>
            (await requesterQuery
                .getInboundMessageBlock(genuineTopUpHash)
                .request()) !== null,
        {
            timeoutMs: h.event.protocolEventTimeoutMs(),
            timeoutMessage: "peer 2 did not receive the genuine top-up"
        }
    );

    // one block per participant -> peer 2 authors and signs one of them
    const firstNewHeight = await requesterQuery
        .getNextBlockHeight(newForkId)
        .request();
    await h.transition.advanceState({
        count: participantIndices.length,
        waitForPeers: participantIndices,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices: participantIndices });
    const nextHeight = await requesterQuery
        .getNextBlockHeight(newForkId)
        .request();
    expect(nextHeight - firstNewHeight).to.be.at.least(
        participantIndices.length
    );
    const requesterBlocks: Block[] = [];
    for (let height = firstNewHeight; height < nextHeight; height++) {
        const bundle = await requesterQuery
            .getBlockByHeight(newForkId, height)
            .request();
        expect(bundle).to.not.equal(null);
        const block = Block.fromSignedBlock(
            Codec.decode(bundle!.encodedSignedBlock, Type.SignedBlock)
        );
        if (String(block.author) === requester.address)
            requesterBlocks.push(block);
    }
    expect(requesterBlocks.length).to.be.greaterThan(0);
    for (const block of requesterBlocks) {
        expect(String(block.signerAddress)).to.equal(requester.address);
        expect(block.messageBlocks.map(inboundMessageBlockHash)).to.not.include(
            forgedHash
        );
    }

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
