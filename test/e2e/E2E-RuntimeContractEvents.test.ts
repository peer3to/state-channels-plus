import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

/**
 * A contract event emitted by the host EVM must reach a subscriber on the
 * main-thread contract. The host parses the event, forwards { name, args } over
 * the runtime port, and P2pRuntimeClient.dispatchContractEvent re-emits it on
 * the main-thread contract — whose runner is the provider-less ClientP2pSigner.
 *
 * Regression guard for the NoopEventProvider fix: without an event-capable
 * runner, ethers rejects the `contract.on(...)` subscription ("contract runner
 * does not support subscribing"), so the forwarded event would reach no
 * listener.
 *
 * Uses the real harness end to end: a real MathStateMachine emits a real
 * Addition event from a real add() transition, forwarded across the real
 * runtime port — not a hand-crafted { type: "contractEvent" } message on a fake
 * port. Exercising the real port also covers the serialization step the fake
 * test skipped (worker mode crosses structured clone).
 */
describe("E2E: Runtime contract events", function () {
    it("delivers a real Addition event to a main-thread .on subscriber over the runtime port", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2);

        const contract = h.peers[0].contractInstance;

        const received: Array<[bigint, bigint, bigint]> = [];
        // Subscribe exactly like the app: through the main-thread contract whose
        // runner is the provider-less ClientP2pSigner. The listener itself
        // signals arrival — no need to poll `received` afterwards.
        let onReceived: () => void;
        const receivedEvent = new Promise<void>((resolve) => {
            onReceived = resolve;
        });
        await contract.on(
            contract.filters.Addition(),
            (a: bigint, b: bigint, result: bigint) => {
                received.push([a, b, result]);
                onReceived();
            }
        );

        // A real transition: a peer executes add(1), so MathStateMachine emits
        // Addition(previousSum, 1, previousSum + 1). Every peer's host EVM parses
        // the log and forwards it over its own runtime port.
        await h.transition.advanceState({ count: 1 });

        await Promise.race([
            receivedEvent,
            new Promise<never>((_, reject) =>
                setTimeout(
                    () =>
                        reject(
                            new Error("timed out waiting for Addition event")
                        ),
                    15_000
                )
            )
        ]);

        expect(received).to.have.lengthOf(1);
        const [a, b, result] = received[0];
        expect(b).to.equal(1n); // the added number
        expect(result).to.equal(a + b); // real Math semantics, not a canned value
    });
});
