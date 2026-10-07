// @spec-test-coverage-ignore: dispute-window sync staging exercised by explicit SpectateService, EvmDiamondStateMachineReduction and E2E-Spectate declarations
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncPayload } from "@/types";
import type { ForkId, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";
import { ethers, ZeroHash } from "ethers";

const RESPONDER_INDEX = 0;
const REQUESTER_INDEX = 2;
// The dispute-window inbound sync staging keeps the top-up out of peer 2's
// inbound storage while the dispute runs. A missing inbound run is fatal for
// dispute and audit work, so peer 2's own dispute and each of its audits fail.
const OWN_DISPUTE_MISSING_INBOUND_RUN_MESSAGE =
    "dispute - the inbound run up to the chain's head is unavailable";
const AUDIT_MISSING_INBOUND_RUN_MESSAGE =
    "Dispute audit: the inbound run is unavailable after event recovery";

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
 * Re-encode every dispute of the window with `input` overriding its input,
 * and claim a fabricated reduced fork whose genesis hashes its own data. The
 * proof then starts at that genesis with no milestone and no outbound block.
 */
function redirectDisputesAndFabricateReducedFork(
    payload: SyncPayload,
    input: { forkId: ForkId } | { channelId: string }
): void {
    const window = payload.disputeWindows[0];
    for (const { signedDispute } of window.disputeConfirmations) {
        const dispute = Codec.decode(
            signedDispute.encodedDispute,
            Type.Dispute
        );
        signedDispute.encodedDispute = Codec.encode(
            { ...dispute, input: { ...dispute.input, ...input } },
            Type.Dispute
        );
    }
    const genesis = payload.latestForkGenesisSnapshot;
    const snapshotData = {
        ...genesis.snapshotData,
        originForkId: ethers.id("fabricated origin fork")
    };
    const fabricatedForkId = StateSnapshot.from({
        ...genesis,
        snapshotData
    }).snapshotDataHash;
    payload.latestForkGenesisSnapshot = {
        ...genesis,
        snapshotData,
        forkId: fabricatedForkId
    };
    window.reducedForkId = fabricatedForkId;
    payload.milestoneSnapshots = [];
    payload.stateProof.milestones = [];
    payload.latestFinalizedEncodedState = payload.latestForkGenesisEncodedState;
    payload.outboundMessageBlocksOfTheLatestFork = [];
}

/**
 * Point every dispute of the window at a fork with no dispute window, and
 * claim a fabricated reduced fork whose genesis hashes its own data. The
 * proof then starts at that genesis with no milestone and no outbound block.
 */
export function redirectDisputesToForkWithoutWindow(
    payload: SyncPayload
): void {
    redirectDisputesAndFabricateReducedFork(payload, {
        forkId: ethers.id("fork without a dispute window")
    });
}

/**
 * Keep every dispute of the window on the window's fork but point it at a
 * channel with no dispute window, and claim the same fabricated reduced fork
 * as `redirectDisputesToForkWithoutWindow`.
 */
export function redirectDisputesToChannelWithoutWindow(
    payload: SyncPayload
): void {
    redirectDisputesAndFabricateReducedFork(payload, {
        channelId: ethers.id("channel without a dispute window")
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
 * A missing inbound run is fatal for dispute and audit work, so with the
 * whole handler held (`chainEvent`) peer 2 is also kept out of that work while
 * it lacks the top-up: its own dispute is suppressed and its subscribed
 * dispute logs are dropped. A replaying `releaseHolds` gives it back that work
 * only once the replayed top-up is stored. With the other holds peer 2's
 * dispute and audits fail, and the caller settles those errors.
 * The chain snapshot stays on the source fork. The holds stay until
 * `releaseHolds`. Besides the inbound storage it reports whether peer 2
 * blacklisted peer 0, peer 2's fork and its local window's reduced fork.
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
    let restoreRequesterDisputeWork: (() => Promise<void>) | undefined;
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        // peer 2 lacks the top-up, so only the others are awaited
        disputingPeerIndices: [0, 3],
        beforeDispute: async () => {
            if (options.requesterInboundHold === "chainEvent") {
                const requesterStub = h.control(
                    h.getPeer(REQUESTER_INDEX)
                ).stub;
                await requesterStub.stubSuppressDisputeInitiation().request();
                const restoreDisputeLogs =
                    await h.rpcStub.holdDisputeCommittedEvents(
                        REQUESTER_INDEX,
                        { passFirst: false }
                    );
                restoreRequesterDisputeWork = async () => {
                    await restoreDisputeLogs(false);
                    await requesterStub.restoreDisputeInitiation().request();
                };
            }
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
        if (restoreRequesterDisputeWork) {
            // the replay is fire-and-forget: peer 2 takes dispute and audit
            // work back only once it stores the top-up the reduce applies
            if (replay)
                await waitFor(
                    async () =>
                        (await requesterControl.query
                            .getInboundMessageBlock(servedInboundHashes.at(-1)!)
                            .request()) !== null,
                    h.event.protocolEventTimeoutMs()
                );
            await restoreRequesterDisputeWork();
        }
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
        responderBlacklisted: await requesterControl.query
            .isBlacklisted(responder.address)
            .request(),
        requesterForkId: await requesterControl.query.getForkId().request(),
        localReducedForkId: await requesterControl.query
            .getLocalDisputeWindowReducedForkId(sourceForkId)
            .request(),
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

async function settleRequesterMissingInboundRunErrors(): Promise<void> {
    // the first settle leaves the audit errors for the second, which then
    // fails on anything else still left
    await MathTestSession.settleDetached({
        expectedErrorIncludes: OWN_DISPUTE_MISSING_INBOUND_RUN_MESSAGE,
        throwOnError: false
    });
    await MathTestSession.settleDetached({
        expectedErrorIncludes: AUDIT_MISSING_INBOUND_RUN_MESSAGE
    });
}

/**
 * `stageAndApplyDisputeWindowInboundSync` with the storage-write hold;
 * releases the holds without replay, then settles the missing-inbound-run
 * errors that the hold causes in peer 2's dispute and audits.
 */
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
    await settleRequesterMissingInboundRunErrors();
    return result;
}

/**
 * Peer 2, a participant, syncs a chain-final but unadopted window whose
 * inbound list a byzantine responder extended with a fabricated successor.
 * The chain then adopts the reduced fork and the participants author blocks
 * on it, so peer 2 authors and signs one of them. Neither peer 2 nor any
 * other participant may ever hold the fabricated block, and peer 2's block
 * carries none of it. Peer 2 ends with the genuine top-up: from its replayed
 * chain event (`heldEvent`) or, when its subscribed log was lost
 * (`droppedLog`), from chain-log recovery, which may already run while peer 2
 * audits the dispute, so this mode checks only the end state.
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
    const keptOutOfAudits = requesterInboundLoss === "heldEvent";
    // a held handler kept peer 2 out of audit work: it never handled the
    // window's dispute logs, its window came from the sync
    if (keptOutOfAudits)
        expect(
            h.event.getEventCallCount(REQUESTER_INDEX, "onDisputeCommitted")
        ).to.equal(0);
    const { newForkId } = await h.dispute.resolveDisputeWait({
        forkId: sourceForkId,
        honestPeerIndices: participantIndices,
        // peers 0 and 3 committed during staging; peer 2 handled none
        expectedDisputesCommittedPerPeer: keptOutOfAudits ? 0 : 1
    });
    expect(newForkId).to.equal(reducedForkId);
    const requester = h.getPeer(REQUESTER_INDEX);
    const requesterQuery = h.control(requester).query;
    // the sync dropped the window's list -> a chain event or chain-log
    // recovery (before or after the sync) delivers the genuine block
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
        if (block.author === requester.address) requesterBlocks.push(block);
    }
    expect(requesterBlocks.length).to.be.greaterThan(0);
    for (const block of requesterBlocks) {
        expect(block.signerAddress).to.equal(requester.address);
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

/**
 * A reducible disputed fork, whose reduce applies a top-up of peer 0, with
 * every peer's reduction tasks held. Peer 2
 * fetches peer 0's payload for it and persists the chain's unreduced window
 * into its local diamond. `reduce` runs peer 2's real `reduceAndFinalizeLocally`
 * on the (altered) payload's window, expecting its `reducedForkId`.
 */
export async function stageLocalWindowReduction(h: MathPeerTestHarness) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        // a top-up of an existing participant -> the reduce applies an inbound block
        beforeDispute: async () => {
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(RESPONDER_INDEX).address
            });
        }
    });
    const responder = h.getPeer(RESPONDER_INDEX);
    const requester = h.getPeer(REQUESTER_INDEX);
    const requesterControl = h.control(requester);
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
    await h.execOnHost(
        requester,
        async (sm, args) => {
            await sm.p2pManager.localRpc.spectateService.fetchAndPersistOnChainDisputeWindows(
                sm.channelId,
                [args.forkId]
            );
        },
        { forkId: sourceForkId }
    );
    const localReducedForkId = () =>
        requesterControl.query
            .getLocalDisputeWindowReducedForkId(sourceForkId)
            .request();
    // premise: nobody reduced the window yet, and its reduce applies the top-up
    expect(await localReducedForkId()).to.equal(ZeroHash);
    expect(
        payload.disputeWindows[0].inboundMessageBlocksAppliedInReduce.length
    ).to.be.greaterThan(0);
    return {
        payload,
        reducedForkId: payload.disputeWindows[0].reducedForkId as ForkId,
        localReducedForkId,
        reduce: (alteredPayload: SyncPayload) =>
            requesterControl.spectate
                .reduceSyncWindowLocally(
                    Codec.encode(alteredPayload, Type.SyncPayload) as string,
                    0
                )
                .request()
    };
}
