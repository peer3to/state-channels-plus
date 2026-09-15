import { assertRuntimeContractEvent } from "@test/fixtures/RuntimePlacementWorkflowFixture";

/**
 * A contract event emitted by the host EVM must reach a subscriber on the
 * main-thread contract. The host publishes the parsed event on the worker bus,
 * the bridge tap forwards it as one `busEvent` message, and the client's
 * `attachContractEvents` mirror re-emits it on the main-thread contract —
 * whose runner is the provider-less ClientP2pSigner.
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
        await assertRuntimeContractEvent();
    });
    it("delivers a real Addition event from an SDK worker", async function () {
        await assertRuntimeContractEvent(true);
    });
});
