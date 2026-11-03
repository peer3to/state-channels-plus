// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { ForkId } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// A persistent peer keeps its channel in its own temporary partition; a
// restart disposes its runtime and starts it again with the same key.

type Harness = ReturnType<typeof TestSession.getHarness>;
type Peer = Harness["peers"][number];

/** every peer but `downIndex` authors `count` blocks, each by the peer whose turn it is */
export async function authorWhileDown(
    h: Harness,
    forkId: ForkId,
    count: number,
    downIndex: number
) {
    const live = h.peers.filter((peer) => peer.index !== downIndex);
    const query = h.control(live[0]).query;
    for (let index = 0; index < count; index++) {
        const height = await query.getLatestBlockHeight(forkId).request();
        let author: (typeof live)[number] | undefined;
        await waitFor(async () => {
            for (const peer of live) {
                const nextToWrite = await h
                    .control(peer)
                    .query.getNextToWrite()
                    .request();
                if (nextToWrite === peer.address) author = peer;
            }
            return author !== undefined;
        });
        await author!.p2pInstance.p2pContractInstance.add(1);
        await waitFor(async () =>
            (
                await Promise.all(
                    live.map((peer) =>
                        h
                            .control(peer)
                            .query.getLatestBlockHeight(forkId)
                            .request()
                    )
                )
            ).every((latest) => latest === height! + 1)
        );
    }
}

/** the next writer signs a block its disk cannot confirm and aborts */
export async function failNextWritersFlush(h: Harness) {
    const forkId = h.activeForkId!;
    const author = h.getPeer((await h.query.getNextPeerToWrite()).index);
    const observers = h.peers.filter((peer) => peer.index !== author.index);
    const height = await h
        .control(observers[0])
        .query.getNextBlockHeight(forkId)
        .request();
    expect(
        await h.control(author).stub.failPersistenceFlushes().request()
    ).to.equal(true);

    let transactionError: unknown;
    try {
        await author.p2pInstance.p2pContractInstance.add(1);
    } catch (error) {
        transactionError = error;
    }
    await waitFor(() => author.eventSpies.onAbort!.callCount > 0);
    return { forkId, author, observers, height, transactionError };
}

/**
 * Parks every flush of `peer` until `release`. `bound` says whether a
 * partition was bound when the hold began; otherwise the next bind is held.
 */
export async function holdFlushes(h: Harness, peer: Peer) {
    const stub = () => h.control(peer).stub;
    const bound = await stub().holdPersistenceFlushes().request();
    const held = async () =>
        (await stub().getHeldPersistenceFlushCount().request()) ?? 0;
    return {
        bound,
        held,
        waitUntilHeld: () => waitFor(async () => (await held()) > 0),
        release: () => stub().releasePersistenceFlushes().request()
    };
}

/**
 * Four participants, peer 2 persistent; peer 0 signs an invalid state
 * transition and the honest peers dispute and reduce the fork without it.
 */
export async function startAndReduce(h: Harness) {
    await h.lifecycle.start(4, 4, {
        persistentPeers: [2]
    });
    const replacedForkId = h.activeForkId!;
    const { newForkId } = await h.scenario.disputeAndResolve({
        maliciousPeerIndex: 0
    });
    return { replacedForkId, newForkId };
}
