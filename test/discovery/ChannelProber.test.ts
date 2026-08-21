import { expect } from "chai";
import { ethers } from "ethers";

import { createLogger } from "@/utils";
import { Status } from "@/types";
import type { Address, ChannelId } from "@/types/types";
import { EventBus } from "@/events/EventBus";
import {
    ChannelProber,
    type ChannelProberSigner,
    type RendezvousAttemptFn,
    type RendezvousResult,
    type SyncAttemptFn,
    type SyncResult
} from "@/discovery/ChannelProber";

function createLoggerForTest() {
    return createLogger({}, {}, { level: "error" });
}

/** Resolves once every pending microtask has drained. */
async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

const PEER0 = ethers.getAddress("0x" + "11".repeat(20));
const PEER1 = ethers.getAddress("0x" + "22".repeat(20));

/**
 * A rendezvous seam that never resolves on its own - the test releases each
 * pending attempt explicitly, so worker-pool scheduling can be observed one
 * step at a time. Also tracks abort-driven cleanup.
 */
function makeGatedRendezvous() {
    const pending = new Map<string, (result: RendezvousResult) => void>();
    const startedOrder: string[] = [];
    const abortedIds: string[] = [];
    let active = 0;
    let maxActive = 0;

    const fn: RendezvousAttemptFn = (channelId, _timeoutMs, signal) => {
        const id = String(channelId);
        startedOrder.push(id);
        active += 1;
        maxActive = Math.max(maxActive, active);
        return new Promise<RendezvousResult>((resolve) => {
            const settle = (result: RendezvousResult): void => {
                if (!pending.has(id)) return;
                pending.delete(id);
                active -= 1;
                signal.removeEventListener("abort", onAbort);
                resolve(result);
            };
            const onAbort = (): void => {
                abortedIds.push(id);
                settle({ outcome: "aborted" });
            };
            signal.addEventListener("abort", onAbort);
            pending.set(id, settle);
        });
    };

    return {
        fn,
        startedOrder,
        abortedIds,
        get active() {
            return active;
        },
        get maxActive() {
            return maxActive;
        },
        release(channelId: ChannelId, result: RendezvousResult): void {
            const settle = pending.get(String(channelId));
            if (!settle) {
                throw new Error(
                    `makeGatedRendezvous: no pending attempt for ${String(channelId)}`
                );
            }
            settle(result);
        }
    };
}

function makeSignerDouble(
    overrides: {
        connectToChannel?: (channelId: ChannelId) => Promise<void>;
        getChannelStatus?: () => Promise<Status>;
        getOnChainParticipantUnion?: (
            channelId: ChannelId
        ) => Promise<Address[]>;
        probeChannel?: (peerAddress: string, channelId: ChannelId) => boolean;
    } = {}
): {
    signer: ChannelProberSigner;
    events: EventBus;
    joins: string[];
    leaves: string[];
    connectCalls: ChannelId[];
} {
    const events = new EventBus();
    const joins: string[] = [];
    const leaves: string[] = [];
    const connectCalls: ChannelId[] = [];
    const probeCalls: { peerAddress: string; channelId: string }[] = [];
    const signer: ChannelProberSigner = {
        connectToChannel: async (channelId) => {
            connectCalls.push(channelId);
            await overrides.connectToChannel?.(channelId);
        },
        getChannelStatus:
            overrides.getChannelStatus ?? (async () => Status.NOT_OPENED),
        p2pManager: {
            holepunch: {
                join: async (topic) => {
                    joins.push(topic.toString("hex"));
                },
                leave: async (topic) => {
                    leaves.push(topic.toString("hex"));
                }
            },
            localRpc: {
                spectateService: {
                    probeChannel: async (peerAddress, channelId) => {
                        probeCalls.push({
                            peerAddress,
                            channelId: String(channelId)
                        });
                        return (
                            overrides.probeChannel?.(peerAddress, channelId) ??
                            true
                        );
                    }
                }
            },
            stateManager: {
                events,
                getOnChainParticipantUnion:
                    overrides.getOnChainParticipantUnion ?? (async () => [])
            }
        }
    };
    return { signer, events, joins, leaves, connectCalls };
}

describe("ChannelProber (component)", function () {
    describe("rendezvous worker pool (injected seam)", function () {
        it("never exceeds the concurrency cap and reuses a freed slot immediately for the next candidate", async function () {
            const candidates: ChannelId[] = ["c0", "c1", "c2", "c3", "c4"];
            const gated = makeGatedRendezvous();
            const double = makeSignerDouble();
            const prober = new ChannelProber(
                {
                    signer: double.signer,
                    logger: createLoggerForTest(),
                    events: double.events
                },
                {
                    concurrency: 2,
                    rendezvousAttempt: gated.fn,
                    syncAttempt: async () => ({ outcome: "timeout" })
                }
            );

            const resultPromise = prober.probe(candidates);

            // Initial fan-out is synchronous within the pool's own event loop
            // turn - no need to await anything to observe it.
            expect(gated.active).to.equal(2);
            expect(gated.maxActive).to.equal(2);
            expect(gated.startedOrder).to.deep.equal(["c0", "c1"]);

            // Free one slot: the pool must pick up c2 immediately, not wait
            // for c1 too (worker pool, not batched waves).
            gated.release("c0", { outcome: "timeout" });
            await flush();
            expect(gated.startedOrder).to.deep.equal(["c0", "c1", "c2"]);
            expect(gated.active).to.equal(2);
            expect(gated.maxActive).to.equal(2);

            gated.release("c1", { outcome: "timeout" });
            await flush();
            expect(gated.startedOrder).to.deep.equal(["c0", "c1", "c2", "c3"]);
            expect(gated.maxActive).to.equal(2);

            gated.release("c2", { outcome: "timeout" });
            await flush();
            expect(gated.startedOrder).to.deep.equal([
                "c0",
                "c1",
                "c2",
                "c3",
                "c4"
            ]);
            expect(gated.maxActive).to.equal(2);

            gated.release("c3", { outcome: "timeout" });
            gated.release("c4", { outcome: "timeout" });
            const result = await resultPromise;

            expect(result.status).to.equal("exhausted");
            expect(gated.maxActive).to.equal(2);
        });

        it("aborts every other in-flight rendezvous attempt as soon as one verifies", async function () {
            const candidates: ChannelId[] = ["c0", "c1", "c2"];
            const gated = makeGatedRendezvous();
            const double = makeSignerDouble();
            const prober = new ChannelProber(
                {
                    signer: double.signer,
                    logger: createLoggerForTest(),
                    events: double.events
                },
                {
                    concurrency: 3,
                    rendezvousAttempt: gated.fn,
                    syncAttempt: async () => ({ outcome: "synced" })
                }
            );

            const resultPromise = prober.probe(candidates);
            expect(gated.active).to.equal(3);

            gated.release("c1", { outcome: "verified", peerAddress: PEER0 });
            const result = await resultPromise;

            expect(result.status).to.equal("usable");
            if (result.status === "usable") {
                expect(String(result.channelId)).to.equal("c1");
                expect(result.peerAddress).to.equal(PEER0);
            }
            expect(gated.abortedIds.sort()).to.deep.equal(["c0", "c2"]);
        });
    });

    describe("probe() orchestration (injected seams)", function () {
        it("returns a usable candidate: one that fails its probe never wins, and a concurrent candidate that passes does", async function () {
            const candidates: ChannelId[] = ["channel-0", "channel-1"];
            const peerByChannel: Record<string, Address> = {
                "channel-0": PEER0,
                "channel-1": PEER1
            };
            const syncOutcomeByChannel: Record<string, SyncResult> = {
                "channel-0": { outcome: "timeout" },
                "channel-1": { outcome: "synced" }
            };
            const rendezvousAttempt: RendezvousAttemptFn = async (
                channelId
            ) => ({
                outcome: "verified",
                peerAddress: peerByChannel[String(channelId)]
            });
            const syncAttempt: SyncAttemptFn = async (channelId) =>
                syncOutcomeByChannel[String(channelId)];

            const double = makeSignerDouble();
            const prober = new ChannelProber(
                {
                    signer: double.signer,
                    logger: createLoggerForTest(),
                    events: double.events
                },
                { concurrency: 2, rendezvousAttempt, syncAttempt }
            );

            const result = await prober.probe(candidates);

            expect(result.status).to.equal("usable");
            if (result.status === "usable") {
                expect(String(result.channelId)).to.equal("channel-1");
                expect(result.peerAddress).to.equal(PEER1);
            }
            // Candidates are probed concurrently now, so the attempt log is
            // asserted by content rather than by a fixed interleaving.
            expect(result.attempts).to.have.deep.members([
                { channelId: "channel-0", stage: "rendezvous", outcome: "ok" },
                {
                    channelId: "channel-0",
                    stage: "sync",
                    outcome: "timeout",
                    reason: undefined
                },
                { channelId: "channel-1", stage: "rendezvous", outcome: "ok" },
                { channelId: "channel-1", stage: "sync", outcome: "ok" }
            ]);
        });

        it("returns a typed exhausted result, with one recorded attempt per candidate, when every rendezvous fails", async function () {
            const candidates: ChannelId[] = ["c0", "c1", "c2", "c3"];
            const rendezvousAttempt: RendezvousAttemptFn = async () => ({
                outcome: "timeout"
            });
            const double = makeSignerDouble();
            const prober = new ChannelProber(
                {
                    signer: double.signer,
                    logger: createLoggerForTest(),
                    events: double.events
                },
                {
                    concurrency: 2,
                    rendezvousAttempt,
                    syncAttempt: async () => ({ outcome: "synced" })
                }
            );

            const result = await prober.probe(candidates);

            expect(result.status).to.equal("exhausted");
            expect(result.attempts).to.have.length(4);
            for (const attempt of result.attempts) {
                expect(attempt.stage).to.equal("rendezvous");
                expect(attempt.outcome).to.equal("timeout");
            }
            expect(
                result.attempts.map((a) => String(a.channelId)).sort()
            ).to.deep.equal(["c0", "c1", "c2", "c3"]);
        });

        it("emits a discovery probeStage event for every recorded attempt", async function () {
            const double = makeSignerDouble();
            const received: unknown[] = [];
            double.events.on("discovery", "probeStage", (payload) => {
                received.push(payload);
            });
            const prober = new ChannelProber(
                {
                    signer: double.signer,
                    logger: createLoggerForTest(),
                    events: double.events
                },
                {
                    concurrency: 1,
                    rendezvousAttempt: async () => ({ outcome: "timeout" }),
                    syncAttempt: async () => ({ outcome: "synced" })
                }
            );

            await prober.probe(["c0"]);

            expect(received).to.deep.equal([
                {
                    channelId: "c0",
                    stage: "rendezvous",
                    outcome: "timeout",
                    reason: undefined
                }
            ]);
        });

        it("probes concurrent candidates at once and never arms a channel while probing", async function () {
            // Two candidates, concurrency 2. The first probe is held open;
            // under the old serialized design nothing else could progress
            // until it settled. Now the sibling probes and wins while the
            // first is still in flight.
            let releaseFirstProbe: ((result: SyncResult) => void) | undefined;
            const rendezvousAttempt: RendezvousAttemptFn = async (
                channelId
            ) => ({
                outcome: "verified",
                peerAddress: String(channelId) === "A" ? PEER0 : PEER1
            });
            const syncAttempt: SyncAttemptFn = (channelId, _p, _t, signal) => {
                if (String(channelId) === "A") {
                    return new Promise<SyncResult>((resolve) => {
                        releaseFirstProbe = resolve;
                        // Seam contract: settle when the signal aborts. The
                        // real probe settles via its own timeout.
                        signal.addEventListener("abort", () =>
                            resolve({ outcome: "timeout" })
                        );
                    });
                }
                return Promise.resolve<SyncResult>({ outcome: "synced" });
            };

            const double = makeSignerDouble();
            const prober = new ChannelProber(
                {
                    signer: double.signer,
                    logger: createLoggerForTest(),
                    events: double.events
                },
                { concurrency: 2, rendezvousAttempt, syncAttempt }
            );

            const result = await prober.probe(["A", "B"]);

            // B won without A's probe ever settling.
            expect(result.status).to.equal("usable");
            if (result.status === "usable") {
                expect(String(result.channelId)).to.equal("B");
            }
            // A's probe was genuinely in flight when B won - it only
            // settled because the win aborted it.
            expect(releaseFirstProbe).to.not.equal(undefined);

            // Probing must never arm a channel - that is what makes running
            // several at once safe. Arming happens once, later, on commit.
            expect(double.connectCalls).to.deep.equal([]);
        });
    });

    describe("default (real) rendezvous/sync implementation", function () {
        it("keeps holepunch joins and leaves balanced across a winning and a losing candidate, and attribution ignores a non-participant handshake", async function () {
            const c0: ChannelId = ethers.zeroPadValue(ethers.toBeHex(1), 32);
            const c1: ChannelId = ethers.zeroPadValue(ethers.toBeHex(2), 32);
            const status = { current: Status.NOT_OPENED };
            const nonParticipant = ethers.getAddress("0x" + "33".repeat(20));

            const double = makeSignerDouble({
                getChannelStatus: async () => status.current,
                getOnChainParticipantUnion: async (channelId) =>
                    String(channelId) === String(c1) ? [PEER1] : [],
                connectToChannel: async () => {
                    status.current = Status.OPENED;
                }
            });
            const prober = new ChannelProber({
                signer: double.signer,
                logger: createLoggerForTest(),
                events: double.events
            });

            const resultPromise = prober.probe([c0, c1]);

            // A handshake from a non-participant must not resolve any
            // candidate's rendezvous.
            double.events.emit("p2pEventHooks", "handshakeCompleted", [
                nonParticipant
            ]);
            await flush();

            // The real participant's handshake resolves c1's rendezvous.
            double.events.emit("p2pEventHooks", "handshakeCompleted", [PEER1]);
            await flush();

            // Sync is now armed on c1 via connectToChannel; confirm it by
            // advancing status to SYNCED.
            double.events.emit("p2pEventHooks", "onStatusChanged", [
                Status.OPENED,
                Status.SYNCED
            ]);

            const result = await resultPromise;
            expect(result.status).to.equal("usable");
            if (result.status === "usable") {
                expect(String(result.channelId)).to.equal(String(c1));
                expect(result.peerAddress).to.equal(PEER1);
            }
            // Probing never arms a channel, not even the winner - the
            // coordinator arms it once, later, when it commits the join.
            expect(double.connectCalls).to.deep.equal([]);
            // Every joined topic (winner and loser alike) is left again.
            expect(double.joins).to.have.length(2);
            expect(double.leaves.slice().sort()).to.deep.equal(
                double.joins.slice().sort()
            );
        });

        it("a genuine rendezvous timeout clears its timer/listener: a late non-matching handshake afterward has no effect", async function () {
            const c0: ChannelId = ethers.zeroPadValue(ethers.toBeHex(3), 32);
            const double = makeSignerDouble({
                getOnChainParticipantUnion: async () => []
            });
            const prober = new ChannelProber(
                {
                    signer: double.signer,
                    logger: createLoggerForTest(),
                    events: double.events
                },
                { concurrency: 1, timeoutMs: 10 }
            );

            const result = await prober.probe([c0]);

            expect(result.status).to.equal("exhausted");
            expect(double.joins).to.have.length(1);
            expect(double.leaves).to.have.length(1);

            // Emitting after settlement must not throw or double-resolve
            // anything - the listener was already removed on timeout.
            expect(() =>
                double.events.emit("p2pEventHooks", "handshakeCompleted", [
                    PEER0
                ])
            ).to.not.throw();
            await flush();
            expect(double.joins).to.have.length(1);
            expect(double.leaves).to.have.length(1);
        });
    });
});
