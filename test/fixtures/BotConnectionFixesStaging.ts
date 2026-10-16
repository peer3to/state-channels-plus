// @spec-test-coverage-ignore: shared staging for the bot-connection fix unit cases (lobby discovery, leave settlement, join bounds, latest spectate)
import Clock from "@/Clock";
import type StateSnapshot from "@/models/StateSnapshot";
import { BlockOrigin } from "@/storage/QueueStorage";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { HarnessOptions } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

type HarnessPeer = ReturnType<MathPeerTestHarness["getPeer"]>;

/** One `joinDiscoveryKey` call and the runtime status when it was made. */
export type RecordedDiscoveryKeyJoin = { key: string; status: number };

/**
 * Record-only probe on the peer's `P2PManager.joinDiscoveryKey`: every join
 * still runs. Returns the recorded calls and the restore.
 */
export async function recordDiscoveryKeyJoins(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<{
    joins: () => Promise<RecordedDiscoveryKeyJoin[]>;
    restore: () => Promise<void>;
}> {
    await h.execOnHost(peer, (sm) => {
        const manager = sm.p2pManager;
        const original = manager.joinDiscoveryKey;
        const join = original.bind(manager);
        const joins: { key: string; status: number }[] = [];
        Reflect.set(manager, "recordedDiscoveryKeyJoins", joins);
        Reflect.set(manager, "recordedDiscoveryKeyJoinOriginal", original);
        manager.joinDiscoveryKey = async (key: string) => {
            joins.push({ key, status: manager.stateManager.status });
            return join(key);
        };
        return true;
    });
    return {
        joins: () =>
            h.execOnHost(peer, (sm) =>
                (
                    Reflect.get(sm.p2pManager, "recordedDiscoveryKeyJoins") as {
                        key: string;
                        status: number;
                    }[]
                ).map((join) => ({ ...join }))
            ),
        restore: async () => {
            await h.execOnHost(peer, (sm) => {
                const original = Reflect.get(
                    sm.p2pManager,
                    "recordedDiscoveryKeyJoinOriginal"
                );
                if (original)
                    Reflect.set(sm.p2pManager, "joinDiscoveryKey", original);
                return true;
            });
        }
    };
}

/**
 * One `postStateSnapshotWait` of the peer: "posted" once it resolved with the
 * posted snapshot, "no-op" once it resolved with nothing to post, the custom
 * error name of the chain's revert, or "failed" for any other error.
 */
export type RecordedSnapshotPost = string;

/**
 * Record-only probe on the peer's `SnapshotUpdateService.postStateSnapshotWait`
 * (a reduction's adopt-only posts are not recorded): every call still runs
 * and returns its own snapshot or rejects with its own error. Returns the
 * number of started posts, the results in call order, a wait for the first
 * `count` results, and the restore. While `holdResults` is on, each recorded
 * post parks before it returns, until `releaseResults`. While `holdStarts` is
 * on, each recorded post is counted as started and parks before it prepares
 * anything, until `releaseStarts`.
 */
export async function recordSnapshotPostWaitResults(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<{
    started: () => Promise<number>;
    results: () => Promise<RecordedSnapshotPost[]>;
    resultsWait: (count: number) => Promise<RecordedSnapshotPost[]>;
    holdResults: () => Promise<void>;
    releaseResults: () => Promise<void>;
    holdStarts: () => Promise<void>;
    releaseStarts: () => Promise<void>;
    restore: () => Promise<void>;
}> {
    await h.execOnHost(peer, (sm, _, { tryDecodeCustomError }) => {
        const service = sm.snapshotUpdateService;
        const original = service.postStateSnapshotWait;
        const post = original.bind(service);
        const record = { started: 0, results: [] as string[] };
        // one gate per park point: before the post prepares, after it returns
        const createGate = () => {
            let release = () => undefined as void;
            const gate: { current?: Promise<void> } = {};
            return {
                gate,
                start: () => {
                    gate.current ??= new Promise<void>((resolve) => {
                        release = resolve;
                    });
                },
                release: () => {
                    gate.current = undefined;
                    release();
                }
            };
        };
        const results = createGate();
        const starts = createGate();
        const hold = {
            start: results.start,
            release: results.release,
            startStarts: starts.start,
            releaseStarts: starts.release
        };
        Reflect.set(service, "recordedPostWaits", record);
        Reflect.set(service, "recordedPostWaitHold", hold);
        Reflect.set(service, "recordedPostWaitOriginal", original);
        service.postStateSnapshotWait = async (forkId, options) => {
            if (options?.forkAdoptionOnly) return post(forkId, options);
            record.started += 1;
            if (starts.gate.current) await starts.gate.current;
            let posted: StateSnapshot | undefined;
            try {
                posted = await post(forkId, options);
            } catch (error) {
                record.results.push(
                    tryDecodeCustomError(error)?.name ?? "failed"
                );
                if (results.gate.current) await results.gate.current;
                throw error;
            }
            record.results.push(posted === undefined ? "no-op" : "posted");
            if (results.gate.current) await results.gate.current;
            return posted;
        };
        return true;
    });
    const read = () =>
        h.execOnHost(peer, (sm) => {
            const record = Reflect.get(
                sm.snapshotUpdateService,
                "recordedPostWaits"
            ) as { started: number; results: RecordedSnapshotPost[] };
            return { started: record.started, results: [...record.results] };
        });
    const controlHold = (
        action: "start" | "release" | "startStarts" | "releaseStarts"
    ) =>
        h.execOnHost(
            peer,
            (sm, args) => {
                const hold = Reflect.get(
                    sm.snapshotUpdateService,
                    "recordedPostWaitHold"
                ) as Record<
                    "start" | "release" | "startStarts" | "releaseStarts",
                    () => void
                >;
                hold[args.action]();
                return true;
            },
            { action }
        );
    return {
        started: async () => (await read()).started,
        results: async () => (await read()).results,
        resultsWait: async (count) => {
            await waitFor(
                async () => (await read()).results.length >= count,
                h.event.protocolEventTimeoutMs()
            );
            return (await read()).results;
        },
        holdResults: () => controlHold("start").then(() => undefined),
        releaseResults: () => controlHold("release").then(() => undefined),
        holdStarts: () => controlHold("startStarts").then(() => undefined),
        releaseStarts: () => controlHold("releaseStarts").then(() => undefined),
        restore: async () => {
            await controlHold("releaseStarts");
            await controlHold("release");
            await h.execOnHost(peer, (sm) => {
                const original = Reflect.get(
                    sm.snapshotUpdateService,
                    "recordedPostWaitOriginal"
                );
                if (original)
                    Reflect.set(
                        sm.snapshotUpdateService,
                        "postStateSnapshotWait",
                        original
                    );
                return true;
            });
        }
    };
}

/** One `info` entry of the peer's leave-channel logger: its message and metadata. */
export type RecordedLeaveLog = { message: string; meta: unknown[] };

/**
 * Record-only probe on the `info` entries of the peer's `LeaveChannelService`
 * logger: every entry is still logged. Returns the entries in order and the
 * restore.
 */
export async function recordLeaveChannelLogs(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<{
    entries: () => Promise<RecordedLeaveLog[]>;
    restore: () => Promise<void>;
}> {
    await h.execOnHost(peer, (sm) => {
        const logger = Reflect.get(sm.leaveChannelService, "logger") as {
            info: (message: string, ...meta: unknown[]) => void;
        };
        const info = logger.info.bind(logger);
        const entries: { message: string; meta: unknown[] }[] = [];
        Reflect.set(logger, "recordedLeaveLogs", entries);
        logger.info = (message: string, ...meta: unknown[]) => {
            entries.push({ message, meta });
            info(message, ...meta);
        };
        return true;
    });
    return {
        entries: () =>
            h.execOnHost(peer, (sm) => {
                const logger = Reflect.get(sm.leaveChannelService, "logger");
                return (
                    Reflect.get(logger, "recordedLeaveLogs") as {
                        message: string;
                        meta: unknown[];
                    }[]
                ).map((entry) => ({ ...entry }));
            }),
        restore: async () => {
            await h.execOnHost(peer, (sm) => {
                const logger = Reflect.get(sm.leaveChannelService, "logger");
                // the own property shadows the prototype's method
                Reflect.deleteProperty(logger, "info");
                Reflect.deleteProperty(logger, "recordedLeaveLogs");
                return true;
            });
        }
    };
}

/**
 * The leaver sends its exit on its leave turn, as a bot does. Returns the
 * exit transaction promise once the turn came (undefined before).
 */
export function exitOnLeaveTurn(
    peer: HarnessPeer
): () => Promise<unknown> | undefined {
    let exit: Promise<unknown> | undefined;
    peer.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
        exit = peer.p2pInstance.p2pContractInstance.leaveChannel();
    });
    return () => exit;
}

/** Counts the blocks the peer finalized since this call, from its own `onBlockFinalized` hook. */
export function countFinalizedBlocks(peer: HarnessPeer): () => number {
    let count = 0;
    peer.p2pInstance.events.on("p2pEventHooks", "onBlockFinalized", () => {
        count += 1;
    });
    return () => count;
}

/**
 * U72 staging up to the exit. A synced spectator's join lands on chain while
 * the three founders omit it, so the chain holds an inbound message no
 * snapshot has consumed (the joiner's force-join dispute is suppressed).
 * Founder 1's snapshot posts are recorded; its self-removal disputes are
 * recorded and, with `forwardDisputes`, also sent. With `holdWatchdog`, its
 * leave watchdog is held and expires only on `expireWatchdog`.
 */
type InboundJoinStagingOptions = {
    watchdogMs?: number;
    holdWatchdog?: boolean;
    forwardDisputes?: boolean;
    evidenceTime?: number;
};

async function stageOmittedInboundJoin(
    h: MathPeerTestHarness,
    options: InboundJoinStagingOptions
) {
    const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
        await h.scenario.syncSpectatorAndPrepareJoin(4, {
            configOverrides:
                options.watchdogMs === undefined
                    ? undefined
                    : { LEAVE_CHANNEL_WATCHDOG_MS: options.watchdogMs },
            timeConfig:
                options.evidenceTime === undefined
                    ? undefined
                    : { evidenceTime: options.evidenceTime }
        });
    const leaver = h.getPeer(1);
    // the omitted join is staging: the joiner's force-join dispute is recorded, not started
    await h.control(joiner).stub.stubSuppressForceJoinDispute().request();
    const restoreInclusions: (() => Promise<void>)[] = [];
    for (const peerIndex of [0, 1, 2]) {
        restoreInclusions.push(
            await h.byzantine.stubPendingInboundInclusion(peerIndex)
        );
    }
    const watchdog = options.holdWatchdog
        ? await h.rpcStub.holdScheduledTasks(
              leaver.index,
              "channel leave watchdog"
          )
        : undefined;
    const posts = await recordSnapshotPostWaitResults(h, leaver);
    const disputes = await h.rpcStub.recordDisputeSubmissions(leaver.index, {
        forward: options.forwardDisputes ?? false
    });
    expect(
        await joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        )
    ).to.equal(true);
    return {
        joiner,
        leaver,
        remainingPeerIndices: [0, 2],
        posts,
        disputes,
        snapshotBeforeExit: await h.query.getOnChainSnapshotHash(),
        includeInboundAgain: async () => {
            for (const restoreInclusion of restoreInclusions)
                await restoreInclusion();
        },
        /** Runs the one leave watchdog the leave armed, as its expiry does. */
        expireWatchdog: async () => {
            if (!watchdog) throw new Error("Staged without holdWatchdog");
            expect(await watchdog.heldCount()).to.equal(1);
            await watchdog.release(true);
        }
    };
}

/**
 * Until the peer runs no exit snapshot post and has none queued
 * (`LeaveChannelService`'s `isPosting`; a queued post starts in the same
 * tick its predecessor ends).
 */
async function waitUntilExitPostsIdle(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<void> {
    await waitFor(
        () =>
            h.execOnHost(
                peer,
                (sm) =>
                    Reflect.get(sm.leaveChannelService, "isPosting") === false
            ),
        h.event.protocolEventTimeoutMs()
    );
}

/**
 * U72 staging. On the omitted join (see `stageOmittedInboundJoin`), founder
 * 1 leaves and sends its exit on its leave turn; its first snapshot post
 * after the exit block is blocked by that join. Returns once that post
 * resolved false and no exit post runs or waits (blocks finalized during
 * that post queue one more, also refused); `includeInboundAgain` lets the
 * founders include the join again.
 */
export async function stageInboundBlockedExit(
    h: MathPeerTestHarness,
    options: InboundJoinStagingOptions = {}
) {
    const staged = await stageOmittedInboundJoin(h, options);
    const { leaver, posts } = staged;
    const exit = exitOnLeaveTurn(leaver);
    await leaver.p2pInstance.p2pSigner.leaveChannel();
    await h.transition.keepAuthoringUntil({
        until: () => exit() !== undefined,
        waitForPeers: [0, 1, 2],
        maximumBlocks: 6
    });
    await exit();
    expect((await posts.resultsWait(1))[0]).to.equal(
        "RaceConditionPendingInboundNotConsumed"
    );
    await waitUntilExitPostsIdle(h, leaver);
    return staged;
}

/**
 * U71's two-founder flow, then a JOIN that no block can consume. Both
 * founders leave and send their exits on their leave turns; the second exit
 * leaves no participant. Both founders' exit posts are recorded and park
 * before they prepare, so none of them lands. Once both exit blocks are
 * committed, a JOIN lands on chain: no member is left to author a block that
 * consumes it, so every exit post is refused. Returns the last leaver (the
 * author of the exit that left no participant), its post recorder with its
 * one started post parked before it prepares, and the restore of both
 * recorders.
 */
export async function stageLastExitBlockedByJoin(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 0, {
        // the leave watchdog's dispute is not the subject
        configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 60_000 }
    });
    const forkId = h.activeForkId!;
    const founders = [h.getPeer(0), h.getPeer(1)];
    const posts = [
        await recordSnapshotPostWaitResults(h, founders[0]),
        await recordSnapshotPostWaitResults(h, founders[1])
    ];
    const restore = async () => {
        for (const recorder of posts) await recorder.restore();
    };
    try {
        for (const recorder of posts) await recorder.holdStarts();
        const exits = founders.map((founder) => exitOnLeaveTurn(founder));
        for (const founder of founders)
            await founder.p2pInstance.p2pSigner.leaveChannel();
        // one block hands the turn to the leavers; each sends its exit on
        // its leave turn
        await h.transition.advanceState({ waitForPeers: [0, 1] });
        await h.event.waitForPeers("onLeaveTurn", [0, 1], 1);
        for (const exit of exits) await exit();
        for (const founder of founders)
            await h.event.waitUntilLeaveState(
                founder.index,
                "isExitBlockCommitted"
            );
        // the last leaver authored the latest block, and its state has no
        // participant
        let lastIndex = -1;
        await waitFor(async () => {
            for (const [index, founder] of founders.entries()) {
                const query = h.control(founder).query;
                const latest = await query.getLatestBlockInfo(forkId).request();
                if (
                    latest?.author === founder.address &&
                    (await query.getParticipants().request()).length === 0
                )
                    lastIndex = index;
            }
            return lastIndex !== -1;
        }, h.event.protocolEventTimeoutMs());
        const leaverPosts = posts[lastIndex];
        // its exit block's post is parked before it prepares
        await waitFor(
            async () => (await leaverPosts.started()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        await h.join.forceInboundJoinWait({
            waitForHonestPeersObserve: false
        });
        return { leaver: founders[lastIndex], posts: leaverPosts, restore };
    } catch (error) {
        await restore();
        throw error;
    }
}

/**
 * Runs one membership check of the peer's leave service, as its event
 * subscriptions request it, and waits until it ended. Returns whether an
 * exit post is then queued behind the running one.
 */
export function runLeaveCheck(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<boolean> {
    return h.execOnHost(peer, async (sm) => {
        const service = sm.leaveChannelService;
        service["requestCheck"]();
        await service["checks"];
        return service["isPostQueued"];
    });
}

/**
 * On the omitted join (see `stageOmittedInboundJoin`), founder 1 leaves and
 * never sends its exit: its leave awaits its leave turn.
 */
export async function stageLeaveAwaitingTurn(
    h: MathPeerTestHarness,
    options: InboundJoinStagingOptions = {}
) {
    const staged = await stageOmittedInboundJoin(h, options);
    await staged.leaver.p2pInstance.p2pSigner.leaveChannel();
    return staged;
}

/**
 * `stageInboundBlockedExit` for an exit the application authors on its own
 * turn, as a protocol exit does, with no leave operation.
 */
export async function stageInboundBlockedProtocolExit(
    h: MathPeerTestHarness,
    options: InboundJoinStagingOptions = {}
) {
    const staged = await stageOmittedInboundJoin(h, options);
    await h.transition.participantLeaveStateTransition({
        leaverIndex: staged.leaver.index,
        waitForPeers: [0, 1, 2]
    });
    expect((await staged.posts.resultsWait(1))[0]).to.equal(
        "RaceConditionPendingInboundNotConsumed"
    );
    await waitUntilExitPostsIdle(h, staged.leaver);
    return staged;
}

/**
 * The joiner of `stageOmittedInboundJoin` disputes the fork through its own
 * SDK: a dispute the founders observe and did not start.
 */
export async function disputeOmittedJoin(
    h: MathPeerTestHarness,
    joinerIndex: number
): Promise<void> {
    expect(
        await h.execOnHost(h.getPeer(joinerIndex), async (sm) => {
            await sm.disputeManager.dispute(sm.forkId);
            return sm.storage.disputes.didIDispute(sm.forkId);
        })
    ).to.equal(true);
}

/**
 * Records the peer's host errors (fatal runtime errors). Returns the error
 * messages and the removal of the listener.
 */
export function recordHostErrors(peer: HarnessPeer): {
    errors: string[];
    remove: () => void;
} {
    const errors: string[] = [];
    const remove = peer.p2pInstance.onHostError((error) =>
        errors.push(error.message)
    );
    return { errors, remove: () => void remove() };
}

/**
 * Three founders; founder 1 leaves and sends its exit on its leave turn. Its
 * post of the finalized exit block is parked at its send. Then its held
 * leave watchdog expires, and the self-removal dispute it starts is parked
 * at its send, before the chain sees it. Participant-timeout checks are off:
 * no block follows the exit, and a timeout dispute is not the subject.
 * Returns the leaver, both parked sends, its host errors and the restore.
 */
export async function stageExitPostAndOwnDisputeHeld(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0);
    const leaver = h.getPeer(1);
    for (const peer of h.peers)
        await h.rpcStub.suppressTimeoutCheck(peer.index);
    const hostErrors = recordHostErrors(leaver);
    const watchdog = await h.rpcStub.holdScheduledTasks(
        leaver.index,
        "channel leave watchdog"
    );
    const send = await h.rpcStub.holdSnapshotPostSend(leaver.index);
    const disputes = await h.rpcStub.recordDisputeSubmissions(leaver.index, {
        hold: true,
        forward: true
    });
    const restore = async () => {
        await send.release();
        await disputes.restore();
        hostErrors.remove();
    };
    try {
        const exit = exitOnLeaveTurn(leaver);
        await leaver.p2pInstance.p2pSigner.leaveChannel();
        await h.transition.keepAuthoringUntil({
            until: () => exit() !== undefined,
            waitForPeers: [0, 1, 2],
            maximumBlocks: 6
        });
        await exit();
        // the finalized exit block's post is parked at its send
        await send.waitUntilHeld();
        // the one leave watchdog expires; its dispute is parked at its send
        expect(await watchdog.heldCount()).to.equal(1);
        await watchdog.release(true);
        await disputes.waitUntilHeld();
        return {
            leaver,
            send,
            disputes,
            hostErrors: hostErrors.errors,
            restore
        };
    } catch (error) {
        await restore();
        throw error;
    }
}

/** Whether the peer's disputes carry its self-removal (its force-exit flag). */
export function readForceExit(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<boolean> {
    return h.execOnHost(peer, (sm) => sm.storage.forceExit.getForceExit());
}

/** Reads the peer's chain account nonce from another peer's provider: it works after the peer is disposed. */
export async function chainNonceReader(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<() => Promise<number>> {
    const address = await peer.p2pInstance.chainSigner.getAddress();
    const provider = h.getPeer(0).p2pInstance.chainSigner.provider!;
    return () => provider.getTransactionCount(address, "pending");
}

/**
 * A synced spectator (peer 3 of three founders) holding a join
 * confirmation whose authorization ends `authorizationSeconds` after the
 * latest chain block. Returns the prepared join and its deadline.
 */
export async function prepareJoinWithAuthorization(
    h: MathPeerTestHarness,
    authorizationSeconds: number,
    configOverrides?: HarnessOptions["configOverrides"]
) {
    const { joiner } = await h.scenario.syncSpectatorAndPrepareJoin(
        0,
        configOverrides === undefined ? undefined : { configOverrides }
    );
    const joinDeadline =
        (await Clock.getBlockchainTime()).timestamp + authorizationSeconds;
    const prepared = await h.join.buildJoinChannelConfirmation({
        joiner,
        channelId: h.channelId,
        jcOverrides: { deadlineTimestamp: BigInt(joinDeadline) }
    });
    return { joiner, joinDeadline, ...prepared };
}

/**
 * Returns once the chain holds a block whose timestamp is past
 * `timestamp`. An idle chain mints none, so once that time has passed
 * founder 0 sends one plain transaction to mint it.
 */
export async function chainBlockPastWait(
    h: MathPeerTestHarness,
    timestamp: number
): Promise<void> {
    const founder = h.getPeer(0);
    const waitSeconds = Math.max(0, timestamp - Clock.getTimeInSeconds());
    await waitFor(
        async () => {
            if ((await Clock.getBlockchainTime()).timestamp > timestamp)
                return true;
            if (Clock.getTimeInSeconds() > timestamp) {
                await (
                    await founder.p2pInstance.chainSigner.sendTransaction({
                        to: founder.address,
                        value: 0n
                    })
                ).wait();
            }
            return false;
        },
        waitSeconds * 1000 + h.event.protocolEventTimeoutMs(),
        500
    );
}

/** Delays of the recorded `force join deadline` tasks, in scheduling order. */
export async function recordedForceJoinDeadlineDelays(
    h: MathPeerTestHarness,
    joiner: HarnessPeer
): Promise<number[]> {
    const { tasks } = await h
        .control(joiner)
        .stub.getRecordedScheduledTasks()
        .request();
    return tasks
        .filter((task) => task.taskName === "force join deadline")
        .map((task) => task.delayMs);
}

/**
 * `requester` sends a latest-state spectate request (no fork) to
 * `responderAddress` over the real RPC, then runs its real latest sync
 * against it. Returns the request's refusal message ("" when served) and
 * the sync verdict.
 */
async function requestLatestFrom(
    h: MathPeerTestHarness,
    requester: HarnessPeer,
    responderAddress: string
): Promise<{ refusal: string; synced: boolean }> {
    return await h.execOnHost(
        requester,
        async (sm, { source }) => {
            let refusal = "";
            try {
                await sm.p2pManager.remoteRpc.spectateService
                    .onSpectateRequest({ channelId: sm.channelId })
                    .request(source);
            } catch (error) {
                refusal =
                    error instanceof Error ? error.message : String(error);
            }
            const synced = await sm.p2pManager.localRpc.spectateService
                .sync(source, sm.channelId)
                .then(({ synced }) => synced);
            return { refusal, synced };
        },
        { source: responderAddress },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
}

/**
 * Peer 0 is past its initial load but lags the chain: peers 2 and 3 reduce
 * the fork that peer 1 corrupted and the chain adopts the successor, while
 * peer 0's own install of that successor is held at its VM write. Once
 * peer 0's chain mirror holds the adopted successor, participant peer 2 asks
 * it for the latest state. Returns the successor, peer 0's fork and whether
 * it installed the successor, the request result and whether peer 0
 * blacklisted peer 2.
 */
export async function latestRequestToResponderBehindChainFork(
    h: MathPeerTestHarness
) {
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 3 }
    });
    const forkId = h.activeForkId!;
    const responder = h.getPeer(0);
    const requester = h.getPeer(2);
    const lagging = await h.rpcStub.holdReductionGenesisApplication(
        responder.index,
        { outcome: "hold", at: "setState" }
    );
    try {
        await h.byzantine.submitInvalidStateTransitionBlock(1);
        // peer 0 stays seated on the successor without installing it
        const { newForkId: successor } = await h.dispute.resolveDisputeWait({
            forkId,
            maliciousPeerIndices: [1],
            honestPeerIndices: [2, 3],
            syntheticOnChainParticipants: 1
        });
        await waitFor(
            async () =>
                await h.execOnHost(
                    responder,
                    async (sm, args) =>
                        (
                            await sm.diamondStateMachine.localDiamondContract.getStateSnapshot(
                                sm.channelId
                            )
                        ).forkId === args.successor,
                    { successor }
                ),
            h.event.protocolEventTimeoutMs()
        );
        const { responderForkId, isSuccessorInstalled } = await h.execOnHost(
            responder,
            async (sm, args) => ({
                responderForkId: sm.forkId,
                isSuccessorInstalled:
                    sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        args.successor
                    ) !== undefined
            }),
            { successor }
        );
        const { refusal, synced } = await requestLatestFrom(
            h,
            requester,
            responder.address
        );
        return {
            sourceForkId: forkId,
            successor,
            responderForkId,
            isSuccessorInstalled,
            refusal,
            synced,
            requesterBlacklisted: await h
                .control(responder)
                .query.isBlacklisted(requester.address)
                .request()
        };
    } finally {
        await lagging.release();
    }
}

/**
 * Peer 0 holds a computed but uninstalled successor of a reducible disputed
 * fork, so its own fork is behind the fork it derives from the chain.
 * Observer peer 2 runs a latest sync (no fork) against peer 0. Returns the
 * source fork, the responder's own fork when asked, the successor fork,
 * the verdict, the observer's fork afterwards and both
 * blacklist reads.
 */
export async function latestSyncFromResponderBehindDerivedFork(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const source = h.getPeer(0);
    const observer = h.getPeer(2);
    const hold = await h.rpcStub.holdReductionGenesisApplication(0, {
        outcome: "hold",
        at: "setState"
    });
    try {
        await h.control(source).stub.startTryReduce(sourceForkId).request();
        await waitFor(async () => (await hold.entered()) === 1);
        const successor = await h.execOnHost(
            source,
            async (sm, { forkId }) => {
                const disputes = await sm.agreementManager.getForkDisputes(
                    (await sm.eventSyncService.loadSynchronizedWindowCommitments(
                        sm.channelId,
                        forkId
                    ))!
                );
                return (await sm.reductionManager.computeReductionLocally(
                    forkId,
                    disputes
                ))!.reducedForkId;
            },
            { forkId: sourceForkId }
        );
        const responderOwnFork = await h
            .control(source)
            .query.getForkId()
            .request();
        const accepted = await h.execOnHost(
            observer,
            async (sm, args) =>
                sm.p2pManager.localRpc.spectateService
                    .sync(args.source, sm.channelId)
                    .then(({ synced }) => synced),
            { source: source.address }
        );
        return {
            sourceForkId,
            responderOwnFork,
            successor,
            accepted,
            observerForkId: await h
                .control(observer)
                .query.getForkId()
                .request(),
            observerBlacklistedResponder: await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request(),
            responderBlacklistedObserver: await h
                .control(source)
                .query.isBlacklisted(observer.address)
                .request()
        };
    } finally {
        await hold.release();
    }
}

/**
 * Staging for an exit restarted on a successor fork that still seats the
 * leaver. Founder 2 is blind to block gossip when founder 1 authors its exit
 * with no leave call, so the exit block is never final. Founder 0 then signs
 * an out-of-turn block at the exit's height; delivered to founder 2, it is a
 * real invalid state transition, and founder 2 disputes it from the state
 * before the exit. Founder 0 (the offender) contributes no evidence and
 * founder 1's own disputes are recorded, not sent, so the window's reduction
 * proves the state before the exit: the successor fork drops founder 0 and
 * still seats founders 1 and 2. Returns once founders 1 and 2 installed it,
 * with every staging stub restored.
 */
export async function stageExitReplacedBySeatingFork(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 0, {
        // the leave watchdog's dispute is not the subject
        configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 60_000 }
    });
    const forkId = h.activeForkId!;
    const offender = h.getPeer(0);
    const leaver = h.getPeer(1);
    const disputer = h.getPeer(2);
    const exit = exitOnLeaveTurn(leaver);
    let restoreGossip: (() => Promise<void>) | undefined;
    let restoreTimeoutCheck: (() => Promise<void>) | undefined;
    let disputes:
        | Awaited<
              ReturnType<
                  MathPeerTestHarness["rpcStub"]["recordDisputeSubmissions"]
              >
          >
        | undefined;
    try {
        await h.transition.keepAuthoringUntil({
            until: () => h.control(leaver).query.isMyTurn().request(),
            waitForPeers: [0, 1, 2],
            maximumBlocks: 3
        });
        // founder 2 disputes only the invalid block below: its wait for the
        // exit block it never sees times no one out
        restoreTimeoutCheck = await h.rpcStub.suppressTimeoutCheck(
            disputer.index
        );
        await h.dispute.suppressDisputeInitiation([offender.index]);
        disputes = await h.rpcStub.recordDisputeSubmissions(leaver.index);
        restoreGossip = await h.rpcStub.dropNetworkConfirmations(
            disputer.index
        );
        await h.transition.submit(
            leaver,
            (contract) => contract.leaveChannel(),
            {
                waitForTurn: true,
                waitForPeers: [0, 1],
                waitForFinalization: false
            }
        );
        await h.event.waitUntilLeaveState(leaver.index, "isExitBlockCommitted");
        const { encodedBlock } = await h.byzantine.craftInvalidTransitionBlock(
            disputer.index,
            { offenderIndex: offender.index }
        );
        await h
            .control(disputer)
            .transition.ingestBlockConfirmation(encodedBlock, {
                origin: BlockOrigin.PROOF
            })
            .request();
        await h.dispute.resolveDisputeWait({
            forkId,
            maliciousPeerIndices: [offender.index],
            honestPeerIndices: [leaver.index, disputer.index]
        });
    } finally {
        await restoreGossip?.();
        await restoreTimeoutCheck?.();
        await disputes?.restore();
        await h.dispute.restoreDisputeInitiation([offender.index]);
    }
    return { leaver, forkId, exit };
}
