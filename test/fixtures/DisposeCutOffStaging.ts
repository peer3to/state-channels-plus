// @spec-test-coverage-ignore: shared staging for the mapped E2E-DisposeCutOff declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import { IN_FLIGHT_REPLY_DRAIN_MS } from "@/rpc/internal/AInternalRpcRoot";
import { isEngagedStatus } from "@/types/flags";
import { sleep } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** Long enough for released work to run on and send what it would send. */
const AFTER_CUT_WINDOW_MS = 1_000;

/**
 * One peer's runtime is disposed while it holds block work at `point`:
 * `confirmationValidation` holds a participant's ingest of the writer's
 * gossiped block, `commit` holds the writer between signing its block and
 * gossiping it. Inline, the held work is released after the cut, so it runs
 * on in the disposed runtime. Nothing the peer does after `dispose()` reaches
 * the other peers or the chain, the disposal is not held by the work, the
 * session sees no unhandled failure, and a fresh runtime for the same signer
 * joins the channel again.
 */
export async function assertDisposeCutsHeldBlockWork(
    h: MathPeerTestHarness,
    point: "confirmationValidation" | "commit",
    inline: boolean
): Promise<void> {
    await h.lifecycle.start(3, 0, {
        configOverrides: { RUN_SDK_IN_THREAD: !inline }
    });
    const writer = h.getPeer((await h.query.getNextPeerToWrite()).index);
    const peer =
        point === "commit"
            ? writer
            : h.peers.find((candidate) => candidate !== writer)!;
    const others = h.peers.filter((candidate) => candidate !== peer);
    for (const other of others)
        await h
            .control(other)
            .stub.countInboundFramesFrom(peer.address)
            .request();
    const held = await h.rpcStub.holdBlockWork(peer.index, point);
    const endpoint = inline ? runtimeEndpointFor(peer.p2pInstance) : undefined;
    // the writer's own call is a request this peer's disposal answers
    const write = h.transition
        .submit(writer, (contract) => contract.add(1), { waitForSync: false })
        .catch(() => undefined);
    await held.waitUntilEntered();
    const nonce = await h.provider.getTransactionCount(peer.address);

    const startedAt = Date.now();
    const disposal = peer.p2pInstance.dispose();
    if (endpoint) {
        // released after the cut: the work runs on in the disposed runtime
        await waitFor(() => endpoint.host.isDisposing);
        endpoint.stub.releaseBlockWorkHold();
    }
    await disposal;
    const disposalMs = Date.now() - startedAt;
    await write;
    const framesAtDisposal = await Promise.all(
        others.map((other) =>
            h.control(other).stub.getInboundFrameCount().request()
        )
    );
    await sleep(AFTER_CUT_WINDOW_MS);

    // A worker writer still holds the client's authoring request: the reply
    // drain waits its bound for it, and no longer.
    const isHeldParentRequest = !inline && point === "commit";
    expect(disposalMs).to.be.below(
        isHeldParentRequest
            ? IN_FLIGHT_REPLY_DRAIN_MS + 3_000
            : IN_FLIGHT_REPLY_DRAIN_MS
    );
    expect(
        await Promise.all(
            others.map((other) =>
                h.control(other).stub.getInboundFrameCount().request()
            )
        )
    ).to.deep.equal(framesAtDisposal);
    expect(await h.provider.getTransactionCount(peer.address)).to.equal(nonce);

    // a fresh runtime for the same signer comes back
    peer.logger.dispose();
    await h.createPeer(peer.index, peer.signer);
    const rebuilt = h.getPeer(peer.index);
    await h.join.connectSpectator(rebuilt);
    await waitFor(
        async () =>
            isEngagedStatus(
                await h.control(rebuilt).query.getStatus().request()
            ),
        h.event.protocolEventTimeoutMs()
    );
}
