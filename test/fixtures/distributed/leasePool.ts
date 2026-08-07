import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import {
    createLocalDhtNetwork,
    TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
} from "./testTransport";

const {
    authenticateClient,
    derivePoolKeys
} = require("../../../scripts/e2e-parallel/distributed/authentication.js");
const {
    createPool
} = require("../../../scripts/e2e-parallel/distributed/poolTransport.js");
const {
    ProtocolPeer,
    waitForMessage
} = require("../../../scripts/e2e-parallel/distributed/protocol.js");
const {
    DEFAULTS
} = require("../../../scripts/e2e-parallel/distributed/serverArgParser.js");
const {
    main: startServer
} = require("../../../scripts/e2e-parallel/distributed/server.js");

type LeaseEvent = {
    sequence: number;
    workerId: string;
    label: string;
    kind: string;
    header: Record<string, unknown>;
};

type LeaseConnection = {
    workerId: string;
    label: string;
    peer: {
        close: () => void;
        on: (event: string, listener: (message: LeaseEvent) => void) => void;
        once: (event: string, listener: () => void) => void;
        send: (kind: string, header?: Record<string, unknown>) => Promise<void>;
    };
    connected: boolean;
    heartbeat: NodeJS.Timeout;
};

type LeaseWorkerServer = {
    name: string;
    manager: {
        active: unknown;
        markRunning: (connection: unknown) => void;
        updateProgress: (
            connection: unknown,
            progress: {
                completedTasks: number;
                totalTasks: number;
                elapsedMs: number;
            }
        ) => void;
        updateStatus: (connection: unknown, status: string) => void;
    };
    connectionCount: () => number;
    shutdown: () => Promise<void>;
};

export class LeaseOrchestrator {
    private readonly events: LeaseEvent[] = [];
    private readonly notifications = new EventEmitter();
    private readonly connections = new Map<string, LeaseConnection>();
    private readonly pool: {
        publicKey: Buffer;
        onConnection: (
            listener: (
                stream: unknown,
                info: { publicKey?: Buffer; client?: boolean }
            ) => void
        ) => void;
        close: () => Promise<void>;
    };
    private sequence = 0;
    private closed = false;

    private constructor(
        pool: LeaseOrchestrator["pool"],
        private readonly sessionId: string,
        private readonly authKey: Buffer
    ) {
        this.pool = pool;
    }

    static async create(options: {
        dht: unknown;
        poolSecret: string;
        sessionId: string;
        refreshIntervalMs?: number;
    }): Promise<LeaseOrchestrator> {
        const keys = derivePoolKeys(options.poolSecret);
        const pool = await createPool({
            announceTopics: [keys.orchestratorTopic],
            lookupTopics: [keys.workerTopic],
            dht: options.dht,
            refreshIntervalMs: options.refreshIntervalMs || 25
        });
        const orchestrator = new LeaseOrchestrator(
            pool,
            options.sessionId,
            keys.authKey
        );
        pool.onConnection((stream: unknown, info: { publicKey?: Buffer }) => {
            orchestrator.connect(stream, info).catch((error: Error) => {
                orchestrator.notifications.emit("error", error);
            });
        });
        return orchestrator;
    }

    checkpoint(): number {
        return this.sequence;
    }

    connectedWorkerCount(): number {
        return [...this.connections.values()].filter(
            (connection) => connection.connected
        ).length;
    }

    received(label: string, kind: string, after = 0): boolean {
        return this.events.some(
            (event) =>
                event.sequence > after &&
                event.label === label &&
                event.kind === kind
        );
    }

    async waitFor(
        label: string,
        kind: string,
        options: {
            after?: number;
            predicate?: (event: LeaseEvent) => boolean;
            timeoutMs?: number;
        } = {}
    ): Promise<LeaseEvent> {
        const after = options.after || 0;
        const matches = (event: LeaseEvent) =>
            event.sequence > after &&
            event.label === label &&
            event.kind === kind &&
            (!options.predicate || options.predicate(event));
        const existing = this.events.find(matches);
        if (existing) return existing;
        return new Promise<LeaseEvent>((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for ${label} ${kind}`));
            }, options.timeoutMs || 5000);
            const onEvent = (event: LeaseEvent) => {
                if (!matches(event)) return;
                cleanup();
                resolve(event);
            };
            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };
            const cleanup = () => {
                clearTimeout(timeout);
                this.notifications.off("event", onEvent);
                this.notifications.off("error", onError);
            };
            this.notifications.on("event", onEvent);
            this.notifications.on("error", onError);
        });
    }

    send(label: string, kind: string): Promise<void> {
        const connection = [...this.connections.values()].find(
            (entry) => entry.connected && entry.label === label
        );
        if (!connection) throw new Error(`No connection to ${label}`);
        return connection.peer.send(kind);
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        for (const connection of this.connections.values()) {
            clearInterval(connection.heartbeat);
            connection.peer.close();
        }
        await this.pool.close();
    }

    private async connect(
        stream: unknown,
        info: { publicKey?: Buffer }
    ): Promise<void> {
        if (this.closed) return;
        const peer = new ProtocolPeer(stream);
        await authenticateClient(
            peer,
            this.authKey,
            { local: this.pool.publicKey },
            TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
        );
        const ready = await waitForMessage(
            peer,
            "SERVER_READY",
            TEST_DISTRIBUTED_CONNECTION_TIMEOUT_MS
        );
        const workerId = info.publicKey?.toString("hex") || ready.header.name;
        const heartbeat = setInterval(
            () => peer.send("HEARTBEAT").catch(() => {}),
            100
        );
        const connection: LeaseConnection = {
            workerId,
            label: ready.header.name,
            peer,
            connected: true,
            heartbeat
        };
        this.connections.set(workerId, connection);
        peer.on("message", (message: LeaseEvent) => {
            const event = {
                sequence: ++this.sequence,
                workerId,
                label: connection.label,
                kind: message.kind,
                header: message.header
            };
            this.events.push(event);
            this.notifications.emit("event", event);
        });
        peer.once("close", () => {
            clearInterval(connection.heartbeat);
            connection.connected = false;
            const event = {
                sequence: ++this.sequence,
                workerId,
                label: connection.label,
                kind: "CONNECTION_CLOSED",
                header: {}
            };
            this.events.push(event);
            this.notifications.emit("event", event);
        });
        await peer.send("LEASE_REQUEST", { sessionId: this.sessionId });
    }
}

export async function startLeaseWorkerServer(options: {
    dht: unknown;
    name: string;
    poolSecret: string;
    workRoot: string;
}): Promise<{
    manager: {
        active: unknown;
        markRunning: (connection: unknown) => void;
        updateProgress: (
            connection: unknown,
            progress: {
                completedTasks: number;
                totalTasks: number;
                elapsedMs: number;
            }
        ) => void;
        updateStatus: (connection: unknown, status: string) => void;
    };
    connectionCount: () => number;
    shutdown: () => Promise<void>;
}> {
    process.env.SCP_TEST_POOL_SECRET = options.poolSecret;
    const server = await startServer({
        ...DEFAULTS,
        name: options.name,
        workRoot: options.workRoot,
        dht: options.dht,
        allowSharedHost: true,
        heartbeatTimeoutMs: 1000
    });
    return {
        manager: server.manager,
        shutdown: server.shutdown,
        connectionCount: () => server.pool.swarm.connections.size
    };
}

export class LeasePoolHarness {
    private readonly servers: LeaseWorkerServer[] = [];
    private readonly orchestrators: LeaseOrchestrator[] = [];
    private readonly previousPoolSecret = process.env.SCP_TEST_POOL_SECRET;

    private constructor(
        private readonly network: {
            createNode: () => unknown;
            close: () => Promise<void>;
        },
        private readonly root: string,
        readonly poolSecret: string
    ) {}

    static async create(): Promise<LeasePoolHarness> {
        return new LeasePoolHarness(
            await createLocalDhtNetwork(),
            fs.mkdtempSync(path.join(os.tmpdir(), "lease-pool-")),
            `lease-pool-${process.pid}-${Date.now()}`
        );
    }

    async startServer(name: string): Promise<LeaseWorkerServer> {
        const server = {
            name,
            ...(await startLeaseWorkerServer({
                dht: this.network.createNode(),
                name,
                poolSecret: this.poolSecret,
                workRoot: path.join(this.root, name)
            }))
        };
        this.servers.push(server);
        return server;
    }

    async stopServer(server: LeaseWorkerServer): Promise<void> {
        await server.shutdown();
        const index = this.servers.indexOf(server);
        if (index >= 0) this.servers.splice(index, 1);
    }

    async startOrchestrator(sessionId: string): Promise<LeaseOrchestrator> {
        const orchestrator = await LeaseOrchestrator.create({
            dht: this.network.createNode(),
            poolSecret: this.poolSecret,
            sessionId
        });
        this.orchestrators.push(orchestrator);
        return orchestrator;
    }

    async closeOrchestrator(orchestrator: LeaseOrchestrator): Promise<void> {
        await orchestrator.close();
        const index = this.orchestrators.indexOf(orchestrator);
        if (index >= 0) this.orchestrators.splice(index, 1);
    }

    async close(): Promise<void> {
        await Promise.allSettled(
            this.orchestrators.splice(0).map((entry) => entry.close())
        );
        await Promise.allSettled(
            this.servers.splice(0).map((entry) => entry.shutdown())
        );
        await this.network.close();
        fs.rmSync(this.root, { recursive: true, force: true });
        if (this.previousPoolSecret === undefined) {
            delete process.env.SCP_TEST_POOL_SECRET;
        } else {
            process.env.SCP_TEST_POOL_SECRET = this.previousPoolSecret;
        }
    }
}
