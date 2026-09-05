// @spec-test-coverage-ignore: shared distributed test-transport fixture exercised by developer tooling tests
import net from "net";

const DHT = require("@hyperswarm/dht");
const {
    DISCOVERY_AUTH_TIMEOUT_MS
} = require("../../../scripts/e2e-parallel/distributed/authentication.js");
const {
    REVERSE_DIAL_WINDOW_MS
} = require("../../../scripts/e2e-parallel/distributed/poolTransport.js");

export const TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS =
    DISCOVERY_AUTH_TIMEOUT_MS + REVERSE_DIAL_WINDOW_MS + 5_000;

export type LocalDhtNetworkOptions = {
    /** Bootstrap port to ask for; probed from a free TCP port when omitted. */
    preferredPort?: number;
    /** Fall back to any free port when the preferred one is taken. */
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
    const port = options.preferredPort ?? (await probeFreeTcpPort());

    // The probed port is free for TCP at probe time; another process on
    // the host (a distributed worker, another suite) can hold it as UDP by
    // the time the bootstrapper binds, so the bootstrapper may fall back to
    // any free port and the nodes dial the port it actually bound.
    const bootstrap = DHT.bootstrapper(port, "127.0.0.1", {
        host: "127.0.0.1",
        anyPort: options.anyPort ?? true
    });
    await bootstrap.ready();
    const bound = bootstrap.address() as { port: number } | null;
    if (!bound) throw new Error("Missing DHT bootstrap address");
    const bootstrapPort = bound.port;
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

async function probeFreeTcpPort(): Promise<number> {
    const listener = net.createServer();
    await new Promise<void>((resolve) =>
        listener.listen(0, "127.0.0.1", resolve)
    );
    const address = listener.address();
    if (!address || typeof address === "string")
        throw new Error("Missing DHT fixture address");
    const port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    return port;
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
