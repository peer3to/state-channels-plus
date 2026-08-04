import { expect } from "chai";
import { attachContractEvents, EventBus } from "@/events/EventBus";
import {
    ADDITION_EVENT_ABI as ADDITION_ABI,
    createEventContract as createContract,
    EVENT_FIXTURE_ADDRESS as ADDRESS
} from "@test/fixtures/eventFixtures";

// Real onTurn argument shape: (address, p2pTime, agreementTime,
// chainFallbackTime, turnStartedAtBlockTimestamp).
const TURN_ARGS = [ADDRESS, 3, 3, 3, 1_700_000_000];

describe("EventBus (component)", function () {
    it("delivers named events per kind and keeps the same name isolated across kinds", function () {
        const bus = new EventBus();
        const received: string[] = [];
        bus.on("p2pEventHooks", "onTurn", (address) => {
            received.push(`hook:${String(address)}`);
        });
        bus.on("contractEvents", "onTurn", (...args) => {
            received.push(`contract:${String(args[0])}`);
        });

        bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);

        // Only the p2pEventHooks subscriber saw it; the contractEvents
        // subscriber with the SAME event name did not.
        expect(received).to.deep.equal([`hook:${ADDRESS}`]);
    });

    it("clear() removes consumer subscriptions but keeps runtime wiring (bridge tap and attached mirrors)", async function () {
        const bus = new EventBus();
        const bridged: string[] = [];
        bus.setBridgeTap((kind, eventName) => {
            bridged.push(`${kind}:${eventName}`);
        });
        const mirror = createContract(ADDITION_ABI);
        const mirrored: number[] = [];
        await mirror.on(mirror.filters.Addition(), (_a: bigint, b: bigint) => {
            mirrored.push(Number(b));
        });
        attachContractEvents(mirror, bus, undefined, { runtimeOwned: true });
        let consumerCalls = 0;
        bus.on("contractEvents", "Addition", () => {
            consumerCalls += 1;
        });

        // A public kind-wide consumer subscription must clear too.
        let kindWideConsumerCalls = 0;
        bus.onKind("contractEvents", () => {
            kindWideConsumerCalls += 1;
        });

        bus.clear();
        bus.emit("contractEvents", "Addition", [1n, 4n, 5n]);
        await new Promise((resolve) => setImmediate(resolve));

        // Consumer subscriptions (named AND kind-wide) are gone; the
        // runtime-owned mirror and the port bridge still deliver — clear()
        // must never sever those.
        expect(consumerCalls).to.equal(0);
        expect(kindWideConsumerCalls).to.equal(0);
        expect(mirrored).to.deep.equal([4]);
        expect(bridged).to.deep.equal(["contractEvents:Addition"]);
    });

    it("routes a failed mirror emit to the bus error reporter when no callback is passed (the production attachment shape)", async function () {
        const reported: string[] = [];
        const bus = new EventBus((kind, eventName, error) =>
            reported.push(
                `${kind}:${eventName}:${error instanceof Error ? "err" : "?"}`
            )
        );
        const ambiguous = createContract([
            "event Dup(uint256 value)",
            "event Dup(address account)"
        ]);
        // No test callback: exactly how the runtime client and worker
        // consumers attach.
        attachContractEvents(ambiguous, bus);

        let detachedRejection: unknown;
        const onUnhandled = (reason: unknown) => {
            detachedRejection = reason;
        };
        process.once("unhandledRejection", onUnhandled);
        try {
            bus.emit("contractEvents", "Dup", [1n]);
            await new Promise((resolve) => setTimeout(resolve, 20));
        } finally {
            process.removeListener("unhandledRejection", onUnhandled);
        }

        expect(reported).to.deep.equal(["contractEvents:Dup:err"]);
        expect(detachedRejection).to.equal(undefined);
    });

    it("supports several listeners, unsubscribe, and clear", function () {
        const bus = new EventBus();
        let first = 0;
        let second = 0;
        let removed = 0;
        bus.on("p2pEventHooks", "onTurn", () => {
            first += 1;
        });
        bus.on("p2pEventHooks", "onTurn", () => {
            second += 1;
        });
        const unsubscribe = bus.on("p2pEventHooks", "onTurn", () => {
            removed += 1;
        });
        unsubscribe();

        bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);
        expect([first, second, removed]).to.deep.equal([1, 1, 0]);

        bus.clear();
        bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);
        // clear() removed the named consumer listeners.
        expect([first, second]).to.deep.equal([1, 1]);
    });

    it("keeps a re-registered listener when an unsubscribe from before clear() runs late", function () {
        const bus = new EventBus();
        let namedCalls = 0;
        let kindCalls = 0;
        const listener = () => {
            namedCalls += 1;
        };
        const kindListener = () => {
            kindCalls += 1;
        };
        const staleNamedUnsubscribe = bus.on(
            "p2pEventHooks",
            "onTurn",
            listener
        );
        const staleKindUnsubscribe = bus.onKind("p2pEventHooks", kindListener);
        bus.clear();
        // Same functions registered again AFTER the clear; the stale
        // unsubscribers hold the old sets and must not touch these.
        bus.on("p2pEventHooks", "onTurn", listener);
        bus.onKind("p2pEventHooks", kindListener);
        staleNamedUnsubscribe();
        staleKindUnsubscribe();

        bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);
        expect(namedCalls).to.equal(1);
        expect(kindCalls).to.equal(1);
    });

    it("isolates a throwing listener and reports it through the error callback", function () {
        const errors: string[] = [];
        const bus = new EventBus((kind, eventName, error) =>
            errors.push(
                `${kind}:${eventName}:${error instanceof Error ? error.message : String(error)}`
            )
        );
        let delivered = 0;
        bus.on("p2pEventHooks", "onTurn", () => {
            throw new Error("boom");
        });
        bus.on("p2pEventHooks", "onTurn", () => {
            delivered += 1;
        });

        bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);

        expect(delivered).to.equal(1);
        expect(errors).to.deep.equal(["p2pEventHooks:onTurn:boom"]);
    });

    it("tolerates listeners added or removed during an emit", function () {
        const bus = new EventBus();
        let lateListenerCalls = 0;
        let stableCalls = 0;
        const removeMe = bus.on("p2pEventHooks", "onTurn", () => {
            // removing another listener mid-dispatch must not break iteration
            removeMe();
        });
        bus.on("p2pEventHooks", "onTurn", () => {
            stableCalls += 1;
            bus.on("p2pEventHooks", "onTurn", () => {
                lateListenerCalls += 1;
            });
        });

        bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);
        // The listener added during dispatch does not run for the emit that
        // added it (dispatch iterates a snapshot).
        expect(stableCalls).to.equal(1);
        expect(lateListenerCalls).to.equal(0);

        bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);
        expect(lateListenerCalls).to.be.greaterThan(0);
    });

    it("runs kind-wide listeners after named ones and the bridge tap last, propagating only the bridge error after all local sinks ran", function () {
        const bus = new EventBus();
        const order: string[] = [];
        bus.on("p2pEventHooks", "onTurn", () => {
            order.push("named");
        });
        bus.onKind("p2pEventHooks", (eventName) => {
            order.push(`kind:${eventName}`);
        });
        bus.setBridgeTap(() => {
            order.push("bridge");
            throw new Error("clone failed");
        });

        let thrown = "";
        try {
            bus.emit("p2pEventHooks", "onTurn", TURN_ARGS);
        } catch (error) {
            thrown = error instanceof Error ? error.message : String(error);
        }

        // Every local sink ran before the bridge error surfaced.
        expect(order).to.deep.equal(["named", "kind:onTurn", "bridge"]);
        expect(thrown).to.equal("clone failed");
    });

    it("re-emits bus contract events onto an attached ethers instance and stops after detach", async function () {
        const bus = new EventBus();
        const contract = createContract(ADDITION_ABI);
        const second = createContract(ADDITION_ABI);
        const received: number[] = [];
        const secondReceived: number[] = [];
        await contract.on(
            contract.filters.Addition(),
            (_a: bigint, b: bigint) => {
                received.push(Number(b));
            }
        );
        await second.on(second.filters.Addition(), (_a: bigint, b: bigint) => {
            secondReceived.push(Number(b));
        });
        attachContractEvents(contract, bus);
        const detachSecond = attachContractEvents(second, bus);

        bus.emit("contractEvents", "Addition", [1n, 2n, 3n]);
        // ethers dispatches emits asynchronously
        await new Promise((resolve) => setImmediate(resolve));
        expect(received).to.deep.equal([2]);
        expect(secondReceived).to.deep.equal([2]);

        // Independent detach: the first attachment keeps delivering.
        detachSecond();
        bus.emit("contractEvents", "Addition", [1n, 5n, 6n]);
        await new Promise((resolve) => setImmediate(resolve));
        expect(received).to.deep.equal([2, 5]);
        expect(secondReceived).to.deep.equal([2]);
    });

    it("skips events outside the attached contract's ABI without a rejection", async function () {
        const bus = new EventBus();
        const partialAbiContract = createContract(ADDITION_ABI);
        const received: number[] = [];
        await partialAbiContract.on(
            partialAbiContract.filters.Addition(),
            (_a: bigint, b: bigint) => {
                received.push(Number(b));
            }
        );
        attachContractEvents(partialAbiContract, bus);

        let detachedRejection: unknown;
        const onUnhandled = (reason: unknown) => {
            detachedRejection = reason;
        };
        process.once("unhandledRejection", onUnhandled);
        try {
            // Roster is not in this contract's ABI: it must be skipped, and
            // the Addition after it must still deliver.
            bus.emit("contractEvents", "Roster", [[ADDRESS], [1n]]);
            bus.emit("contractEvents", "Addition", [1n, 7n, 8n]);
            await new Promise((resolve) => setTimeout(resolve, 20));
        } finally {
            process.removeListener("unhandledRejection", onUnhandled);
        }

        expect(received).to.deep.equal([7]);
        expect(detachedRejection).to.equal(undefined);
    });

    it("routes a rejected contract emit to the attach error callback instead of a detached rejection", async function () {
        const bus = new EventBus();
        // Two events with the same name: hasEvent("Dup") passes, but emit
        // cannot resolve the ambiguous fragment and rejects.
        const ambiguous = createContract([
            "event Dup(uint256 value)",
            "event Dup(address account)"
        ]);
        const attachErrors: string[] = [];
        attachContractEvents(ambiguous, bus, (eventName, error) =>
            attachErrors.push(
                `${eventName}:${error instanceof Error ? error.message.slice(0, 20) : String(error)}`
            )
        );

        let detachedRejection: unknown;
        const onUnhandled = (reason: unknown) => {
            detachedRejection = reason;
        };
        process.once("unhandledRejection", onUnhandled);
        try {
            bus.emit("contractEvents", "Dup", [1n]);
            await new Promise((resolve) => setTimeout(resolve, 20));
        } finally {
            process.removeListener("unhandledRejection", onUnhandled);
        }

        expect(attachErrors).to.have.length(1);
        expect(attachErrors[0].startsWith("Dup:")).to.equal(true);
        expect(detachedRejection).to.equal(undefined);
    });

    it("still delivers to a contract attached after the bridge tap even when the bridge fails", async function () {
        const bus = new EventBus();
        bus.setBridgeTap(() => {
            throw new Error("clone failed");
        });
        // Attached AFTER the bridge was installed — kind-wide listeners are a
        // separate phase that always runs before the bridge tap.
        const contract = createContract(ADDITION_ABI);
        const received: number[] = [];
        await contract.on(
            contract.filters.Addition(),
            (_a: bigint, b: bigint) => {
                received.push(Number(b));
            }
        );
        attachContractEvents(contract, bus);

        let thrown = "";
        try {
            bus.emit("contractEvents", "Addition", [1n, 9n, 10n]);
        } catch (error) {
            thrown = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolve) => setImmediate(resolve));

        expect(received).to.deep.equal([9]);
        expect(thrown).to.equal("clone failed");
    });
});
