// HTTP hardhat node bootstrap: wraps hre.network.provider for cross-isolate JsonRpc access.

import hre from "hardhat";
import { TASK_NODE_CREATE_SERVER } from "hardhat/builtin-tasks/task-names";

type JsonRpcServerLike = {
    listen: () => Promise<{ address: string; port: number }>;
    close: () => Promise<void>;
};

export class HttpHardhatNode {
    private server?: JsonRpcServerLike;
    private resolvedPort?: number;

    async start(): Promise<{ url: string; port: number }> {
        // TASK_NODE_CREATE_SERVER only, not TASK_NODE (which also starts compile-watch).
        this.server = (await hre.run(TASK_NODE_CREATE_SERVER, {
            hostname: "127.0.0.1",
            port: 0,
            provider: hre.network.provider
        })) as JsonRpcServerLike;
        const { port } = await this.server.listen();
        this.resolvedPort = port;
        return { url: `http://127.0.0.1:${port}`, port };
    }

    async close(timeoutMs = 2000): Promise<void> {
        if (!this.server) return;
        const server = this.server;
        this.server = undefined;
        // Race close against timeout; keep-alive sockets may stall graceful close.
        await Promise.race([
            server.close().catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
        ]);
    }

    get port(): number | undefined {
        return this.resolvedPort;
    }
}
