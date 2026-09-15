import { isTransport } from "@/transport/ATransport";
import { isNetworkTransport } from "@/transport/NetworkTransport";
import {
    assertInternalNetworkRejection,
    assertPortSubscriptionsRemoved,
    withRuntimeRpc,
    withTwoRuntimeCallers
} from "@test/fixtures/RpcRouterFixture";
import { expect } from "chai";

describe("InternalTransport", () => {
    it("removes both port subscriptions exactly once on close", async () => {
        await assertPortSubscriptionsRemoved();
    });
    it("rejects sends after the runtime connection closes", async () => {
        await withRuntimeRpc(async (sdk) => {
            sdk.parentTransport.close();
            expect(() => sdk.remote.runtimeProbe.echo("late").send()).to.throw(
                "Runtime connection is closed"
            );
        });
    });
    it("preserves the supplied close reason for a pending caller", async () => {
        await withRuntimeRpc(async (sdk) => {
            const held = sdk.control.holdNextResponse("echo");
            const pending = sdk.remote.runtimeProbe
                .echo("held")
                .request()
                .catch((error) => error);
            await held;
            const reason = new Error("explicit close reason");
            sdk.parentTransport.closeWithReason(reason);
            expect((await pending) === reason).to.equal(true);
        });
    });
    it("has a neutral transport surface without network identity metadata", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(isTransport(sdk.parentTransport)).to.equal(true);
            expect(isNetworkTransport(sdk.parentTransport)).to.equal(false);
            expect("peerAddress" in sdk.parentTransport).to.equal(false);
            expect("transportType" in sdk.parentTransport).to.equal(false);
            expect("p2pManager" in sdk.parentTransport).to.equal(false);
        });
    });
    it("rejects an internal transport passed to an untyped network request", async () => {
        await assertInternalNetworkRejection("request");
    });
    it("rejects an internal transport passed to an untyped network send", async () => {
        await assertInternalNetworkRejection("sendOne");
    });
    it("rejects an internal transport passed to an untyped network recipient list", async () => {
        await assertInternalNetworkRejection("sendMultiple");
    });
    it("closes once and rejects only calls owned by that connection", async () => {
        await withTwoRuntimeCallers(
            async (first, second, closeSecond, control) => {
                const firstPending = first.runtimeProbe
                    .hold("first remains pending", 5)
                    .request();
                await first.runtimeProbe.state().request();
                let firstSettled = false;
                void firstPending.then(() => {
                    firstSettled = true;
                });
                const received = control.holdNextResponse("echo");
                let settlements = 0;
                const result = second.runtimeProbe
                    .echo("held reply")
                    .request()
                    .catch((error: Error) => {
                        settlements++;
                        return error.message;
                    });
                await received;
                closeSecond();
                closeSecond();
                expect(await result).to.equal("Runtime connection is closed");
                expect(firstSettled).to.equal(false);
                await first.runtimeProbe
                    .release("first remains pending")
                    .request();
                expect(await firstPending).to.equal(5);
                expect(settlements).to.equal(1);
                expect(control.pendingTimers()).to.equal(0);
                expect(control.heldCount).to.equal(0);
                expect(
                    control.events.filter(
                        (event) => event.direction === "close"
                    ).length
                ).to.equal(1);
                expect(await first.runtimeProbe.sum(2, 3).request()).to.equal(
                    5
                );
            }
        );
    });
});
