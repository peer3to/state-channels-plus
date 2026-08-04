import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { randomAddress } from "@test/factory";

/**
 * The unified event bus, end to end through the real runtime.
 *
 * One `EventBus` class exists in every realm: the worker's
 * `stateManager.events` and the main thread's `p2pInstance.events`. Producers
 * publish `{ kind, eventName, args }`; the host's bridge tap forwards every
 * emission over the port as one `busEvent` message, and the client re-emits it
 * into its own bus. Subscription is `events.on(kind, eventName, listener)` on
 * both sides. Ethers contract instances get their typed events through
 * `attachContractEvents`, which re-emits bus `contractEvents` onto the
 * instance — the same helper serves the main-thread mirror and any
 * consumer-built worker instance.
 *
 * These tests run the real runtime (SDK in a worker) and drive real blocks;
 * nothing is stubbed. Worker-side listeners are registered through
 * `execOnHost`, which executes the given function inside the worker realm.
 */
describe("EventBus (worker + main thread)", function () {
    it("delivers p2p hooks (onTurn, onBlockFinalized) to worker-side subscribers while the main-thread hook listener still fires", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const peer = h.getPeer(0);

        // Register worker-side listeners, then produce one real block from the
        // client. Resolve after both real hooks have fired.
        const pending = h.execOnHost(
            peer,
            (sm) =>
                new Promise<{
                    // two healthy onTurn listeners must both see every signal
                    firstListenerTurnCount: number;
                    secondListenerTurnCount: number;
                    // a listener that unsubscribed must never fire
                    unsubscribedListenerTurnCount: number;
                    // a second, different hook proves the bus is generic --
                    // no onBlockFinalized-specific code exists anywhere
                    blockFinalizedCount: number;
                    turnWriter: string;
                    turnAgreementTime: number;
                }>((resolve) => {
                    let firstListenerTurnCount = 0;
                    let secondListenerTurnCount = 0;
                    let unsubscribedListenerTurnCount = 0;
                    let blockFinalizedCount = 0;
                    let turnWriter = "";
                    let turnAgreementTime = 0;
                    let resolveScheduled = false;
                    const maybeResolve = () => {
                        if (
                            resolveScheduled ||
                            firstListenerTurnCount === 0 ||
                            secondListenerTurnCount === 0 ||
                            blockFinalizedCount === 0
                        ) {
                            return;
                        }
                        resolveScheduled = true;
                        queueMicrotask(() =>
                            resolve({
                                firstListenerTurnCount,
                                secondListenerTurnCount,
                                unsubscribedListenerTurnCount,
                                blockFinalizedCount,
                                turnWriter,
                                turnAgreementTime
                            })
                        );
                    };

                    // A throwing listener must be isolated: the two healthy
                    // listeners below still receive every signal.
                    sm.events.on("p2pEventHooks", "onTurn", () => {
                        throw new Error("deliberate bus listener failure");
                    });
                    sm.events.on(
                        "p2pEventHooks",
                        "onTurn",
                        (address, _turnTime, agreement) => {
                            firstListenerTurnCount += 1;
                            turnWriter = String(address);
                            turnAgreementTime = agreement;
                        }
                    );
                    sm.events.on("p2pEventHooks", "onBlockFinalized", () => {
                        blockFinalizedCount += 1;
                        maybeResolve();
                    });
                    sm.events.on("p2pEventHooks", "onTurn", () => {
                        secondListenerTurnCount += 1;
                        maybeResolve();
                    });
                    const unsubscribe = sm.events.on(
                        "p2pEventHooks",
                        "onTurn",
                        () => {
                            unsubscribedListenerTurnCount += 1;
                        }
                    );
                    unsubscribe();
                }),
            {},
            { timeoutMs: 30000 }
        );

        await h.transition.increment(1);
        const result = await pending;

        expect(result.firstListenerTurnCount).to.be.greaterThan(0);
        expect(result.secondListenerTurnCount).to.equal(
            result.firstListenerTurnCount
        );
        expect(result.unsubscribedListenerTurnCount).to.equal(0);
        // Real signal payload, not a synthetic dispatch.
        expect(result.turnWriter.length).to.be.greaterThan(0);
        expect(result.turnAgreementTime).to.be.greaterThan(0);
        // The generic-hook proof: the fully signed block fired the second hook.
        expect(result.blockFinalizedCount).to.be.greaterThan(0);
        // The bridged main-thread listener (registered by the harness through
        // p2pInstance.events) still received the turn beside the worker bus.
        expect(h.event.getEventCallCount(0, "onTurn")).to.be.greaterThan(0);
    });

    it("publishes contract events on the worker bus and delivers typed ethers events to a consumer-built worker contract", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const peer = h.getPeer(0);

        // MathStateMachine.add emits Addition(uint256 x3) and
        // Roster(address[], uint256[]). Roster is the regression shape: nested
        // ethers Results are not structured-cloneable, so args must reach
        // subscribers as deep plain values.
        const pending = h.execOnHost(
            peer,
            async (sm, _args, modules) => {
                // Record-only probe on the real signer's wrapped provider:
                // count real-chain subscription attempts without changing
                // behavior; restored on EVERY exit path below.
                const rawProvider = (
                    sm.p2pManager.p2pSigner as unknown as {
                        signer: {
                            provider: {
                                on: (
                                    event: unknown,
                                    listener: unknown
                                ) => unknown;
                            } | null;
                        };
                    }
                ).signer.provider;
                const originalRawOn = rawProvider?.on;
                let rawProviderSubscriptionCount = 0;
                if (rawProvider && originalRawOn) {
                    rawProvider.on = (event, listener) => {
                        rawProviderSubscriptionCount += 1;
                        return originalRawOn.call(rawProvider, event, listener);
                    };
                }
                try {
                    return await new Promise<{
                        additionArgCount: number;
                        rosterParticipantCount: number;
                        rosterIsPlainArray: boolean;
                        unsubscribedEventCount: number;
                        // consumer-built typed ethers instance in the worker:
                        // attachContractEvents supplies its events manually
                        typedAdditionB: number;
                        detachedDeliveryCount: number;
                        contractReadSum: number;
                        // PO1: a worker typed listener must not start a real-chain
                        // filter -- the raw provider records zero subscriptions
                        rawProviderSubscriptionCount: number;
                    }>((resolve, reject) => {
                        const { ethers } = modules;
                        const { attachContractEvents } = modules.eventBus;
                        let additionArgCount = 0;
                        let rosterParticipantCount = -1;
                        let rosterIsPlainArray = false;
                        let unsubscribedEventCount = 0;
                        let typedAdditionB = -1;
                        let detachedDeliveryCount = 0;
                        let resolveScheduled = false;

                        // The consumer story: build your own typed instance from
                        // the diamond address + ABI + the p2p signer, then attach.
                        const contract = new ethers.Contract(
                            sm.diamondStateMachine
                                .getStateMachineAddress()
                                .toString(),
                            [
                                "event Addition(uint256 a, uint256 b, uint256 result)",
                                "function getSum() view returns (uint256)"
                            ],
                            sm.p2pManager.p2pSigner
                        );
                        attachContractEvents(contract, sm.events);
                        const maybeResolve = () => {
                            if (
                                resolveScheduled ||
                                additionArgCount === 0 ||
                                rosterParticipantCount < 0 ||
                                typedAdditionB < 0
                            ) {
                                return;
                            }
                            resolveScheduled = true;
                            // Typed ethers delivery is async. One event-loop
                            // turn lets sibling mirror dispatches drain.
                            setImmediate(() => {
                                contract
                                    .getFunction("getSum")()
                                    .then((sum: bigint) =>
                                        resolve({
                                            additionArgCount,
                                            rosterParticipantCount,
                                            rosterIsPlainArray,
                                            unsubscribedEventCount,
                                            typedAdditionB,
                                            detachedDeliveryCount,
                                            contractReadSum: Number(sum),
                                            rawProviderSubscriptionCount
                                        })
                                    )
                                    .catch(reject);
                            });
                        };
                        // A second attachment detached immediately: its listener
                        // must never fire (independent detach).
                        const detachProbe = new ethers.Contract(
                            sm.diamondStateMachine
                                .getStateMachineAddress()
                                .toString(),
                            [
                                "event Addition(uint256 a, uint256 b, uint256 result)"
                            ],
                            sm.p2pManager.p2pSigner
                        );
                        const detach = attachContractEvents(
                            detachProbe,
                            sm.events
                        );
                        void detachProbe.on(
                            detachProbe.filters.Addition(),
                            () => {
                                detachedDeliveryCount += 1;
                            }
                        );
                        detach();
                        void contract.once(
                            contract.filters.Addition(),
                            (_a: bigint, b: bigint) => {
                                typedAdditionB = Number(b);
                                maybeResolve();
                            }
                        );

                        // Isolation: a throwing listener must not block the rest.
                        sm.events.onKind("contractEvents", () => {
                            throw new Error("deliberate bus listener failure");
                        });
                        sm.events.on(
                            "contractEvents",
                            "Roster",
                            (...args: unknown[]) => {
                                const participants = args[0] as string[];
                                rosterParticipantCount = participants.length;
                                rosterIsPlainArray =
                                    Array.isArray(participants) &&
                                    participants.constructor === Array;
                                maybeResolve();
                            }
                        );
                        sm.events.on(
                            "contractEvents",
                            "Addition",
                            (...args: unknown[]) => {
                                additionArgCount = args.length;
                                maybeResolve();
                            }
                        );
                        const unsubscribe = sm.events.on(
                            "contractEvents",
                            "Addition",
                            () => {
                                unsubscribedEventCount += 1;
                            }
                        );
                        unsubscribe();
                    });
                } finally {
                    if (rawProvider && originalRawOn) {
                        rawProvider.on = originalRawOn;
                    }
                }
            },
            {},
            { timeoutMs: 30000 }
        );

        await h.transition.increment(1);
        const result = await pending;

        // Addition(a, b, result) carries three arguments.
        expect(result.additionArgCount).to.equal(3);
        // Roster listed all four channel participants, as a plain Array --
        // an ethers Result here would fail the constructor check.
        expect(result.rosterParticipantCount).to.equal(4);
        expect(result.rosterIsPlainArray).to.equal(true);
        expect(result.unsubscribedEventCount).to.equal(0);
        // The typed ethers listener on the consumer-built instance fired with
        // the real event payload (add(1) -> b === 1).
        expect(result.typedAdditionB).to.equal(1);
        // The detached second attachment delivered nothing.
        expect(result.detachedDeliveryCount).to.equal(0);
        // The same instance serves reads against the local EVM (genesis sum
        // 2000 + the add(1) transition).
        expect(result.contractReadSum).to.equal(2001);
        // PO1: no real-chain filter was started for the typed subscription.
        expect(result.rawProviderSubscriptionCount).to.equal(0);
    });

    it("mirrors contract events to the main thread: typed contract listeners and the generic bus subscription both fire", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const peer = h.getPeer(0);

        // Main-thread surface 1: typed name-based filters on the mirrored
        // contract instance (what a UI would use).
        const additionMirror = new Promise<number>((resolve) => {
            void peer.contractInstance.once(
                peer.contractInstance.filters.Addition(),
                (_a: bigint, b: bigint) => resolve(Number(b))
            );
        });
        // The nested-array event must survive the port's structured clone.
        const rosterMirror = new Promise<{
            participantCount: number;
            balanceCount: number;
        }>((resolve) => {
            void peer.contractInstance.once(
                peer.contractInstance.filters.Roster(),
                (participants: string[], balances: bigint[]) =>
                    resolve({
                        participantCount: participants.length,
                        balanceCount: balances.length
                    })
            );
        });
        // Main-thread surface 2: the generic bus subscription -- the same
        // kind/eventName shape the worker-side bus serves.
        const genericMirror = new Promise<number>((resolve) => {
            const unsubscribe = peer.p2pInstance.events.on(
                "contractEvents",
                "Addition",
                (...args: unknown[]) => {
                    unsubscribe();
                    resolve(args.length);
                }
            );
        });

        await h.transition.increment(1);

        expect(await additionMirror).to.equal(1);
        const roster = await rosterMirror;
        expect(roster.participantCount).to.equal(4);
        expect(roster.balanceCount).to.equal(4);
        expect(await genericMirror).to.equal(3);
    });

    it("delivers the same eventHandler event to a worker subscriber and a main-thread subscriber", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const peer = h.getPeer(0);

        // Worker side subscribes BEFORE the trigger; the handler producer
        // lives in the worker, and the bridge carries the event to the main
        // thread.
        const workerPending = h.execOnHost(
            peer,
            (sm) =>
                new Promise<{ workerDeliveryCount: number }>((resolve) => {
                    let workerDeliveryCount = 0;
                    sm.events.on(
                        "eventHandler",
                        "onStateSnapshotUpdated",
                        () => {
                            workerDeliveryCount += 1;
                            queueMicrotask(() =>
                                resolve({ workerDeliveryCount })
                            );
                        }
                    );
                }),
            {},
            { timeoutMs: 60000 }
        );
        const mainDelivery = new Promise<number>((resolve) => {
            const unsubscribe = peer.p2pInstance.events.on(
                "eventHandler",
                "onStateSnapshotUpdated",
                () => {
                    unsubscribe();
                    resolve(1);
                }
            );
        });

        // A real trigger: posting a snapshot runs the real EventHandler.
        await h.transition.increment(1);
        await h.assert.sync.peersInSyncWait();
        await h.transition.postSnapshot();

        const workerResult = await workerPending;
        expect(workerResult.workerDeliveryCount).to.be.greaterThan(0);
        expect(await mainDelivery).to.equal(1);
    });

    it("keeps a replaced worker hook target and the main-thread bus both firing after setP2pEventHooks", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const peer = h.getPeer(1);

        // Replace the worker-local hook target; the publishing proxy is
        // stable, so the swap must not disturb bus publication or bridging.
        const pending = h.execOnHost(
            peer,
            (sm) =>
                new Promise<{
                    replacementTurnCount: number;
                    busTurnCount: number;
                }>((resolve) => {
                    let replacementTurnCount = 0;
                    let busTurnCount = 0;
                    sm.setP2pEventHooks({
                        onTurn: () => {
                            replacementTurnCount += 1;
                        }
                    });
                    sm.events.on("p2pEventHooks", "onTurn", () => {
                        busTurnCount += 1;
                        queueMicrotask(() =>
                            resolve({
                                replacementTurnCount,
                                busTurnCount
                            })
                        );
                    });
                }),
            {},
            { timeoutMs: 30000 }
        );

        await h.transition.increment(1);
        const result = await pending;

        // The replacement callback and the bus listener each saw the signal,
        // and the bridged main-thread listener still fired too.
        expect(result.replacementTurnCount).to.be.greaterThan(0);
        expect(result.busTurnCount).to.equal(result.replacementTurnCount);
        expect(h.event.getEventCallCount(1, "onTurn")).to.be.greaterThan(0);
    });

    it("surfaces a clone error to the hook producer after local delivery, and the main thread never sees the event", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const peer = h.getPeer(0);
        const fenceAddress = randomAddress();

        // Addresses delivered to the main-thread onConnection listener.
        const deliveredAddresses: unknown[] = [];
        const fenceArrived = new Promise<void>((resolve) => {
            peer.p2pInstance.events.on(
                "p2pEventHooks",
                "onConnection",
                (address) => {
                    deliveredAddresses.push(address);
                    if (address === fenceAddress) {
                        resolve();
                    }
                }
            );
        });

        const result = await h.execOnHost(
            peer,
            (sm, args) =>
                new Promise<{
                    workerDeliveries: number;
                    producerError: string;
                }>((resolve) => {
                    let workerDeliveries = 0;
                    sm.events.on("p2pEventHooks", "onConnection", () => {
                        workerDeliveries += 1;
                    });
                    // A function argument cannot structured-clone across the
                    // port. Producer policy: local bus delivery completes,
                    // then the bridge failure THROWS back to the hook caller.
                    let producerError = "";
                    try {
                        sm.p2pEventHooks.onConnection?.(
                            (() => undefined) as never,
                            true
                        );
                    } catch (error) {
                        producerError =
                            error instanceof Error
                                ? error.message
                                : String(error);
                    }
                    // A successful post through the same producer is a FIFO
                    // fence for every earlier worker post.
                    sm.p2pEventHooks.onConnection?.(
                        args.fenceAddress as never,
                        true
                    );
                    resolve({ workerDeliveries, producerError });
                }),
            { fenceAddress },
            { timeoutMs: 30000 }
        );

        expect(result.workerDeliveries).to.equal(2);
        expect(result.producerError.length).to.be.greaterThan(0);
        await fenceArrived;
        // Only the cloneable fence crossed the port.
        expect(deliveredAddresses).to.deep.equal([fenceAddress]);
    });

    it("surfaces a clone error to the real wrapped event-handler producer after the original and local delivery ran", async function () {
        this.timeout(120000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const peer = h.getPeer(0);
        const fenceAddress = randomAddress();

        // The real snapshot and the later fence must arrive. The failed
        // redelivery must add nothing between them.
        let mainDeliveries = 0;
        const fenceArrived = new Promise<void>((resolve) => {
            peer.p2pInstance.events.on(
                "eventHandler",
                "onStateSnapshotUpdated",
                (...eventArgs: unknown[]) => {
                    mainDeliveries += 1;
                    if (eventArgs[eventArgs.length - 1] === fenceAddress) {
                        resolve();
                    }
                }
            );
        });

        // One worker exec captures the REAL event args (they contain BigInts
        // and stay in the worker realm), then redelivers through the REAL
        // wrapped handler with one non-cloneable extra argument. Producer
        // policy: the original handler runs, local bus listeners run, THEN
        // the bridge clone failure surfaces to the caller.
        const pending = h.execOnHost(
            peer,
            (sm, args) =>
                new Promise<{
                    workerDeliveries: number;
                    producerError: string;
                    originalRanBeforeLocalDelivery: boolean;
                }>((resolve) => {
                    let workerDeliveries = 0;
                    let redelivered = false;
                    // Record-only probe on the original handler's FINAL
                    // awaited step (the private processStateSnapshotUpdated):
                    // proves the COMPLETE original handler resolved before
                    // the bus published locally (installed just before the
                    // redelivery; the exact saved reference is restored in
                    // finally).
                    const handlerInternals = sm.eventHandler as unknown as {
                        processStateSnapshotUpdated: (
                            ...callArgs: unknown[]
                        ) => Promise<unknown>;
                    };
                    let originalProcessSnapshot:
                        | ((...callArgs: unknown[]) => Promise<unknown>)
                        | undefined;
                    let originalCompleted = false;
                    let originalRanBeforeLocalDelivery = false;
                    const restoreProbe = () => {
                        if (originalProcessSnapshot) {
                            handlerInternals.processStateSnapshotUpdated =
                                originalProcessSnapshot;
                            originalProcessSnapshot = undefined;
                        }
                    };
                    sm.events.on(
                        "eventHandler",
                        "onStateSnapshotUpdated",
                        (...eventArgs: unknown[]) => {
                            workerDeliveries += 1;
                            if (redelivered) {
                                // The redelivery's LOCAL publication: the
                                // original handler (observed through its
                                // final snapshot-processing step) must
                                // already have run.
                                originalRanBeforeLocalDelivery =
                                    originalCompleted;
                                return;
                            }
                            redelivered = true;
                            // Redeliver asynchronously so this dispatch
                            // finishes first.
                            queueMicrotask(() => {
                                void (async () => {
                                    originalProcessSnapshot =
                                        handlerInternals.processStateSnapshotUpdated;
                                    // The flag records COMPLETION of the
                                    // handler's LAST awaited step: publication
                                    // must happen only after the WHOLE
                                    // original handler resolved — this fails
                                    // if the wrapper publishes between the
                                    // handler's internal awaits.
                                    handlerInternals.processStateSnapshotUpdated =
                                        async (...callArgs: unknown[]) => {
                                            const callResult =
                                                await originalProcessSnapshot!.apply(
                                                    sm.eventHandler,
                                                    callArgs
                                                );
                                            originalCompleted = true;
                                            return callResult;
                                        };
                                    let producerError = "";
                                    try {
                                        await (
                                            sm.eventHandler
                                                .onStateSnapshotUpdated as (
                                                ...handlerArgs: unknown[]
                                            ) => Promise<void>
                                        )(...eventArgs, () => undefined);
                                    } catch (error) {
                                        producerError =
                                            error instanceof Error
                                                ? error.message
                                                : String(error);
                                    } finally {
                                        restoreProbe();
                                    }
                                    // This cloneable call through the same
                                    // producer is a FIFO fence for the failed
                                    // redelivery.
                                    await (
                                        sm.eventHandler
                                            .onStateSnapshotUpdated as (
                                            ...handlerArgs: unknown[]
                                        ) => Promise<void>
                                    )(...eventArgs, args.fenceAddress);
                                    resolve({
                                        workerDeliveries,
                                        producerError,
                                        originalRanBeforeLocalDelivery
                                    });
                                })();
                            });
                        }
                    );
                }),
            { fenceAddress },
            { timeoutMs: 60000 }
        );

        await h.transition.increment(1);
        await h.assert.sync.peersInSyncWait();
        await h.transition.postSnapshot();
        const result = await pending;

        // Three worker deliveries (the real event, the failed redelivery's
        // local emit, and the fence), the clone failure surfaced to
        // the producer, and the probe on the handler's final
        // snapshot-processing step recorded the ORIGINAL resolving before the
        // local publication — this fails if emit() ever moves ahead of (or
        // between) the original's awaited steps.
        expect(result.workerDeliveries).to.equal(3);
        expect(result.originalRanBeforeLocalDelivery).to.equal(true);
        expect(result.producerError.length).to.be.greaterThan(0);
        await fenceArrived;
        // Only the real event and the fence reached the main thread.
        expect(mainDeliveries).to.equal(2);
    });

    it("delivers nothing to the client after runtime disposal", async function () {
        this.timeout(90000);
        // A standalone harness: this case disposes a live client, which the
        // shared session's quiesce would report as a host error.
        const standalone = new PeerTestHarness({
            deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT
        });
        try {
            await standalone.lifecycle.start(2, 0);
            const peer = standalone.getPeer(0);
            let mainDeliveries = 0;
            peer.p2pInstance.events.on("p2pEventHooks", "onConnection", () => {
                mainDeliveries += 1;
            });

            // Arm a delayed worker-side hook emission, then dispose the
            // client BEFORE it fires. Whether the worker is already
            // terminated or posts into the closed port (a silent drop on
            // Node), the client must receive nothing.
            await standalone.execOnHost(
                peer,
                (sm) => {
                    setTimeout(() => {
                        sm.p2pEventHooks.onConnection?.(
                            "0x1111111111111111111111111111111111111111" as never,
                            true
                        );
                    }, 800);
                    return true;
                },
                {},
                { timeoutMs: 30000 }
            );
            await peer.p2pInstance.dispose();
            await new Promise((resolve) => setTimeout(resolve, 1500));

            expect(mainDeliveries).to.equal(0);
        } finally {
            await standalone.cleanup();
        }
    });

    it("disposes the custom RPC root before runtime teardown", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);

        const result = await h.execOnHost(
            h.getPeer(1),
            async (sm) => {
                const root = sm.p2pManager.localRpc;
                const originalDispose = root.dispose.bind(root);
                let connectionsAtRootDispose = -1;
                root.dispose = async () => {
                    connectionsAtRootDispose =
                        sm.p2pManager.getConnectedPeers().size;
                    await originalDispose();
                };
                await sm.dispose();
                return {
                    connectionsAtRootDispose,
                    connectionsAfter: sm.p2pManager.getConnectedPeers().size
                };
            },
            {},
            { timeoutMs: 30000 }
        );

        // The root ran while the p2p layer was still alive; teardown followed.
        expect(result.connectionsAtRootDispose).to.be.greaterThan(0);
        expect(result.connectionsAfter).to.equal(0);
    });

    it("still tears the runtime down when the custom root dispose rejects", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        // A real custom root whose dispose() rejects, loaded through the
        // normal manifest path -- no behavior patching on live collaborators.
        await h.lifecycle.start(4, 0, {
            customRpcManifest: {
                module: `${__dirname}/../fixtures/customRpc/RejectingDisposeRpcManifest.ts`,
                exportName: "RejectingDisposeRpc"
            }
        });

        const result = await h.execOnHost(
            h.getPeer(2),
            async (sm) => {
                let message = "";
                try {
                    await sm.dispose();
                } catch (error) {
                    message =
                        error instanceof Error ? error.message : String(error);
                }
                return {
                    message,
                    connectionsAfter: sm.p2pManager.getConnectedPeers().size
                };
            },
            {},
            { timeoutMs: 30000 }
        );

        // The rejection surfaced, and only after the runtime was torn down.
        expect(result.message).to.equal("root dispose boom");
        expect(result.connectionsAfter).to.equal(0);
    });
});
