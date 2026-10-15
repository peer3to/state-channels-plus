// @spec-test-coverage-ignore: shared distributed test-transport fixture exercised by developer tooling tests
import { getFreePort } from "../../utils/nodeInfra";
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

const BOOTSTRAP_BIND_ATTEMPTS = 20;

type DhtBootstrapper = {
    ready(): Promise<void>;
    destroy(options: { force: boolean }): Promise<void>;
};

export async function createLocalDhtNetwork(
    options: LocalDhtNetworkOptions = {}
): Promise<LocalDhtNetwork> {
    const anyPort = options.anyPort ?? true;
    let port = options.preferredPort ?? (await getFreePort());
    for (let attempt = 1; ; attempt += 1) {
        // The bootstrapper's DHT id derives from the port it was created
        // with, so it must bind exactly that port: on a fallback port its
        // id would not match its address, peers would reject it, and no
        // announce would be stored. The probed port is free for TCP only;
        // another process can hold it as UDP, so retry on a fresh port.
        const bootstrap: DhtBootstrapper = DHT.bootstrapper(port, "127.0.0.1", {
            host: "127.0.0.1",
            anyPort: false
        });
        try {
            await bootstrap.ready();
        } catch (error) {
            // destroy() rethrows the bind error of the failed ready().
            await bootstrap.destroy({ force: true }).catch(() => undefined);
            const inUse =
                (error as NodeJS.ErrnoException).code === "EADDRINUSE";
            if (!inUse || !anyPort || attempt >= BOOTSTRAP_BIND_ATTEMPTS)
                throw error;
            port = await getFreePort();
            continue;
        }
        const bootstrapPort = port;
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
