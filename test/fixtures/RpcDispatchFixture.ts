// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { withRuntimeRpc } from "./RpcRouterFixture";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { isRpc } from "@/rpc/Rpc";
import { expect } from "chai";

export async function assertMissingEndpoint(
    service: string,
    method: string,
    mode: "ordinary" | "accessor" | "nonFunction" = "ordinary"
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        await sdk.remote.runtimeProbe.configure(mode).request();
        let failure: unknown;
        try {
            await sdk.clientRoot.router.sendRpcRequest(
                { service, method, params: [] },
                sdk.parentTransport
            );
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect((failure as Error).message).to.include("Unknown RPC endpoint");
        expect(
            (await sdk.remote.runtimeProbe.descriptorState().request())
                .accessorReads
        ).to.equal(0);
        expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
    });
}

export async function assertAwaitedRouterDispatch(
    request: boolean
): Promise<void> {
    await withRuntimeRpc(async (sdk) => {
        const host = [...sdk.roots].find(
            (root): root is P2pRuntimeHostRoot =>
                root instanceof P2pRuntimeHostRoot
        );
        if (!host) throw new Error("Expected the actual SDK host root");
        const router = host.router;
        const original = router.onMessage;
        let completion: Promise<void> | undefined;
        let finished = false;
        router.onMessage = (message, sender) => {
            const pending = original.call(router, message, sender);
            if (isRpc(message) && message.method === "voidHold") {
                completion = pending.then(() => {
                    finished = true;
                });
            }
            return pending;
        };
        let response: Promise<void> | undefined;
        try {
            const call = sdk.remote.runtimeProbe.voidHold("await-dispatch");
            if (request) response = call.request();
            else call.send();
            expect(
                (await sdk.remote.runtimeProbe.state().request()).entered
            ).to.deep.equal(["await-dispatch"]);
            expect(completion).not.to.equal(undefined);
            expect(finished).to.equal(false);
            await sdk.remote.runtimeProbe.release("await-dispatch").request();
            await completion;
            await response;
            expect(finished).to.equal(true);
            expect(sdk.clientRoot.router.pendingRequestCount).to.equal(0);
        } finally {
            await sdk.remote.runtimeProbe.releaseAll().request();
            await completion;
            await response;
            router.onMessage = original;
        }
    });
}
