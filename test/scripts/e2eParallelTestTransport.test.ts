// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import dgram from "dgram";
import {
    createLocalDhtNetwork,
    type LocalDhtNetwork
} from "../fixtures/distributed/testTransport";

type DhtNode = {
    ready(): Promise<void>;
    destroy(options?: { force?: boolean }): Promise<void>;
    address(): { port: number } | null;
    ping(address: { host: string; port: number }): Promise<unknown>;
};

async function holdUdpPort(): Promise<{
    port: number;
    close(): Promise<void>;
}> {
    const socket = dgram.createSocket("udp4");
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
    return {
        port: socket.address().port,
        close: () => new Promise<void>((resolve) => socket.close(resolve))
    };
}

describe("distributed test transport fixture", function () {
    it("binds the bootstrapper elsewhere when the preferred UDP port is taken and the nodes still reach it", async function () {
        const held = await holdUdpPort();
        let network: LocalDhtNetwork | undefined;
        const nodes: DhtNode[] = [];
        try {
            network = await createLocalDhtNetwork({
                preferredPort: held.port
            });
            expect(network.bootstrapPort).to.not.equal(held.port);
            for (let i = 0; i < 2; i += 1) {
                const node = network.createNode() as DhtNode;
                nodes.push(node);
                await node.ready();
            }
            // Each node reaches the bootstrapper on the port it actually
            // bound, not on the preferred port another socket holds.
            for (const node of nodes) {
                await node.ping({
                    host: "127.0.0.1",
                    port: network.bootstrapPort
                });
            }
        } finally {
            for (const node of nodes) await node.destroy({ force: true });
            await network?.close();
            await held.close();
        }
    });

    it("fails on the taken port when the fallback is off", async function () {
        const held = await holdUdpPort();
        try {
            let failure: unknown;
            try {
                const network = await createLocalDhtNetwork({
                    preferredPort: held.port,
                    anyPort: false
                });
                await network.close();
            } catch (error) {
                failure = error;
            }
            expect(String(failure)).to.include("address already in use");
        } finally {
            await held.close();
        }
    });
});
