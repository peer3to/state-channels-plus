// @spec-test-coverage-ignore: a node that lists chosen methods, for the light client fixture's endpoint check; executable evidence belongs to its calling test declarations
import { withIsolatedHardhatNode } from "./IsolatedHardhatNode";
import { RpcNodeProxy } from "./RpcNodeProxy";
import { JsonRpcSocket } from "@test/fixtures/lightClient/JsonRpcSocket";
import { assertLightClientEndpoints } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { waitFor } from "@test/utils/waitFor";

/**
 * What `assertLightClientEndpoints` fails with against a node that lists
 * `methods` in `rpc_methods`, or, when `methods` is undefined, against a node
 * that answers `rpc_methods` with a JSON-RPC error. The proxy gives that error
 * on any chain: a Hardhat node has no `rpc_methods`, but the parachain dev
 * node of a `--parachain` run lists its methods. Undefined when it passes.
 */
export async function lightClientEndpointCheckFailure(
    methods: string[] | undefined
): Promise<unknown> {
    return await withIsolatedHardhatNode(async (provider) => {
        const proxy = await RpcNodeProxy.start(provider._getConnection().url);
        if (methods === undefined) proxy.failNextRequest("rpc_methods");
        else proxy.answerRequests("rpc_methods", { version: 1, methods });
        const socket = await JsonRpcSocket.open(proxy.url);
        try {
            await assertLightClientEndpoints(socket);
            return undefined;
        } catch (error) {
            return error;
        } finally {
            socket.close();
            await proxy.close();
        }
    });
}

/**
 * The request a socket to a node sent while the node dropped the connection,
 * and one sent after that, each as what it settled with.
 */
export async function requestsOnDroppedSocket(): Promise<{
    inFlight: unknown;
    afterDrop: unknown;
}> {
    return await withIsolatedHardhatNode(async (provider) => {
        const proxy = await RpcNodeProxy.start(provider._getConnection().url);
        const socket = await JsonRpcSocket.open(proxy.url);
        try {
            const held = proxy.holdReplies("eth_blockNumber");
            const inFlight = socket
                .request("eth_blockNumber")
                .catch((error) => error);
            await waitFor(() => held.heldReplies() === 1);
            proxy.cut();
            const settled = await inFlight;
            const afterDrop = await socket
                .request("eth_chainId")
                .catch((error) => error);
            return { inFlight: settled, afterDrop };
        } finally {
            socket.close();
            await proxy.close();
        }
    });
}

/** What a request on a socket this side closed settles with. */
export async function requestAfterClose(): Promise<unknown> {
    return await withIsolatedHardhatNode(async (provider) => {
        const socket = await JsonRpcSocket.open(provider._getConnection().url);
        socket.close();
        return await socket.request("eth_chainId").catch((error) => error);
    });
}
