import { IN_FLIGHT_REPLY_DRAIN_MS } from "@/rpc/internal/AInternalRpcRoot";
import { DetachedPromises } from "@/utils/DetachedPromises";
import { PeerIdentityExecutionContext } from "@test/harness/core/peerErrorAttribution";
import { deferred } from "@test/utils/deferred";
import { expect } from "chai";
import { Wallet } from "ethers";

describe("PeerIdentityExecutionContext", function () {
    it("releases a cut runtime's still pending work from the drain after the grace and keeps a live sibling's", async function () {
        PeerIdentityExecutionContext.installDetachedPromiseRejectionStamping();
        const disposed = new PeerIdentityExecutionContext(
            Wallet.createRandom().address
        );
        const live = new PeerIdentityExecutionContext(
            Wallet.createRandom().address
        );
        const liveWork = deferred();
        DetachedPromises.clear();
        // a send frozen at the cut never settles
        disposed.runHandler(() =>
            DetachedPromises.collect(new Promise<never>(() => undefined))
        );
        live.runHandler(() => DetachedPromises.collect(liveWork.promise));
        disposed.dispose();

        // within the grace both still hold the drain
        expect(await DetachedPromises.collectSettledAndClear(50)).to.deep.equal(
            []
        );
        const settled = await DetachedPromises.collectSettledAndClear(
            IN_FLIGHT_REPLY_DRAIN_MS + 500
        );
        expect(settled.map((result) => result.status)).to.deep.equal([
            "fulfilled"
        ]);
        expect(DetachedPromises.size()).to.equal(1);
        liveWork.resolve();
        await DetachedPromises.awaitAllAndClear();
        expect(DetachedPromises.size()).to.equal(0);
    });

    it("still surfaces a cut runtime's failure within the grace", async function () {
        PeerIdentityExecutionContext.installDetachedPromiseRejectionStamping();
        const context = new PeerIdentityExecutionContext(
            Wallet.createRandom().address
        );
        const failing = deferred();
        DetachedPromises.clear();
        context.runHandler(() =>
            DetachedPromises.collect(
                failing.promise.then(() => {
                    throw new Error("connect answered false after the cut");
                })
            )
        );
        context.dispose();
        failing.resolve();

        const settled = await DetachedPromises.awaitAllAndClear();
        expect(
            settled.map((result) =>
                result.status === "rejected"
                    ? (result.reason as Error).message
                    : result.status
            )
        ).to.deep.equal(["connect answered false after the cut"]);
    });
});
