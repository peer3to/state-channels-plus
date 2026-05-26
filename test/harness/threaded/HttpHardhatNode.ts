// W5 - http hardhat node bootstrap (option A1, per docs/parallel-plan-v2/W5-chain-access-design.md).
// invokes TASK_NODE_CREATE_SERVER -> wraps the in-isolate `hre.network.provider`
// in a JsonRpcServer on a kernel-picked port. workers dial it via JsonRpcProvider.
//
// chain state is unified: same hre, same provider, just served over loopback so
// other isolates can reach it. inline mode keeps using hre.ethers.provider direct.

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
        // step 1 - create the http+ws server wrapping hre.network.provider. NOT
        // TASK_NODE (which also starts compile-watch); just the json-rpc surface.
        this.server = (await hre.run(TASK_NODE_CREATE_SERVER, {
            hostname: "127.0.0.1",
            port: 0,
            provider: hre.network.provider
        })) as JsonRpcServerLike;
        // step 2 - listen returns the kernel-picked port.
        const { port } = await this.server.listen();
        this.resolvedPort = port;
        return { url: `http://127.0.0.1:${port}`, port };
    }

    async close(timeoutMs = 2000): Promise<void> {
        if (!this.server) return;
        const server = this.server;
        this.server = undefined;
        // step 1 - race close against a timeout. workers holding keep-alive
        // sockets may stall the graceful close (design concern #3).
        await Promise.race([
            server.close().catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
        ]);
    }

    get port(): number | undefined {
        return this.resolvedPort;
    }
}
