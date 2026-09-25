// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import { DetachedPromises } from "@/utils/DetachedPromises";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { expect } from "chai";

function rejectedReasons(results: PromiseSettledResult<unknown>[]) {
    return results
        .filter(
            (entry): entry is PromiseRejectedResult =>
                entry.status === "rejected"
        )
        .map((entry) => entry.reason);
}

/** Two inline peers; the first peer's host root is the disposing root. */
async function inlineHost(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 0, {
        configOverrides: { RUN_SDK_IN_THREAD: false }
    });
    return runtimeEndpointFor(h.getPeer(0).p2pInstance).host;
}

/** Detached work that the root will settle; rejected by the caller later. */
function collectHeldWork() {
    let reject!: (error: Error) => void;
    DetachedPromises.collect(
        new Promise<void>((_, rejectWork) => {
            reject = rejectWork;
        })
    );
    return reject;
}

/**
 * Work in flight when the root disposes and failing afterwards is the
 * disposal's outcome: the drain holds no rejection and no detached error
 * reaches the session.
 */
export async function assertDetachedFailureAfterRootDisposalIsSettled(
    h: MathPeerTestHarness
): Promise<void> {
    const host = await inlineHost(h);
    const reject = collectHeldWork();
    await host.dispose();
    reject(new Error("dependency torn down by disposal"));
    const results = await DetachedPromises.awaitAllAndClear();
    expect(rejectedReasons(results)).to.deep.equal([]);
}

/** Before disposal the same failure stays a real rejection in the drain. */
export async function assertDetachedFailureBeforeRootDisposalSurfaces(
    h: MathPeerTestHarness
): Promise<void> {
    await inlineHost(h);
    const reject = collectHeldWork();
    // The drain attaches its handlers first, so the rejection below is
    // observed by the drain rather than reported as unhandled.
    const drain = DetachedPromises.awaitAllAndClear();
    const failure = new Error("detached work failed");
    reject(failure);
    expect(rejectedReasons(await drain)).to.deep.equal([failure]);
}
