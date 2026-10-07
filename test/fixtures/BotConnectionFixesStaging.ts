// @spec-test-coverage-ignore: shared staging for the bot-connection fix unit cases (lobby discovery, leave settlement, join bounds, latest spectate)
import Clock from "@/Clock";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";

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
 * Record-only probe on the peer's `SnapshotUpdateService.postStateSnapshotWait`:
 * every call still runs. Returns the resolved results and the restore.
 */
export async function recordSnapshotPostWaitResults(
    h: MathPeerTestHarness,
    peer: HarnessPeer
): Promise<{
    results: () => Promise<boolean[]>;
    restore: () => Promise<void>;
}> {
    await h.execOnHost(peer, (sm) => {
        const service = sm.snapshotUpdateService;
        const original = service.postStateSnapshotWait;
        const post = original.bind(service);
        const results: boolean[] = [];
        Reflect.set(service, "recordedPostWaitResults", results);
        Reflect.set(service, "recordedPostWaitOriginal", original);
        service.postStateSnapshotWait = async (...parameters) => {
            const posted = await post(...parameters);
            results.push(posted);
            return posted;
        };
        return true;
    });
    return {
        results: () =>
            h.execOnHost(peer, (sm) => [
                ...(Reflect.get(
                    sm.snapshotUpdateService,
                    "recordedPostWaitResults"
                ) as boolean[])
            ]),
        restore: async () => {
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

/**
 * A synced spectator (peer 3 of three founders) holding a join
 * confirmation whose authorization ends `authorizationSeconds` after the
 * latest chain block. Returns the prepared join and its deadline.
 */
export async function prepareJoinWithAuthorization(
    h: MathPeerTestHarness,
    authorizationSeconds: number
) {
    const { joiner } = await h.scenario.syncSpectatorAndPrepareJoin(0);
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
export async function requestLatestFrom(
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
            const synced = await sm.p2pManager.localRpc.spectateService.sync(
                source,
                sm.channelId
            );
            return { refusal, synced };
        },
        { source: responderAddress },
        { timeoutMs: h.event.hostExecTimeoutMs() }
    );
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
                sm.p2pManager.localRpc.spectateService.sync(
                    args.source,
                    sm.channelId
                ),
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
