import { expect } from "chai";

import { DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS } from "@/holepunch/HolepunchRetryPolicy";
import { NodeHolepunchRelayConnectionFactory } from "@test/fixtures/holepunch/NodeHolepunchRelayConnectionFactory";
import { HolepunchRelayTestHarness } from "@test/fixtures/holepunch/HolepunchRelayTestHarness";
import { waitFor } from "@test/utils/waitFor";

describe("HolepunchRelay", function () {
    let harness: HolepunchRelayTestHarness;

    beforeEach(async function () {
        this.timeout(10_000);
        harness = await HolepunchRelayTestHarness.create();
    });

    afterEach(async function () {
        this.timeout(10_000);
        await harness.close();
    });

    it("keeps an empty relay configuration idle", async function () {
        const factory = new NodeHolepunchRelayConnectionFactory();
        const { relay } = harness.createRelay({
            relayerUrls: [],
            connectionFactory: factory
        });

        relay.start();
        relay.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(factory.createdRelayerUrls).to.deep.equal([]);

        await relay.dispose();
        relay.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(factory.createdRelayerUrls).to.deep.equal([]);
    });

    it("starts once and cannot restart after disposal", async function () {
        const factory = new NodeHolepunchRelayConnectionFactory();
        let updates = 0;
        const { relay } = harness.createRelay({
            connectionFactory: factory,
            onSwarm: () => {
                updates++;
            }
        });

        relay.start();
        relay.start();
        await waitFor(() => updates === 1, 3000);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(factory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a
        ]);

        await relay.dispose();
        relay.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(factory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a
        ]);
    });

    it("turns a disconnect sequence into one failover and resets after success", async function () {
        const factory = new NodeHolepunchRelayConnectionFactory();
        let updates = 0;
        const { relay } = harness.createRelay({
            connectionFactory: factory,
            onSwarm: () => {
                updates++;
            }
        });

        relay.start();
        await waitFor(() => updates === 1, 3000);
        harness.cluster.disconnectClients("a");
        await waitFor(
            () =>
                harness.cluster.stats().endpoints.b.totalConnections === 1 &&
                updates === 2,
            3000
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(factory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a,
            harness.cluster.urls.b
        ]);

        harness.cluster.disconnectClients("b");
        await waitFor(
            () =>
                harness.cluster.stats().endpoints.a.totalConnections === 2 &&
                updates === 3,
            3000
        );
        expect(factory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a,
            harness.cluster.urls.b,
            harness.cluster.urls.a
        ]);
    });

    it("retries the full pool with bounded backoff and recovers", async function () {
        await harness.cluster.stop("a");
        await harness.cluster.stop("b");
        const factory = new NodeHolepunchRelayConnectionFactory();
        let updates = 0;
        const { relay } = harness.createRelay({
            connectionFactory: factory,
            onSwarm: () => {
                updates++;
            }
        });

        relay.start();
        await waitFor(() => factory.createdRelayerUrls.length >= 3, 3000);
        await harness.cluster.start("b");
        await waitFor(() => updates === 1, 3000);

        expect(factory.createdRelayerUrls.slice(0, 4)).to.deep.equal([
            harness.cluster.urls.a,
            harness.cluster.urls.b,
            harness.cluster.urls.a,
            harness.cluster.urls.b
        ]);
    });

    it("ignores a stale open after its attempt failed", async function () {
        const factory = new NodeHolepunchRelayConnectionFactory();
        factory.holdNextResourceOpen();
        let updates = 0;
        const { relay } = harness.createRelay({
            connectionFactory: factory,
            onSwarm: () => {
                updates++;
            }
        });

        relay.start();
        await waitFor(
            () => harness.cluster.stats().endpoints.a.activeConnections === 1,
            3000
        );
        expect(updates).to.equal(0);

        harness.cluster.disconnectClients("a");
        await waitFor(() => updates === 1, 3000);
        factory.releaseHeldResourceOpen();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(updates).to.equal(1);
        expect(factory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a,
            harness.cluster.urls.b
        ]);
    });

    it("continues after the teardown timeout branch", async function () {
        const factory = new NodeHolepunchRelayConnectionFactory();
        factory.holdNextResourceDestroy();
        let updates = 0;
        const teardownTimeoutMs = 40;
        const { relay } = harness.createRelay({
            connectionFactory: factory,
            policyOptions: {
                teardownTimeoutMs,
                random: () => 0
            },
            onSwarm: () => {
                updates++;
            }
        });

        relay.start();
        await waitFor(() => updates === 1, 3000);
        harness.cluster.pauseClientSockets("a");
        const failedAt = Date.now();
        harness.cluster.disconnectClients("a");
        await waitFor(() => updates === 2, 3000);
        const recoveredAfterMs = Date.now() - failedAt;
        factory.releaseHeldResourceDestroy();

        expect(recoveredAfterMs).to.be.at.least(teardownTimeoutMs);
        expect(recoveredAfterMs).to.be.lessThan(1000);
        expect(factory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a,
            harness.cluster.urls.b
        ]);
    });

    it("keeps coexisting owners isolated when one is disposed", async function () {
        const firstFactory = new NodeHolepunchRelayConnectionFactory();
        const secondFactory = new NodeHolepunchRelayConnectionFactory();
        let firstUpdates = 0;
        let secondUpdates = 0;
        const { relay: first } = harness.createRelay({
            connectionFactory: firstFactory,
            onSwarm: () => {
                firstUpdates++;
            }
        });
        const { relay: second } = harness.createRelay({
            connectionFactory: secondFactory,
            onSwarm: () => {
                secondUpdates++;
            }
        });

        first.start();
        second.start();
        await waitFor(
            () =>
                firstUpdates === 1 &&
                secondUpdates === 1 &&
                harness.cluster.stats().endpoints.a.activeConnections === 2,
            3000
        );

        await first.dispose();
        harness.cluster.disconnectClients("a");
        await waitFor(() => secondUpdates === 2, 3000);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(firstUpdates).to.equal(1);
        expect(secondFactory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a,
            harness.cluster.urls.b
        ]);
        expect(firstFactory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a
        ]);
    });

    it("cancels a pending retry on disposal", async function () {
        const factory = new NodeHolepunchRelayConnectionFactory();
        let updates = 0;
        let randomCalls = 0;
        const { relay } = harness.createRelay({
            connectionFactory: factory,
            policyOptions: {
                failoverJitterMaxMs: 100,
                random: () => (randomCalls++ === 0 ? 0 : 1)
            },
            onSwarm: () => {
                updates++;
            }
        });

        relay.start();
        await waitFor(() => updates === 1, 3000);
        harness.cluster.disconnectClients("a");
        await new Promise((resolve) => setTimeout(resolve, 20));
        await relay.dispose();
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(factory.createdRelayerUrls).to.deep.equal([
            harness.cluster.urls.a
        ]);
        expect(updates).to.equal(1);
    });

    it("recovers from synchronous connection construction failure", async function () {
        const factory = new NodeHolepunchRelayConnectionFactory();
        let updates = 0;
        const { relay } = harness.createRelay({
            relayerUrls: ["not a websocket URL", harness.cluster.urls.b],
            connectionFactory: factory,
            policyOptions: {
                failoverJitterMaxMs:
                    DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS.failoverJitterMaxMs,
                random: () => 0
            },
            onSwarm: () => {
                updates++;
            }
        });

        relay.start();
        await waitFor(() => updates === 1, 3000);
        expect(factory.createdRelayerUrls).to.deep.equal([
            "not a websocket URL",
            harness.cluster.urls.b
        ]);
    });
});
