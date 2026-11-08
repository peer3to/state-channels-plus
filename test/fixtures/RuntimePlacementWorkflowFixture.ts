// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { wallSeconds } from "./ExecutorTimestamp.fixture";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import type { MathPeerTestHarness } from "test-harness";

export async function assertRuntimeTwoPeerTransition(
    harness: MathPeerTestHarness
): Promise<void> {
    const additions: Array<Array<[bigint, bigint, bigint]>> = [[], []];
    const rosters: Array<
        Array<{ participants: string[]; balances: bigint[] }>
    > = [[], []];
    const effectReads: Array<Promise<bigint>> = [];
    const before = await harness.getPeer(0).contractInstance.getSum();
    for (const [index, peer] of harness.peers.entries()) {
        await peer.contractInstance.on(
            peer.contractInstance.filters.Addition(),
            (left: bigint, right: bigint, result: bigint) => {
                additions[index].push([left, right, result]);
                effectReads.push(peer.contractInstance.getSum());
            }
        );
        await peer.contractInstance.on(
            peer.contractInstance.filters.Roster(),
            (participants: string[], balances: bigint[]) => {
                rosters[index].push({
                    participants: [...participants],
                    balances: [...balances]
                });
            }
        );
    }
    await harness.transition.advanceState({ count: 1 });
    await waitFor(
        () =>
            additions.every((events) => events.length === 1) &&
            rosters.every((events) => events.length === 1),
        harness.event.protocolEventTimeoutMs()
    );
    const states = await Promise.all(
        harness.peers.map((peer) => peer.contractInstance.getState())
    );
    expect(states[0]).to.equal(states[1]);
    expect(await harness.getPeer(0).contractInstance.getSum()).to.equal(
        before + 1n
    );
    expect(await harness.getPeer(1).contractInstance.getSum()).to.equal(
        before + 1n
    );
    expect(additions).to.deep.equal([
        [[before, 1n, before + 1n]],
        [[before, 1n, before + 1n]]
    ]);
    expect(rosters[0]).to.deep.equal(rosters[1]);
    expect(rosters[0][0].participants).to.deep.equal(
        harness.peers.map((peer) => peer.address)
    );
    expect(rosters[0][0].balances.length).to.equal(2);
    expect(await Promise.all(effectReads)).to.deep.equal([
        before + 1n,
        before + 1n
    ]);
}

export async function assertRuntimeContractEvent(
    runSdkInThread?: boolean
): Promise<void> {
    const h = TestSession.getHarness();
    await h.lifecycle.start(
        2,
        0,
        runSdkInThread === undefined
            ? undefined
            : { configOverrides: { RUN_SDK_IN_THREAD: runSdkInThread } }
    );

    const contract = h.peers[0].contractInstance;

    const received: Array<[bigint, bigint, bigint]> = [];
    // Subscribe exactly like the app: through the main-thread contract whose
    // runner is the provider-less ClientP2pSigner.
    await contract.on(
        contract.filters.Addition(),
        (a: bigint, b: bigint, result: bigint) => {
            received.push([a, b, result]);
        }
    );

    // A real transition: a peer executes add(1), so MathStateMachine emits
    // Addition(previousSum, 1, previousSum + 1). Every peer's host EVM parses
    // the log and forwards it over its own runtime port.
    await h.transition.advanceState({ count: 1 });

    await waitFor(() => received.length >= 1, h.event.protocolEventTimeoutMs());

    expect(received).to.have.lengthOf(1);
    const [a, b, result] = received[0];
    expect(b).to.equal(1n); // the added number
    expect(result).to.equal(a + b); // real Math semantics, not a canned value
}

/** Runtime clock offset for the onTurn test, below the height-0 timestamp window. */
const TURN_CLOCK_OFFSET_SECONDS = 8;

/**
 * Every runtime's Clock runs `TURN_CLOCK_OFFSET_SECONDS` ahead of the wall
 * clock, so a `currentTimestamp` read from the wall clock fails the oracle.
 */
export async function assertRuntimeTurnClock(
    runSdkInThread?: boolean
): Promise<void> {
    const h = TestSession.getHarness();
    await h.lifecycle.start(
        2,
        0,
        runSdkInThread === undefined
            ? undefined
            : { configOverrides: { RUN_SDK_IN_THREAD: runSdkInThread } }
    );
    const query = h.control(h.peers[0]).query;
    const baselineOffset =
        (await query.getClockTimeInSeconds().request()) - wallSeconds();
    // Each worker has its own Clock; inline peers share one.
    await Promise.all(
        h.peers.map((peer) =>
            h
                .control(peer)
                .stub.holdClockOffset(TURN_CLOCK_OFFSET_SECONDS)
                .request()
        )
    );
    try {
        const runtimeOffset =
            (await query.getClockTimeInSeconds().request()) - wallSeconds();
        // Each offset sample rounds to whole seconds on two clocks.
        expect(runtimeOffset - baselineOffset).to.be.within(
            TURN_CLOCK_OFFSET_SECONDS - 2,
            TURN_CLOCK_OFFSET_SECONDS + 2
        );

        const turns: Array<{
            turnTime: number;
            startedAt?: number;
            currentTimestamp?: number;
            wallTimestamp: number;
        }> = [];
        // Subscribe like the app: on the main-thread runtime events, across the port.
        h.peers[0].p2pInstance.events.on(
            "p2pEventHooks",
            "onTurn",
            (
                _address,
                turnTime,
                _agreement,
                _fallback,
                startedAt,
                currentTimestamp
            ) => {
                turns.push({
                    turnTime,
                    startedAt,
                    currentTimestamp,
                    wallTimestamp: wallSeconds()
                });
            }
        );

        await h.transition.advanceState({ count: 2 });
        await waitFor(
            () => turns.length >= 2,
            h.event.protocolEventTimeoutMs()
        );

        for (const turn of turns) {
            const { turnTime, startedAt, currentTimestamp } = turn;
            expect(startedAt).to.be.a("number");
            expect(currentTimestamp).to.be.a("number");
            // The runtime Clock, not the wall clock: whole-second sampling
            // on both sides of the delivery.
            expect(
                currentTimestamp! - turn.wallTimestamp - runtimeOffset
            ).to.be.within(-2, 2);
            // Both come from the runtime's chain clock, in whole seconds: the
            // turn has just started, give or take the rounding.
            const elapsed = currentTimestamp! - startedAt!;
            expect(elapsed).to.be.at.least(-3);
            expect(elapsed).to.be.at.most(turnTime + 3);
        }
    } finally {
        await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).stub.releaseClockOffset().request()
            )
        );
    }
}
