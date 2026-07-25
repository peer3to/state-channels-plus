import { expect } from "chai";
import { MathTestSession as TestSession, sleep } from "@test/harness";
import * as factory from "@test/factory";
import Storage from "@/storage";
import { InMemoryPersistencePort } from "@/storage/persistence/InMemoryPersistencePort";
import {
    NamespacedOp,
    PersistencePort,
    PersistRecord
} from "@/storage/persistence/PersistencePort";

/**
 * Runtime persistence wiring.
 *
 * Persistence binds LAZILY at channel-connect time (channelId does not exist at
 * buildRuntime): the host constructs Storage on the default in-memory port with
 * no hydrate, then — in the connectToChannel / setChannelId handlers, once the
 * channelId is known — attaches the real `@platform/persistence` port for
 * `namespaceRoot=${chainId}:${channelId}` and awaits hydrate STRICTLY BEFORE the
 * transport/topic join. That ordering is the crash-consistency guarantee, and
 * the durability watchdog's `onFatal` is the terminal fail-stop for the
 * sign-before-durable slashing vector.
 *
 * Covered here:
 *  - attach-on-a-shared-port + hydrate restores durable state (late-bind proof);
 *  - the connectToChannel host handler runs attach+hydrate before the transport
 *    join, with the composite namespace (single harness session — the sandbox
 *    can't stand up a second full session per file);
 *  - a repeat channel-bind is idempotent (no re-attach / no shadow re-clear);
 *  - the watchdog fires onFatal at the liveness deadline;
 *  - dispose() stops the engine's background timers.
 */

/** A port whose commit never succeeds, so the barrier stays pending and the
 * engine degrades (arming the retry + watchdog timers). */
class FaultyPersistencePort implements PersistencePort {
    commit(_ops: NamespacedOp[]): Promise<void> {
        return Promise.reject(new Error("injected commit failure"));
    }
    // eslint-disable-next-line require-yield
    async *load(_namespace: string): AsyncIterable<PersistRecord> {
        return;
    }
    async prune(): Promise<void> {
        return;
    }
}

describe("E2E: runtime persistence wiring", function () {
    it("attach on a shared port then hydrate restores stored blocks", async function () {
        // Late-bind proof at the Storage/engine level, reusing ONE
        // InMemoryPersistencePort across the "restart". The port carries
        // OPAQUE_CLONE, so attachPersistence passes it into the fresh Storage BY
        // REFERENCE (uncloned) through the deepCopyProxy - the same live
        // instance the writer committed to, exactly as the real fs/IndexedDB
        // ports are reopened after a process restart.
        const sharedPort = new InMemoryPersistencePort();

        const writer = new Storage({ port: sharedPort });
        const block = factory.block();
        const blockHash = block.hash;
        writer.blocks.storeBlock(block);
        // Flush to the shared port and wait until it is durable.
        await writer.awaitDurable();
        await writer.dispose();

        // A fresh Storage on the default in-memory port has nothing yet.
        const restarted = new Storage();
        expect(
            restarted.blocks.getBlock(blockHash),
            "fresh Storage starts empty"
        ).to.be.undefined;

        // Late-bind the shared durable port, then hydrate: the block reappears.
        restarted.attachPersistence(sharedPort);
        await restarted.hydrate();

        expect(
            restarted.blocks.getBlock(blockHash),
            "late-bound port + hydrate restores the durable block"
        ).to.not.be.undefined;
        await restarted.dispose();
    });

    it("watchdog onFatal tears down the worker at the liveness deadline", async function () {
        // The exact composed behavior the host relies on: a persistently
        // failing commit degrades the engine, and at the liveness deadline
        // (livenessDeadlineFraction 0.5 of timeoutWindowMs) the watchdog fires
        // onFatal. The host's onFatal posts the `hostError` teardown message and
        // disposes the runtime; here onFatal builds that same teardown payload
        // and we assert it was produced.
        let posted: { type: string; error: unknown } | undefined;
        const storage = new Storage({
            port: new FaultyPersistencePort(),
            timeoutWindowMs: 200, // deadline = 100ms
            onFatal: (err) => {
                posted = { type: "hostError", error: err };
            }
        });

        // A pending write gives the flush an op to commit (and fail on). The
        // barrier never resolves on a failing port, so we don't await it.
        storage.blocks.storeBlock(factory.block());
        void storage.awaitDurable();

        await sleep(500);
        expect(posted, "onFatal must fire at the liveness deadline").to.not.be
            .undefined;
        expect(posted!.type).to.equal("hostError");
        await storage.dispose();
    });

    it("dispose stops engine timers", async function () {
        // dispose() must clear the watchdog (and retry) timers so nothing pins
        // the worker after teardown: disposing BEFORE the deadline means onFatal
        // never fires even long past it.
        let fatalCount = 0;
        const storage = new Storage({
            port: new FaultyPersistencePort(),
            timeoutWindowMs: 400, // deadline = 200ms
            onFatal: () => {
                fatalCount += 1;
            }
        });

        storage.blocks.storeBlock(factory.block());
        void storage.awaitDurable(); // arms the retry + watchdog timers
        await sleep(50); // well before the 200ms deadline

        await storage.dispose();
        await sleep(500); // well past the original deadline

        expect(
            fatalCount,
            "dispose must clear the watchdog timer before it can fire"
        ).to.equal(0);
    });

    // Ordering and idempotency share ONE harness session: this sandbox cannot
    // stand up a second full session per file, so both named behaviours —
    // 'attach+hydrate run before the transport join on connectToChannel' and
    // 'repeat channel-bind is idempotent and does not drop durable state' — are
    // asserted within this single session (as the durability-barrier e2e does).
    it("attach+hydrate run before the transport join on connectToChannel; repeat channel-bind is idempotent and does not drop durable state", async function () {
        this.timeout(120000);

        const h = TestSession.getHarness();
        // Bring peers up WITHOUT opening a channel, so we can instrument the
        // hosts BEFORE the first channel bind (which happens in openChannel).
        await h.setup(2);

        // Record, per peer host, the order of: durable-port attach, hydrate,
        // stateManager.setChannelId (event-listener wiring) and the transport
        // topic join. Keyed by signer address (inline mode shares one process /
        // globalThis across peers).
        for (const peer of h.peers) {
            await h.execOnHost(peer, (sm) => {
                const g = globalThis as unknown as {
                    __persistOrder?: Record<
                        string,
                        { events: string[]; namespace?: string }
                    >;
                };
                g.__persistOrder = g.__persistOrder ?? {};
                const rec: { events: string[]; namespace?: string } = {
                    events: []
                };
                g.__persistOrder[String(sm.signerAddress)] = rec;

                const storage = sm.storage;
                const origAttach = storage.attachPersistence.bind(storage);
                storage.attachPersistence = (port) => {
                    rec.events.push("attach");
                    rec.namespace = (
                        port as { namespaceRoot?: string }
                    ).namespaceRoot;
                    return origAttach(port);
                };
                const origHydrate = storage.hydrate.bind(storage);
                storage.hydrate = () => {
                    rec.events.push("hydrate");
                    return origHydrate();
                };

                const origSetChannelId = sm.setChannelId.bind(sm);
                sm.setChannelId = (channelId) => {
                    rec.events.push("setChannelId");
                    return origSetChannelId(channelId);
                };

                const p2p = sm.p2pManager;
                const origJoin = p2p.tryOpenConnectionToChannel.bind(p2p);
                p2p.tryOpenConnectionToChannel = (channelId) => {
                    rec.events.push("join");
                    return origJoin(channelId);
                };
                return true;
            });
        }

        // First channel bind: openChannel drives connectToChannel on every peer.
        const forkId = await h.lifecycle.openChannel();

        const chainId = (await h.peers[0].signer.provider!.getNetwork())
            .chainId;
        const expectedNamespace = `${chainId}:${String(h.channelId)}`;

        for (const peer of h.peers) {
            const rec = await h.execOnHost(peer, (sm) => {
                const g = globalThis as unknown as {
                    __persistOrder?: Record<
                        string,
                        { events: string[]; namespace?: string }
                    >;
                };
                return (
                    g.__persistOrder?.[String(sm.signerAddress)] ?? {
                        events: [] as string[],
                        namespace: undefined as string | undefined
                    }
                );
            });

            const attachIdx = rec.events.indexOf("attach");
            const hydrateIdx = rec.events.indexOf("hydrate");
            const setIdx = rec.events.indexOf("setChannelId");
            const joinIdx = rec.events.indexOf("join");

            expect(attachIdx, "attach must run").to.be.greaterThanOrEqual(0);
            expect(hydrateIdx, "hydrate must run").to.be.greaterThanOrEqual(0);
            expect(joinIdx, "transport join must run").to.be.greaterThanOrEqual(
                0
            );
            // attach -> hydrate -> (event-listener wiring, transport join).
            expect(attachIdx, "attach must precede hydrate").to.be.lessThan(
                hydrateIdx
            );
            expect(
                hydrateIdx,
                "hydrate must complete before the transport join"
            ).to.be.lessThan(joinIdx);
            if (setIdx >= 0) {
                expect(
                    hydrateIdx,
                    "hydrate must complete before setChannelId wires the event listener"
                ).to.be.lessThan(setIdx);
            }
            // The host composed the approved (chainId, channelId) namespace.
            expect(rec.namespace).to.equal(expectedNamespace);
        }

        // ---- idempotency: a repeat bind for the same channelId is a no-op ----
        const peer0 = h.getPeer(0);

        const countAttaches = (sm: { signerAddress: unknown }) => {
            const g = globalThis as unknown as {
                __persistOrder?: Record<string, { events: string[] }>;
            };
            const events =
                g.__persistOrder?.[String(sm.signerAddress)]?.events ?? [];
            return events.filter((e) => e === "attach").length;
        };

        const attachesBefore = await h.execOnHost(peer0, countAttaches);
        expect(
            attachesBefore,
            "channel bound exactly once at connect"
        ).to.equal(1);

        // Produce real durable state AFTER the first bind, then repeat the bind
        // and assert the block still present (the literal 'durable state
        // survives' criterion).
        await h.transition.advanceState({ count: 1 });
        const storedBlockHash = await h.execOnHost(
            peer0,
            (sm, args) => {
                const block = sm.storage.blocks.getLatestBlock(args.forkId);
                return block ? String(block.hash) : undefined;
            },
            { forkId }
        );
        expect(
            storedBlockHash,
            "a block was durably stored after the first bind"
        ).to.not.be.undefined;

        // Repeat bind via the OTHER handler (connect bound it; setChannelId
        // repeats) to exercise the cross-handler guard for the SAME channelId.
        await peer0.p2pInstance.p2pSigner.setChannelId(h.channelId);

        const attachesAfter = await h.execOnHost(peer0, countAttaches);
        expect(
            attachesAfter,
            "repeat channel-bind must not re-attach the durable port"
        ).to.equal(1);
        const blockStillPresent = await h.execOnHost(
            peer0,
            (sm, args) => sm.storage.blocks.getBlock(args.hash) !== undefined,
            { hash: storedBlockHash as string }
        );
        expect(
            blockStillPresent,
            "durable block survives the repeat channel-bind"
        ).to.equal(true);

        // ---- fail-stop: a DIFFERENT channelId on the same worker rejects ----
        // Binding channel B onto channel A's namespace is an isolation
        // violation: the bind throws and the p2pSigner delegate (setChannelId)
        // must not run.
        const countSetChannelId = (sm: { signerAddress: unknown }) => {
            const g = globalThis as unknown as {
                __persistOrder?: Record<string, { events: string[] }>;
            };
            const events =
                g.__persistOrder?.[String(sm.signerAddress)]?.events ?? [];
            return events.filter((e) => e === "setChannelId").length;
        };
        const setCallsBefore = await h.execOnHost(peer0, countSetChannelId);

        let mismatchRejected = false;
        try {
            await peer0.p2pInstance.p2pSigner.setChannelId(
                `different-channel-${Date.now()}`
            );
        } catch {
            mismatchRejected = true;
        }
        expect(
            mismatchRejected,
            "a different-channelId bind must fail-stop"
        ).to.equal(true);

        const setCallsAfter = await h.execOnHost(peer0, countSetChannelId);
        expect(
            setCallsAfter,
            "p2pSigner delegate must not run on a channelId mismatch"
        ).to.equal(setCallsBefore);
    });
});
