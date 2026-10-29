import { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import {
    assertBoundTypes,
    assertCategoryTypes
} from "@test/fixtures/RpcProxyTypesFixture";
import {
    withRuntimeRpc,
    assertMutablePeerProxyContext
} from "@test/fixtures/RpcRouterFixture";
import { expect } from "chai";

describe("RpcProxyTypes", () => {
    it("reads a mutable peer service context when the captured method is called", async () => {
        await assertMutablePeerProxyContext();
    });
    it("preserves bound arguments results void acknowledgement and explicit sends", async () => {
        void assertBoundTypes;
        await withRuntimeRpc(async (sdk) => {
            expect(await sdk.remote.runtimeProbe.sum(2, 4).request()).to.equal(
                6
            );
            expect(
                await sdk.remote.runtimeProbe.notify("ack").request()
            ).to.equal(undefined);
            expect(sdk.remote.runtimeProbe.notify("sent").send()).to.equal(
                undefined
            );
            expect(
                (await sdk.remote.runtimeProbe.state().request()).notifications
            ).to.deep.equal(["ack", "sent"]);
        });
    });
    it("keeps runtime proxy roots non-thenable", async () => {
        await withRuntimeRpc(async (sdk) => {
            expect(await Promise.resolve(sdk.remote)).to.equal(sdk.remote);
            expect(Reflect.get(sdk.remote, "then")).to.equal(undefined);
        });
    });

    it("rejects unrelated roots and cross-category router transport and service types", () => {
        void assertCategoryTypes;
        // @ts-expect-error - every concrete root must implement disposal.
        class MissingDisposalRoot extends AInternalRpcRoot {
            public async start(): Promise<void> {}
        }
        // @ts-expect-error - every concrete root must implement startup.
        class MissingStartupRoot extends AInternalRpcRoot {
            public async dispose(): Promise<void> {}
        }
        void MissingDisposalRoot;
    });
});
