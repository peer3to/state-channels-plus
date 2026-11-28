// @spec-test-coverage-ignore: test-owned reading of a participant's light client subscriptions; executable evidence belongs to its calling test declarations
import {
    LIGHT_CLIENT_METHODS,
    type LightClientSubscription
} from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import type { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { waitFor } from "@test/utils/waitFor";

/** A subscribe or unsubscribe a participant sent its endpoint, as the proxy in front of it saw it. */
export type FollowRequest =
    | { call: "subscribe"; address: string; topics: string[] }
    | { call: "unsubscribe" };

/**
 * The light client slot node these tests need: a parachain run whose slot
 * nodes start with `--light-client`. Throws at once otherwise, instead of
 * letting the tests fail on an empty request list.
 */
export function assertLightClientSlotNode(): void {
    if (
        process.env.PARACHAIN !== "1" ||
        process.env.PEER3_NODE_LIGHT_CLIENT !== "1"
    )
        throw new Error(
            "These tests need slot nodes with the light client endpoints: run with --parachain, " +
                "PEER3_NODE_LIGHT_CLIENT=1 and (distributed) --forward-env PEER3_NODE_LIGHT_CLIENT"
        );
}

/** The subscribes and unsubscribes `proxy` forwarded, from its `from`-th one on. */
export function followRequests(
    proxy: RpcNodeProxy,
    from: number = 0
): FollowRequest[] {
    const requests: FollowRequest[] = [];
    for (const { method, params } of proxy.forwardedRequests) {
        if (method === LIGHT_CLIENT_METHODS.subscribe) {
            const [{ address, topics }] = params as [LightClientSubscription];
            requests.push({ call: "subscribe", address, topics });
        } else if (method === LIGHT_CLIENT_METHODS.unsubscribe)
            requests.push({ call: "unsubscribe" });
    }
    return requests.slice(from);
}

/** The first `count` subscribes and unsubscribes `proxy` forwards from its `from`-th one on, once it has. */
export async function nextFollowRequests(
    proxy: RpcNodeProxy,
    from: number,
    count: number
): Promise<FollowRequest[]> {
    await waitFor(() => followRequests(proxy, from).length >= count);
    return followRequests(proxy, from).slice(0, count);
}
