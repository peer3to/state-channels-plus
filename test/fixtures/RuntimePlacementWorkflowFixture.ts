// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
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
