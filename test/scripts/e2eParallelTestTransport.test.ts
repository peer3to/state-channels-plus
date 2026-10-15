// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import {
    createLocalDhtNetwork,
    TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS,
    type LocalDhtNetwork
} from "../fixtures/distributed/testTransport";
import { expect } from "chai";
import { randomBytes } from "crypto";
import dgram from "dgram";

const {
    createPool
} = require("../../scripts/e2e-parallel/distributed/poolTransport.js");

type Pool = {
    onConnection(listener: () => void): void;
    close(): Promise<void>;
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
    it("moves the bootstrapper to a free port when the preferred UDP port is taken and announced topics are still found", async function () {
        const held = await holdUdpPort();
        let network: LocalDhtNetwork | undefined;
        const pools: Pool[] = [];
        let timer: NodeJS.Timeout | undefined;
        try {
            network = await createLocalDhtNetwork({
                preferredPort: held.port
            });
            expect(network.bootstrapPort).to.not.equal(held.port);
            const announced = randomBytes(32);
            const looked = randomBytes(32);
            const announcer: Pool = await createPool({
                announceTopics: [announced],
                lookupTopics: [looked],
                dht: network.createNode(),
                refreshIntervalMs: 5000
            });
            pools.push(announcer);
            const looker: Pool = await createPool({
                announceTopics: [looked],
                lookupTopics: [announced],
                dht: network.createNode(),
                refreshIntervalMs: 25
            });
            pools.push(looker);
            // Discovery needs a bootstrapper whose DHT id matches the
            // address it answers from; otherwise no announce is stored and
            // the two pools never find each other.
            await new Promise<void>((resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error("pools did not connect")),
                    TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
                );
                looker.onConnection(resolve);
            });
        } finally {
            clearTimeout(timer);
            for (const pool of pools.reverse()) await pool.close();
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
