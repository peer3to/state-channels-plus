import WebSocket, { WebSocketServer, AddressInfo } from "ws";
import type P2PManager from "@/P2PManager";
import { LocalTransport } from "@/transport";
import type { Logger } from "@/utils";
import { addressesEqual } from "@/utils/address";
import { config } from "@/utils/config";

const MAX_PORT_RETRIES = 20;
const LOCAL_WS_HOST = "127.0.0.1";
const LOCAL_TRANSPORT_CLIENT_READY_MESSAGE =
    "peer3:local-transport-client-ready:v1";
const LOCAL_TRANSPORT_SERVER_READY_MESSAGE =
    "peer3:local-transport-server-ready:v1";
const WS_CONNECT_TIMEOUT_MS = 750;
const LOCAL_TRANSPORT_READY_TIMEOUT_MS = 2000;
const REGISTRY_CONNECT_MAX_RETRIES = 10;
const MAX_PEER_CONNECT_RETRIES = 5;

type DiscoveryMode = "registry" | "peer";

type Port = number;
type PeerConnectionKey = `${Port}->${Port}`;

type DiscoveryInfo = {
    port: Port;
    rendezvousKey: string;
    channelId?: string;
    peerAddress: string;
};

/**
 * LocalDiscoveryServer - Manages local P2P mesh formation.
 *
 * ROLES:
 * 1. REGISTRY (One per process):
 *    - Listens on a random available local port.
 *    - Stores list of active peers.
 *    - Broadcasts new peers to everyone.
 *
 * 2. PEER (Many per process):
 *    - Listens on a random port (PeerServer).
 *    - Connects to Registry to announce itself.
 *    - Connects directly to other Peers upon receiving announcements.
 */
export class LocalDiscoveryServer {
    private static _logger?: Logger;

    public static setLogger(logger: Logger): void {
        this._logger = logger.child({ component: "LocalDiscovery" });
    }

    private static get logger(): Logger {
        if (!this._logger) {
            throw new Error("LocalDiscoveryServer logger not initialized");
        }
        return this._logger;
    }
    // --- Registry State ---
    private static discoveryServer: WebSocketServer | null = null;
    private static discoveryPort: number | null = null;
    private static registeredPeers: DiscoveryInfo[] = [];

    // --- Peer State ---
    /** Server instances listening for peer-to-peer connections */
    private static peerServers: Set<WebSocketServer> = new Set();

    /** Active connections from Peers to the Registry */
    private static activeDiscoveryConnections: Set<WebSocket> = new Set();

    /** Tracks active connections for any server (Registry or Peer) */
    private static serverConnections: Map<WebSocketServer, Set<WebSocket>> =
        new Map();

    /** Tracks which peer ports a specific PeerServer has already seen/connected to */
    private static _peerDiscoveryState: WeakMap<WebSocketServer, Set<number>> =
        new WeakMap();

    /** Retry count per outbound local-port to peer-port connection. */
    private static _peerRetryCount: Map<PeerConnectionKey, number> = new Map();

    /** Discovery and primary peer-dial retries owned by this server. */
    private static pendingTimers: Set<ReturnType<typeof setTimeout>> =
        new Set();

    private static lobbySessions: WeakMap<
        P2PManager,
        Map<string, { server: WebSocketServer; discoveryWs?: WebSocket }>
    > = new WeakMap();

    /** Prevent reconnect loops during/after cleanup */
    private static _cleanupRequested: boolean = false;

    private constructor() {}

    private static scheduleTimer(callback: () => void, delayMs: number): void {
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            callback();
        }, delayMs);
        this.pendingTimers.add(timer);
    }

    private static getExternalRegistryUrl(): string | undefined {
        const url = config.LOCAL_DISCOVERY_REGISTRY_URL?.trim();
        return url ? url : undefined;
    }

    private static createOutboundWebSocket(options: {
        url: string;
        purpose: "registry" | "peer";
        connectTimeoutMs?: number;
        log: Record<string, unknown>;
        onOpen: (ws: WebSocket, openedAtMs: number) => void;
        onMessage?: (ws: WebSocket, message: Buffer) => void;
        onClose?: (ws: WebSocket, code: number, reason: Buffer) => void;
        onError?: (ws: WebSocket, err: Error) => void;
        onConnectFailure: (
            reason: string,
            details?: Record<string, unknown>
        ) => void;
    }): WebSocket {
        const {
            url,
            purpose,
            connectTimeoutMs = WS_CONNECT_TIMEOUT_MS,
            log,
            onOpen,
            onMessage,
            onClose,
            onError,
            onConnectFailure
        } = options;

        const startMs = Date.now();
        let opened = false;
        let connectFailureHandled = false;

        this.logger.debug("WebSocket dial", {
            ...log,
            url,
            purpose,
            timeoutMs: connectTimeoutMs
        });

        const ws = new WebSocket(url);

        const failOnce = (
            reason: string,
            details?: Record<string, unknown>
        ) => {
            if (opened || connectFailureHandled) {
                return;
            }
            connectFailureHandled = true;
            onConnectFailure(reason, details);
        };

        const connectTimeoutId = setTimeout(() => {
            if (opened || this._cleanupRequested) {
                return;
            }

            // Force an event if the OS/socket stack never errors.
            try {
                ws.terminate();
            } catch {
                // ignore
            }

            failOnce("timeout", {
                durationMs: Date.now() - startMs
            });
        }, connectTimeoutMs);

        ws.on("open", () => {
            opened = true;
            clearTimeout(connectTimeoutId);
            onOpen(ws, Date.now());
        });

        ws.on("message", (message: Buffer) => {
            if (onMessage) {
                onMessage(ws, message);
            }
        });

        ws.on("close", (code: number, reason: Buffer) => {
            clearTimeout(connectTimeoutId);

            // If we never opened, treat it as a connect failure.
            if (!opened && !this._cleanupRequested) {
                failOnce("close", {
                    code,
                    reason: reason?.toString?.() || "",
                    durationMs: Date.now() - startMs
                });
            }

            if (onClose) {
                onClose(ws, code, reason);
            }
        });

        ws.on("error", (err: Error) => {
            clearTimeout(connectTimeoutId);

            // ws sometimes emits error without ever opening; treat as connect failure.
            if (!opened && !this._cleanupRequested) {
                failOnce("error", {
                    message: err?.message,
                    durationMs: Date.now() - startMs
                });
            }

            if (onError) {
                onError(ws, err);
            }
        });

        return ws;
    }

    private static createServer(options: {
        port: number;
        mode: DiscoveryMode;
        myPeerAddress?: string;
        onConnection?: (ws: WebSocket) => void;
        onError?: (err: Error) => void;
    }): { server: WebSocketServer; connections: Set<WebSocket> } {
        const { port, onConnection, onError, mode, myPeerAddress } = options;

        // Listen on the same IPv4 loopback address used by every local dial.
        // An unspecified host may bind IPv6 while another parallel slot owns
        // the same port on IPv4, sending the dial to the wrong WebSocket server.
        const server = new WebSocketServer({ port, host: LOCAL_WS_HOST });
        const connections = new Set<WebSocket>();

        this.serverConnections.set(server, connections);

        this.logger.debug("Server created", {
            mode,
            port,
            ...(myPeerAddress ? { myPeerAddress } : {})
        });

        // Register connection handler
        server.on("connection", (ws: WebSocket) => {
            this.logger.debug(`New connection established to ${mode}`, {
                ...(myPeerAddress ? { myPeerAddress } : {})
            });
            connections.add(ws);

            // Clean up on close
            ws.on("close", () => {
                this.logger.debug(`Connection closed to ${mode}`, {
                    ...(myPeerAddress ? { myPeerAddress } : {})
                });
                connections.delete(ws);
            });

            // Swallow per-socket errors
            ws.on("error", () => {
                // Silent per-socket error handling
                this.logger.error(`Connection error to ${mode}`, {
                    ...(myPeerAddress ? { myPeerAddress } : {})
                });
            });

            // Call custom connection handler if provided
            if (onConnection) {
                onConnection(ws);
            }
        });

        // Register error handler
        server.on("error", (err: Error) => {
            this.logger.warn("Server error", {
                mode,
                port,
                ...(myPeerAddress ? { myPeerAddress } : {}),
                message: err.message
            });
            if (onError) {
                onError(err);
            }
        });

        return { server, connections };
    }

    /**
     * Wraps createServer with retry logic.
     * Retries port binding on EADDRINUSE.
     */
    private static async createServerWithRetry(options: {
        port?: number;
        mode: DiscoveryMode;
        myPeerAddress?: string;
        onConnection?: (ws: WebSocket) => void;
        onError?: (err: Error) => void;
    }): Promise<{
        server: WebSocketServer;
        connections: Set<WebSocket>;
        port: number;
    }> {
        const attempts = MAX_PORT_RETRIES;

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < attempts; attempt++) {
            const port =
                typeof options.port === "number" && attempt === 0
                    ? options.port
                    : 0;

            let serverReady = false;
            let result: {
                server: WebSocketServer;
                connections: Set<WebSocket>;
            } | null = null;

            try {
                result = this.createServer({
                    port,
                    mode: options.mode,
                    myPeerAddress: options.myPeerAddress,
                    onConnection: options.onConnection,
                    onError: (err: Error) => {
                        if (serverReady && options.onError) {
                            options.onError(err);
                        }
                    }
                });

                await this.waitForServerReady(result.server);
                serverReady = true;

                this.logger.debug("Server ready", {
                    mode: options.mode,
                    requestedPort: port,
                    ...(options.myPeerAddress
                        ? { myPeerAddress: options.myPeerAddress }
                        : {})
                });

                const resolvedPort = this.getServerPort(result.server);
                this.logger.debug("Server bound", {
                    mode: options.mode,
                    requestedPort: port,
                    resolvedPort,
                    ...(options.myPeerAddress
                        ? { myPeerAddress: options.myPeerAddress }
                        : {}),
                    attempt
                });
                return { ...result, port: resolvedPort };
            } catch (error: any) {
                lastError = error;

                if (result) {
                    await this.closeServer(result.server);
                }

                this.logger.warn("Server bind failed", {
                    mode: options.mode,
                    requestedPort: port,
                    attempt,
                    ...(options.myPeerAddress
                        ? { myPeerAddress: options.myPeerAddress }
                        : {}),
                    message: error?.message
                });

                if (!this.isPortConflictError(error)) {
                    // Non-port error, rethrow immediately
                    this.logger.error("Non-retryable server error", {
                        mode: options.mode,
                        requestedPort: port,
                        ...(options.myPeerAddress
                            ? { myPeerAddress: options.myPeerAddress }
                            : {}),
                        message: error?.message
                    });
                    throw error;
                }
                // Port conflict, try again
                continue;
            }
        }

        throw new Error(
            `Failed to create WebSocketServer after ${attempts} attempts. Last error: ${lastError?.message}`
        );
    }

    private static isPortConflictError(error: any): boolean {
        const errorCode = error?.code;
        const errorMessage = error?.message ?? "";

        return (
            errorCode === "EADDRINUSE" ||
            (typeof errorMessage === "string" &&
                (errorMessage.includes("address already in use") ||
                    errorMessage.includes("EADDRINUSE")))
        );
    }

    private static getServerPort(server: WebSocketServer): number {
        const address = server.address();
        if (typeof address === "object" && address) {
            return (address as AddressInfo).port;
        }
        throw new Error("Unable to determine server port");
    }

    /**
     * Waits for the WebSocket server to be ready (listening) or error.
     * Returns a promise that resolves when the server is listening, or rejects on error.
     */
    private static waitForServerReady(server: WebSocketServer): Promise<void> {
        return new Promise((resolve, reject) => {
            // Remove event listeners once we get a result (success or error)
            const cleanup = () => {
                server.off("listening", onListening);
                server.off("error", onError);
            };

            const onListening = () => {
                cleanup();
                resolve();
            };

            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };

            // Listen for server ready or error events (once each)
            server.once("listening", onListening);
            server.once("error", onError);
        });
    }

    private static closeServer(server: WebSocketServer): Promise<void> {
        return new Promise((resolve) => {
            server.clients.forEach((client) => client.terminate());
            server.close(() => resolve());
        });
    }

    /**
     * Starts the central Registry Server.
     *
     * Flow:
     * - Binds to a port.
     * - When a peer connects: routes to handleIncomingRegistration().
     */
    public static async tryStart(): Promise<boolean> {
        const externalRegistryUrl = this.getExternalRegistryUrl();
        if (externalRegistryUrl) {
            this.logger.debug("Using external discovery registry", {
                mode: "registry",
                registryUrl: externalRegistryUrl
            });
            return false;
        }

        if (this.discoveryServer) {
            return false; // Already started
        }

        this._cleanupRequested = false;

        let lastError: Error | null = null;
        const maxRetries = 30;

        try {
            const { server, port } = await this.createServerWithRetry({
                mode: "registry",
                onConnection: (ws: WebSocket) => {
                    this.handleIncomingRegistration(ws);
                },
                onError: (_err: Error) => {
                    // Silent error handling for discovery server
                }
            });

            this.discoveryServer = server;
            this.discoveryPort = port;

            this.logger.debug("Discovery server started", {
                mode: "registry",
                registryPort: port
            });

            return true;
        } catch (err: any) {
            lastError = err;
            this.logger.error("Discovery server start failed", {
                mode: "registry",
                message: err?.message
            });
        }

        throw new Error(
            `Failed to start discovery server after ${maxRetries} attempts. Last error: ${lastError?.message}`
        );
    }

    /**
     * Registry Logic: Handles a new Peer connecting to the Registry.
     *
     * Flow:
     * 1. Receives {port, rendezvousKey, peerAddress} from new peer.
     * 2. Adds to registeredPeers list.
     * 3. Sends FULL list of existing peers to the new peer.
     * 4. Broadcasts the NEW peer to all other connected peers.
     */
    private static handleIncomingRegistration(ws: WebSocket): void {
        ws.on("message", (message: Buffer) => {
            try {
                const { port, rendezvousKey, peerAddress } = JSON.parse(
                    message.toString()
                ) as DiscoveryInfo;
                if (!peerAddress) {
                    throw new Error("Registration is missing peerAddress");
                }

                this.logger.debug("Registration received", {
                    mode: "registry",
                    port,
                    rendezvousKey,
                    peerAddress,
                    totalPeers: this.registeredPeers.length + 1
                });

                // Append to discovery list
                this.registeredPeers.push({
                    port,
                    rendezvousKey,
                    peerAddress
                });

                // Send all known discovery entries back to this client
                for (const entry of this.registeredPeers) {
                    ws.send(JSON.stringify(entry));
                }

                // Broadcast new entry to all other discovery clients
                const connections = this.serverConnections.get(
                    this.discoveryServer!
                );
                if (connections) {
                    for (const conn of connections) {
                        if (conn !== ws) {
                            conn.send(message);
                        }
                    }
                }
            } catch {
                // Ignore malformed messages
                this.logger.warn("Malformed registration message", {
                    mode: "registry",
                    raw: message.toString()
                });
            }
        });
    }

    /**
     * Peer Logic: Join the mesh.
     *
     * Flow:
     * 1. Start a PeerServer to listen for connections from other peers.
     * 2. Connect to the Registry to announce presence.
     * 3. Listen for Registry announcements (other peers) → handlePeerAnnouncement.
     */
    public static async connectToPeers(
        p2pManager: P2PManager,
        rendezvousKey: string,
        myPeerAddress: string
    ): Promise<void> {
        const peerLog = {
            mode: "peer" as const,
            rendezvousKey,
            myPeerAddress
        };

        // 1. Start PeerServer (Listens for incoming connections)
        const { server, port } = await this.createServerWithRetry({
            mode: "peer",
            myPeerAddress,
            onConnection: (ws: WebSocket) => {
                // Accepted a direct connection from another peer
                ws.once("message", (message: Buffer) => {
                    // A peer retrying a failed connection can deliver its
                    // ready frame while the session tears down; starting a
                    // handshake then runs against disposed runtimes (Clock,
                    // state managers).
                    if (
                        this._cleanupRequested ||
                        message.toString() !==
                            LOCAL_TRANSPORT_CLIENT_READY_MESSAGE
                    ) {
                        ws.close();
                        return;
                    }

                    // Acknowledge the raw socket before either endpoint sends
                    // handshake RPCs. WebSocket ordering then guarantees both
                    // LocalTransport listeners are installed first.
                    ws.send(LOCAL_TRANSPORT_SERVER_READY_MESSAGE);
                    const lt = new LocalTransport(ws, p2pManager);
                    p2pManager.localRpc.initHandshakeService.initHandshake(lt);
                    this.logger.debug("Inbound peer connection accepted", {
                        ...peerLog,
                        myPeerPort: port
                    });
                });
            },
            onError: (err: Error) => {
                const errorCode = (err as any)?.code;
                if (errorCode === "EADDRINUSE") {
                    this.logger.warn("Peer server port became in use", {
                        ...peerLog,
                        myPeerPort: port,
                        message: err.message
                    });
                } else {
                    this.logger.error("Peer server error", {
                        ...peerLog,
                        myPeerPort: port,
                        message: err.message
                    });
                }
            }
        });

        this.peerServers.add(server);
        this._peerDiscoveryState.set(server, new Set<number>());
        const sessions = this.lobbySessions.get(p2pManager) ?? new Map();
        sessions.set(rendezvousKey, { server });
        this.lobbySessions.set(p2pManager, sessions);

        this.logger.info("Peer server started", {
            ...peerLog,
            myPeerPort: port
        });

        // 2. Connect to Registry
        const externalRegistryUrl = this.getExternalRegistryUrl();
        if (!externalRegistryUrl && !this.discoveryPort) {
            throw new Error(
                "Discovery server not started. Call tryStart() before connectToPeers()."
            );
        }
        const registryPort = this.discoveryPort;
        const registryUrl =
            externalRegistryUrl ?? `ws://${LOCAL_WS_HOST}:${registryPort}`;

        const connectRegistry = (attempt: number) => {
            if (this._cleanupRequested) {
                return;
            }
            if (!externalRegistryUrl && !this.discoveryPort) {
                this.logger.warn(
                    "Discovery server port missing; cannot connect",
                    {
                        ...peerLog,
                        registryUrl,
                        myPeerPort: port,
                        registryPort: this.discoveryPort
                    }
                );
                return;
            }

            if (attempt > REGISTRY_CONNECT_MAX_RETRIES) {
                this.logger.error(
                    "Discovery registry connect retries exhausted",
                    {
                        ...peerLog,
                        registryUrl,
                        myPeerPort: port,
                        registryPort: this.discoveryPort,
                        attempts: attempt - 1
                    }
                );
                return;
            }

            const log = {
                ...peerLog,
                registryUrl,
                myPeerPort: port,
                registryPort: this.discoveryPort,
                attempt
            };

            const discoveryWs = this.createOutboundWebSocket({
                url: registryUrl,
                purpose: "registry",
                log,
                onOpen: (ws) => {
                    ws.send(
                        JSON.stringify({
                            port,
                            rendezvousKey,
                            // Compatibility with the standalone local relay protocol.
                            channelId: rendezvousKey,
                            peerAddress: myPeerAddress
                        })
                    );
                    this.logger.debug("Connected to discovery registry", {
                        ...peerLog,
                        registryUrl,
                        registryPort: this.discoveryPort,
                        myPeerPort: port,
                        attempt
                    });
                },
                onMessage: (_ws, message: Buffer) => {
                    const msg = message.toString();
                    this.handlePeerAnnouncement(
                        msg,
                        server,
                        port,
                        p2pManager,
                        rendezvousKey,
                        myPeerAddress
                    );
                    this.logger.debug("Discovery announcement received", {
                        ...peerLog,
                        myPeerPort: port,
                        msg
                    });
                },
                onClose: () => {
                    this.activeDiscoveryConnections.delete(discoveryWs);
                    this.logger.debug("Discovery connection closed", {
                        ...peerLog,
                        registryUrl,
                        registryPort: this.discoveryPort,
                        myPeerPort: port
                    });
                },
                onError: (_ws, err: Error) => {
                    // Note: connect failures are handled via onConnectFailure; this is for post-open errors.
                    this.logger.warn("Discovery connection error", {
                        ...peerLog,
                        registryUrl,
                        registryPort: this.discoveryPort,
                        myPeerPort: port,
                        message: err?.message
                    });
                },
                onConnectFailure: (reason, details) => {
                    this.activeDiscoveryConnections.delete(discoveryWs);
                    this.logger.warn(
                        "Discovery registry connect failed; retrying",
                        {
                            ...peerLog,
                            registryUrl,
                            myPeerPort: port,
                            registryPort: this.discoveryPort,
                            attempt,
                            reason,
                            ...(details ?? {})
                        }
                    );
                    this.scheduleTimer(
                        () => connectRegistry(attempt + 1),
                        Math.min(100 * attempt, 1000)
                    );
                }
            });

            this.activeDiscoveryConnections.add(discoveryWs);
            const session = this.lobbySessions
                .get(p2pManager)
                ?.get(rendezvousKey);
            if (session) session.discoveryWs = discoveryWs;
        };

        connectRegistry(1);
    }

    public static async leave(
        rendezvousKey: string,
        p2pManager?: P2PManager
    ): Promise<void> {
        if (!p2pManager) return;
        const sessions = this.lobbySessions.get(p2pManager);
        const session = sessions?.get(rendezvousKey);
        if (!session) return;
        session.discoveryWs?.close();
        // Stop accepting peers for this rendezvous without closing transports
        // that the channel lifecycle now owns. cleanup() closes those sockets.
        session.server.close();
        sessions?.delete(rendezvousKey);
    }

    /**
     * Peer Logic: Process a peer announcement from the Registry.
     *
     * Strategy:
     * - The lower EVM address is the primary dialer.
     * - The other peer waits for the primary peer's owned retry loop.
     */
    private static handlePeerAnnouncement(
        msg: string,
        myServer: WebSocketServer,
        myPort: Port,
        p2pManager: P2PManager,
        myRendezvousKey: string,
        myPeerAddress: string
    ): void {
        try {
            const announcement = JSON.parse(msg) as DiscoveryInfo;
            const peerPort = announcement.port;
            const peerAddress = announcement.peerAddress;
            const peerRendezvousKey =
                announcement.rendezvousKey ?? announcement.channelId;
            if (!peerAddress) {
                throw new Error("Announcement is missing peerAddress");
            }
            if (!peerRendezvousKey) {
                throw new Error("Announcement is missing rendezvous key");
            }

            const logBase = {
                mode: "peer" as const,
                myPeerAddress,
                myPeerPort: myPort,
                peerAddress,
                peerPort,
                peerRendezvousKey
            };

            if (addressesEqual(myPeerAddress, peerAddress)) {
                this.logger.debug("Announcement ignored (self)", logBase);
                return;
            }

            // Deduplication: Check if we already know this peer
            const seenPorts = this._peerDiscoveryState.get(myServer);
            if (!seenPorts || seenPorts.has(peerPort)) {
                this.logger.debug("Announcement ignored (seen)", {
                    ...logBase
                });
                return;
            }
            seenPorts.add(peerPort);

            const rendezvousMatches = myRendezvousKey === peerRendezvousKey;

            if (!rendezvousMatches) {
                this.logger.debug(
                    "Announcement ignored (rendezvous mismatch)",
                    {
                        ...logBase,
                        myRendezvousKey
                    }
                );
                return;
            }

            const isPrimaryDialer =
                myPeerAddress.toLowerCase() < peerAddress.toLowerCase();
            if (!isPrimaryDialer) {
                this.logger.debug("Waiting for primary peer dial", {
                    ...logBase,
                    myRendezvousKey
                });
                return;
            }

            this.connectToSinglePeer(
                peerPort,
                peerAddress,
                p2pManager,
                myRendezvousKey,
                myPeerAddress,
                myPort
            );
            this.logger.debug("Connecting to announced peer", {
                ...logBase,
                myRendezvousKey
            });
        } catch {
            // Ignore malformed messages
            this.logger.warn("Malformed peer announcement", {
                mode: "peer",
                raw: msg
            });
        }
    }

    private static isPeerConnected(
        p2pManager: P2PManager,
        peerAddress: string
    ): boolean {
        return p2pManager.openConnections.some(
            (transport) =>
                transport.peerAddress !== undefined &&
                addressesEqual(transport.peerAddress, peerAddress)
        );
    }

    /**
     * Peer Logic: Connects to a specific peer.
     * Retries a bounded number of times on failure.
     */
    private static connectToSinglePeer(
        peerPort: Port,
        peerAddress: string,
        p2pManager: P2PManager,
        rendezvousKey: string,
        myPeerAddress: string,
        myPeerPort: Port
    ): void {
        if (
            this._cleanupRequested ||
            this.isPeerConnected(p2pManager, peerAddress)
        ) {
            return;
        }

        const connectionKey: PeerConnectionKey = `${myPeerPort}->${peerPort}`;
        const retryCount = this._peerRetryCount.get(connectionKey) || 0;

        if (retryCount >= MAX_PEER_CONNECT_RETRIES) {
            this.logger.warn("Max peer connection retries reached", {
                mode: "peer",
                peerAddress,
                peerPort,
                rendezvousKey,
                attempts: retryCount
            });
            return;
        }

        const attempt = retryCount + 1;
        const peerUrl = `ws://${LOCAL_WS_HOST}:${peerPort}`;

        const log = {
            mode: "peer" as const,
            myPeerAddress,
            myPeerPort,
            peerAddress,
            peerPort,
            rendezvousKey,
            attempt
        };

        let retryScheduled = false;
        let handshakeCompleted = false;
        let transport: LocalTransport | undefined;
        let transportReadyTimeout: ReturnType<typeof setTimeout> | undefined;

        const scheduleRetry = (
            reason: string,
            details?: Record<string, unknown>
        ) => {
            if (
                retryScheduled ||
                handshakeCompleted ||
                this._cleanupRequested
            ) {
                return;
            }
            retryScheduled = true;

            this._peerRetryCount.set(connectionKey, attempt);
            this.logger.warn("Peer connection failed; retrying", {
                ...log,
                reason,
                ...(details ?? {})
            });

            this.scheduleTimer(
                () =>
                    this.connectToSinglePeer(
                        peerPort,
                        peerAddress,
                        p2pManager,
                        rendezvousKey,
                        myPeerAddress,
                        myPeerPort
                    ),
                100 * attempt
            );
        };

        this.createOutboundWebSocket({
            url: peerUrl,
            purpose: "peer",
            log,
            onOpen: (ws) => {
                ws.send(LOCAL_TRANSPORT_CLIENT_READY_MESSAGE);
                // This frame only confirms local socket-listener setup. Keep
                // its retry bound independent of the protocol agreement time.
                transportReadyTimeout = setTimeout(() => {
                    if (transport || this._cleanupRequested) return;
                    ws.close();
                    scheduleRetry("transport-ready-timeout");
                }, LOCAL_TRANSPORT_READY_TIMEOUT_MS);
            },
            onMessage: (ws, message) => {
                if (
                    transport ||
                    message.toString() !== LOCAL_TRANSPORT_SERVER_READY_MESSAGE
                ) {
                    return;
                }

                clearTimeout(transportReadyTimeout);
                const lt = new LocalTransport(ws, p2pManager);
                transport = lt;
                const handshakeService =
                    p2pManager.localRpc.initHandshakeService;
                handshakeService.initHandshake(lt);
                void handshakeService
                    .waitForHandshakeCompleted(
                        lt,
                        p2pManager.stateManager.timeConfig.agreementTime * 1000
                    )
                    .then((completed) => {
                        if (!completed) {
                            p2pManager.disconnectConnection(lt);
                            scheduleRetry("handshake-timeout");
                            return;
                        }

                        // Socket open only proves transport availability. The
                        // authenticated handshake completes peer discovery.
                        handshakeCompleted = true;
                        this._peerRetryCount.delete(connectionKey);
                        this.logger.info("Connected to peer", {
                            ...log
                        });
                    });
            },
            onClose: (_ws, code: number, reason: Buffer) => {
                clearTimeout(transportReadyTimeout);
                this.logger.debug("Peer connection closed", {
                    mode: "peer",
                    myPeerAddress,
                    myPeerPort,
                    peerPort,
                    rendezvousKey,
                    code,
                    reason: reason?.toString?.() || ""
                });
                scheduleRetry("closed-before-handshake", {
                    code,
                    reason: reason?.toString?.() || ""
                });
            },
            onError: (_ws, err: Error) => {
                // Post-open errors are noisy but useful in debug.
                this.logger.debug("Peer connection error", {
                    mode: "peer",
                    myPeerAddress,
                    myPeerPort,
                    peerPort,
                    rendezvousKey,
                    message: err?.message
                });
            },
            onConnectFailure: (reason, details) => {
                scheduleRetry(reason, details);
            }
        });

        // If we never open and never fail, the helper will time out.
        // If we do open, we keep the ws alive for LocalTransport.
    }

    public static async cleanup(): Promise<void> {
        this._cleanupRequested = true;
        const closePromises: Promise<void>[] = [];

        // 1. Close all peer servers
        for (const server of this.peerServers) {
            closePromises.push(
                new Promise<void>((resolve) => {
                    // Close all connections first
                    const connections = this.serverConnections.get(server);
                    connections?.forEach((ws) => ws.terminate());
                    connections?.clear();
                    this.serverConnections.delete(server);

                    // Close the server
                    server.close(() => resolve());
                })
            );
        }
        this.peerServers.clear();

        this.logger.debug("Peer servers closing", {
            mode: "peer",
            count: closePromises.length
        });

        // 2. Close all discovery connections (outgoing from peers)
        this.activeDiscoveryConnections.forEach((ws) => {
            if (ws.readyState === WebSocket.CLOSED) return;
            closePromises.push(
                new Promise<void>((resolve) => {
                    ws.once("close", () => resolve());
                    ws.terminate();
                })
            );
        });
        this.activeDiscoveryConnections.clear();

        for (const timer of this.pendingTimers) {
            clearTimeout(timer);
        }
        this.pendingTimers.clear();

        this.logger.debug("Discovery connections terminated", { mode: "peer" });

        // 3. Close the central discovery server
        if (this.discoveryServer) {
            closePromises.push(
                new Promise<void>((resolve) => {
                    this.discoveryServer!.clients.forEach((client) =>
                        client.terminate()
                    );
                    this.discoveryServer!.close(() => {
                        this.discoveryServer = null;
                        this.discoveryPort = null;
                        resolve();
                    });
                })
            );
            this.logger.debug("Discovery server closing", { mode: "registry" });
        }

        // 4. Clear internal state
        this._peerRetryCount.clear();
        this.registeredPeers = [];

        this.logger.debug("LocalDiscovery cleanup complete", {
            mode: "registry"
        });

        // Wait for everything to close
        await Promise.all(closePromises);

        this._cleanupRequested = false;
    }
}
