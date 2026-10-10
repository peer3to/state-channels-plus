// @spec-test-coverage-ignore: block queue drain staging exercised by explicit BlockQueueManager declarations
import * as factory from "../factory";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { QueueIntakeFixture } from "./QueueIntakeFixture";
import { BlockOrigin } from "@/storage/QueueStorage";
import { BlockConfirmationEthersType } from "@/types/ethers";
import type { ForkId, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Two future blocks each get a source probe from their queue timeout; both
 * probes are held at their sync. `stop()` reaches the drain, the first probe
 * fails, and the drain keeps waiting with its dependencies alive; the second
 * probe then runs for real. `stop()` rejects with the first failure only
 * after the queues and the recovery state are cleared.
 */
export async function stopWithRejectedAndPendingProbes() {
    const f = new QueueIntakeFixture();
    await f.start();
    const second = await f.encodeFutureBlock(21);
    return await f.h.execOnHost(
        f.h.getPeer(0),
        async (sm, args, { ethers }) => {
            const spectate = sm.p2pManager.localRpc.spectateService;
            const sync = spectate.sync;
            const probes: {
                release: () => void;
                fail: (error: Error) => void;
            }[] = [];
            let bothEntered!: () => void;
            const entered = new Promise<void>((resolve) => {
                bothEntered = resolve;
            });
            spectate.sync = (...parameters) =>
                new Promise<boolean>((resolve, reject) => {
                    probes.push({
                        release: () =>
                            resolve(sync.apply(spectate, parameters)),
                        fail: reject
                    });
                    if (probes.length === 2) bothEntered();
                });
            const queue = sm.blockQueueManager;
            const dispose = queue.dispose;
            let drainEntered!: () => void;
            const draining = new Promise<void>((resolve) => {
                drainEntered = resolve;
            });
            queue.dispose = () => {
                drainEntered();
                return dispose.call(queue);
            };
            try {
                for (const encoded of args.encodedBlockConfirmations) {
                    const block = ethers.AbiCoder.defaultAbiCoder().decode(
                        [args.blockType],
                        encoded
                    )[0];
                    await queue.ingestBlockConfirmation(block, {
                        origin: args.origin,
                        senderAddress: args.source
                    });
                }
                // the real queue timeouts probe both future blocks
                await entered;
                const jobs = [...queue["inFlight"]];
                let stopped = false;
                let stopError = "";
                const stopping = sm.stop().then(
                    () => {
                        stopped = true;
                    },
                    (error: Error) => {
                        stopped = true;
                        stopError = error.message;
                    }
                );
                await draining;
                probes[0].fail(new Error(args.failure));
                await jobs[0].catch(() => undefined);
                const afterFailure = {
                    stopped,
                    inFlight: queue["inFlight"].size,
                    timeoutManagerDisposed: sm.timeoutManager["isDisposed"]
                };
                probes[1].release();
                await stopping;
                return {
                    jobs: jobs.length,
                    afterFailure,
                    stopError,
                    afterStop: {
                        inFlight: queue["inFlight"].size,
                        queued: args.hashes.map(
                            (hash) => !!sm.storage.queues.getQueuedEntry(hash)
                        ),
                        recoveryScheduled:
                            queue["recoveryScheduledForFork"].size,
                        recoverySuppressed:
                            queue["recoverySuppressedUntil"].size,
                        timeoutManagerDisposed: sm.timeoutManager["isDisposed"]
                    }
                };
            } finally {
                for (const probe of probes) probe.release();
                spectate.sync = sync;
                queue.dispose = dispose;
            }
        },
        {
            blockType: BlockConfirmationEthersType,
            encodedBlockConfirmations: [
                f.encodedBlockConfirmation,
                second.encoded
            ],
            hashes: [f.block.hash, second.hash],
            origin: BlockOrigin.NETWORK as const,
            source: f.h.getPeer(1).address,
            failure: "probe failed"
        }
    );
}

/**
 * A block on a fork other than the disputed, kill-expired current fork
 * schedules a real fork recovery. Its timer is captured, then run, and the
 * recovery is held at its first chain read. `stop()` reaches the drain and
 * waits with the timeout manager alive; after the release the recovery ends
 * and `stop()` resolves with the recovery state cleared.
 */
export async function stopWithHeldForkRecovery(h: MathPeerTestHarness) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
    const observer = h.getPeer(0);
    // an honest participant: the staged dispute accuses peer 1
    const author = h.getPeer(2);
    const offFork = await factory.buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId: factory.hash() as ForkId,
            transactionCnt: 1,
            participant: author.address
        }
    });
    return await h.execOnHost(
        observer,
        async (sm, args, { ethers }) => {
            const queue = sm.blockQueueManager;
            const timeoutManager = sm.timeoutManager;
            const schedule = timeoutManager.scheduleTask;
            const recoveries: (() => void | Promise<void>)[] = [];
            let recoveryScheduled!: () => void;
            const scheduled = new Promise<void>((resolve) => {
                recoveryScheduled = resolve;
            });
            timeoutManager.scheduleTask = (task, delay, name) => {
                if (!name?.startsWith("BlockQueueManager.runForkRecovery"))
                    return schedule.call(timeoutManager, task, delay, name);
                recoveries.push(task);
                recoveryScheduled();
                return {} as ReturnType<typeof setTimeout>;
            };
            const validation = sm.validationService;
            const isDisputedFork = validation.isDisputedFork;
            let armed = false;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let recoveryHeld!: () => void;
            const held = new Promise<void>((resolve) => {
                recoveryHeld = resolve;
            });
            validation.isDisputedFork = async (...parameters) => {
                if (armed) {
                    armed = false;
                    recoveryHeld();
                    await gate;
                }
                return isDisputedFork.apply(validation, parameters);
            };
            const dispose = queue.dispose;
            let drainEntered!: () => void;
            const draining = new Promise<void>((resolve) => {
                drainEntered = resolve;
            });
            queue.dispose = () => {
                drainEntered();
                return dispose.call(queue);
            };
            try {
                const block = ethers.AbiCoder.defaultAbiCoder().decode(
                    [args.blockType],
                    args.encodedBlockConfirmation
                )[0];
                await queue.ingestBlockConfirmation(block, {
                    origin: args.origin,
                    senderAddress: args.source
                });
                await scheduled;
                // the recovery's first read runs synchronously in its timer
                armed = true;
                void recoveries[0]();
                armed = false;
                await held;
                let stopped = false;
                const stopping = sm.stop().then(() => {
                    stopped = true;
                });
                await draining;
                const whileHeld = {
                    onSourceFork: sm.forkId === args.sourceForkId,
                    stopped,
                    inFlight: queue["inFlight"].size,
                    recoveryScheduled: queue["recoveryScheduledForFork"].has(
                        sm.forkId
                    ),
                    timeoutManagerDisposed: timeoutManager["isDisposed"]
                };
                release();
                await stopping;
                return {
                    recoveries: recoveries.length,
                    whileHeld,
                    afterStop: {
                        inFlight: queue["inFlight"].size,
                        recoveryScheduled:
                            queue["recoveryScheduledForFork"].size,
                        timeoutManagerDisposed: timeoutManager["isDisposed"]
                    }
                };
            } finally {
                release();
                timeoutManager.scheduleTask = schedule;
                validation.isDisputedFork = isDisputedFork;
                queue.dispose = dispose;
            }
        },
        {
            blockType: BlockConfirmationEthersType,
            encodedBlockConfirmation: offFork,
            origin: BlockOrigin.NETWORK as const,
            source: author.address,
            sourceForkId
        }
    );
}

/**
 * A fork recovery whose timer was armed before `stop()` and fires after it
 * began, and one scheduled after it began, never enter `runForkRecovery`.
 */
export async function scheduleForkRecoveryAroundStop() {
    const f = new QueueIntakeFixture();
    await f.start();
    return await f.h.execOnHost(
        f.h.getPeer(0),
        async (sm, args) => {
            const queue = sm.blockQueueManager;
            const runForkRecovery = queue["runForkRecovery"];
            let entered = 0;
            queue["runForkRecovery"] = (forkId: ForkId) => {
                entered++;
                return runForkRecovery.call(queue, forkId);
            };
            const timeoutManager = sm.timeoutManager;
            const schedule = timeoutManager.scheduleTask;
            const recoveries: (() => void | Promise<void>)[] = [];
            timeoutManager.scheduleTask = (task, delay, name) => {
                if (!name?.startsWith("BlockQueueManager.runForkRecovery"))
                    return schedule.call(timeoutManager, task, delay, name);
                recoveries.push(task);
                return {} as ReturnType<typeof setTimeout>;
            };
            // stop() parks on the custom RPC disposal, after it set
            // isDisposed and before the block queue disposes
            const localRpc = sm.p2pManager.localRpc;
            const disposeLocalRpc = localRpc.dispose;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            localRpc.dispose = async () => {
                await gate;
                return disposeLocalRpc.call(localRpc);
            };
            try {
                queue["scheduleForkRecovery"](sm.forkId);
                const scheduledBeforeStop = recoveries.length;
                const stopping = sm.stop();
                queue["scheduleForkRecovery"](args.otherForkId);
                const scheduledAfterStop =
                    recoveries.length - scheduledBeforeStop;
                // the timer armed before stop fires now
                for (const recovery of recoveries) await recovery();
                const inFlight = queue["inFlight"].size;
                release();
                await stopping;
                return {
                    scheduledBeforeStop,
                    scheduledAfterStop,
                    inFlight,
                    entered
                };
            } finally {
                release();
                queue["runForkRecovery"] = runForkRecovery;
                timeoutManager.scheduleTask = schedule;
                localRpc.dispose = disposeLocalRpc;
            }
        },
        { otherForkId: factory.hash() as ForkId }
    );
}

/**
 * A spectator's sync is held with the channel tip in its payload while a
 * copy of that tip and the next block queue on its not yet synced fork, with
 * no queue timeout armed to rescue them. The sync then stores the tip, so
 * the drain it schedules dequeues the stored tip copy: the next block must
 * still drain and apply. `next` arrives by direct ingest or by gossip.
 */
export async function assertStoredTipCopyDrainsNextBlock(
    h: MathPeerTestHarness,
    next: "ingested" | "gossiped"
): Promise<void> {
    // the queued next block is applied well inside its agreement window
    await h.lifecycle.start(3, 1, {
        timeConfig: {
            p2pTime: 2,
            agreementTime: 12,
            chainFallbackTime: 3,
            evidenceTime: 6
        }
    });
    const forkId = h.activeForkId!;
    for (const index of [0, 1, 2]) await h.rpcStub.suppressTimeoutCheck(index);
    const author = h.getPeer(0);
    const spectator = await h.join.createSpectatorPeer();
    const queueTimeouts = await h.rpcStub.recordScheduledTasks(
        spectator.index,
        { suppressPrefix: "BlockQueueManager.queueTimeout" }
    );
    const sync = await h.rpcStub.holdSpectateSyncApplication(spectator.index);
    const ingest = async (hash: Hash) => {
        const latest = await h
            .control(author)
            .query.getLatestBlockConfirmation(forkId)
            .request();
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: spectator.index,
            blockConfirmation: Codec.decode(
                latest!.encodedBlockConfirmation,
                Type.BlockConfirmation
            ),
            ingestOptions: {
                origin: BlockOrigin.NETWORK,
                senderAddress: author.address
            },
            keepConnection: true,
            waitForProcessed: false
        });
        expect(
            await h.control(spectator).query.isBlockQueued(hash).request()
        ).to.equal(true);
    };
    try {
        await h.join.connectSpectator(spectator);
        await waitFor(
            async () => (await sync.entered()) > 0,
            h.event.protocolEventTimeoutMs()
        );
        const tipHeight = (await h
            .control(author)
            .query.getLatestBlockHeight(forkId)
            .request())!;
        await ingest(
            (await h
                .control(author)
                .query.getLatestBlockHash(forkId)
                .request())!
        );
        await h.transition.advanceState({ count: 1, waitForPeers: [0, 1, 2] });
        const nextHash = (await h
            .control(author)
            .query.getLatestBlockHash(forkId)
            .request())!;
        if (next === "ingested") await ingest(nextHash);
        else
            await waitFor(
                async () =>
                    await h
                        .control(spectator)
                        .query.isBlockQueued(nextHash)
                        .request(),
                h.event.protocolEventTimeoutMs()
            );

        await sync.release();
        await waitFor(
            async () =>
                (await h
                    .control(spectator)
                    .query.getLatestBlockHash(forkId)
                    .request()) === nextHash,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h
                .control(spectator)
                .query.getLatestBlockHeight(forkId)
                .request()
        ).to.equal(tipHeight + 1);
        expect(
            await h.control(spectator).query.isBlockQueued(nextHash).request()
        ).to.equal(false);
    } finally {
        await sync.release();
        await queueTimeouts.restore();
    }
}
