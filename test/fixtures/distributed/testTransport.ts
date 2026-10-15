// @spec-test-coverage-ignore: shared distributed test-transport fixture exercised by developer tooling tests
import { startDhtBootstrapper } from "../../utils/nodeInfra";
import net from "net";

const {
    DISCOVERY_AUTH_TIMEOUT_MS
} = require("../../../scripts/e2e-parallel/distributed/authentication.js");
const {
    REVERSE_DIAL_WINDOW_MS
} = require("../../../scripts/e2e-parallel/distributed/poolTransport.js");
const DHT = require("hyperdht");

export const TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS =
    DISCOVERY_AUTH_TIMEOUT_MS + REVERSE_DIAL_WINDOW_MS + 5_000;

export type LocalDhtNetworkOptions = {
    /** Bootstrap port to ask for; probed from a free TCP port when omitted. */
    preferredPort?: number;
    /** Retry on another free port when the requested one is taken. */
    anyPort?: boolean;
};

export type LocalDhtNetwork = {
    bootstrapPort: number;
    createNode: () => unknown;
    close: () => Promise<void>;
};

export async function createLocalDhtNetwork(
    options: LocalDhtNetworkOptions = {}
): Promise<LocalDhtNetwork> {
    // without anyPort a taken preferred port fails at once
    const bootstrap = await startDhtBootstrapper("127.0.0.1", {
        port: options.preferredPort,
        attempts: options.anyPort === false ? 1 : undefined
    });
    const bootstrapPort = bootstrap.address().port;
    return {
        bootstrapPort,
        createNode: () =>
            new DHT({
                host: "127.0.0.1",
                ephemeral: false,
                firewalled: false,
                bootstrap: [`127.0.0.1:${String(bootstrapPort)}`]
            }),
        close: () => bootstrap.destroy({ force: true })
    };
}

export async function createSocketPair(): Promise<{
    client: net.Socket;
    server: net.Socket;
    close: () => Promise<void>;
}> {
    const listener = net.createServer();
    await new Promise<void>((resolve) =>
        listener.listen(0, "127.0.0.1", resolve)
    );
    const address = listener.address();
    if (!address || typeof address === "string")
        throw new Error("Missing TCP fixture address");
    const accepted = new Promise<net.Socket>((resolve) =>
        listener.once("connection", resolve)
    );
    const client = net.connect(address.port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
    });
    const server = await accepted;
    return {
        client,
        server,
        close: async () => {
            client.destroy();
            server.destroy();
            await new Promise<void>((resolve) =>
                listener.close(() => resolve())
            );
        }
    };
}
