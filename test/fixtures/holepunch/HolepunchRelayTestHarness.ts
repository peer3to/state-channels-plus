import { HolepunchRelay } from "@/holepunch/HolepunchRelay";
import {
    DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
    HolepunchRetryPolicy,
    type HolepunchRetryPolicyOptions
} from "@/holepunch/HolepunchRetryPolicy";
import type {
    HolepunchRelayConnectionFactory,
    HolepunchSwarmUpdate,
    RelayerUrl
} from "@/holepunch/HolepunchTypes";
import { createLogger, type Logger } from "@/utils/logging";
import {
    startHolepunchRelayCluster,
    type HolepunchRelayCluster
} from "@test/browser/holepunchRelayCluster";
import { NodeHolepunchRelayConnectionFactory } from "./NodeHolepunchRelayConnectionFactory";

export class HolepunchRelayTestHarness {
    public readonly cluster: HolepunchRelayCluster;
    public readonly logger: Logger;
    private readonly relays = new Set<HolepunchRelay>();

    private constructor(cluster: HolepunchRelayCluster, logger: Logger) {
        this.cluster = cluster;
        this.logger = logger;
    }

    public static async create(): Promise<HolepunchRelayTestHarness> {
        const cluster = await startHolepunchRelayCluster();
        const logger = createLogger(
            {},
            { component: "HolepunchRelayTest" },
            { skipWriting: true, attachErrorListener: false }
        );
        return new HolepunchRelayTestHarness(cluster, logger);
    }

    public createRelay(
        options: {
            relayerUrls?: readonly RelayerUrl[];
            onSwarm?: HolepunchSwarmUpdate;
            connectionFactory?: HolepunchRelayConnectionFactory;
            policyOptions?: Partial<HolepunchRetryPolicyOptions>;
        } = {}
    ): {
        relay: HolepunchRelay;
        connectionFactory: HolepunchRelayConnectionFactory;
    } {
        const connectionFactory =
            options.connectionFactory ??
            new NodeHolepunchRelayConnectionFactory();
        const policy = new HolepunchRetryPolicy({
            ...DEFAULT_HOLEPUNCH_RETRY_POLICY_OPTIONS,
            failoverJitterMaxMs: 20,
            exhaustionBackoffBaseMs: 30,
            exhaustionBackoffCapMs: 60,
            teardownTimeoutMs: 50,
            random: () => 0,
            ...options.policyOptions
        });
        const relay = new HolepunchRelay(
            options.relayerUrls ?? [this.cluster.urls.a, this.cluster.urls.b],
            options.onSwarm ?? (() => undefined),
            connectionFactory,
            this.logger,
            policy
        );
        this.relays.add(relay);
        return { relay, connectionFactory };
    }

    public async close(): Promise<void> {
        await Promise.all([...this.relays].map((relay) => relay.dispose()));
        this.relays.clear();
        await this.cluster.close();
        this.logger.dispose({ cascadeChildren: true });
    }
}
