// W3 - bidirectional rpc helper. attaches one RpcClient + one RpcServer to
// the same port; each filters by frame kind so they coexist without conflict.
// used by tamper-bridge: worker initiates rpc back to orchestrator, orchestrator
// runs registered closures, returns the answer.

import { RpcClient } from "./rpc-client";
import { RpcServer } from "./rpc-server";
import type { RpcPort } from "./rpc-types";

export type RpcEndpoint = {
    client: RpcClient;
    server: RpcServer;
    dispose: () => void;
};

// step 1 - both sides listen on the same port. RpcClient handles res/push,
// RpcServer handles req -> no conflict. dispose tears down both.
export function attach(port: RpcPort): RpcEndpoint {
    const client = new RpcClient(port);
    const server = new RpcServer(port);
    return {
        client,
        server,
        dispose(): void {
            // step 1 - server first -> closes port -> client.dispose fires via
            // close-listener. ordering is moot (both swallow) but explicit.
            server.dispose();
            client.dispose();
        }
    };
}
