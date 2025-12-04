import WebSocket, { WebSocketServer, AddressInfo } from "ws";
import P2PManager from "@/P2PManager";
import { LocalTransport } from "@/transport";
import { ChannelId } from "@/types/types";

const MAX_PORT_RETRIES = 20;

type Port = number;

type DiscoveryInfo = {
    port: Port;
    channelId: ChannelId;
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

    /** Retry count per peerPort */
    private static _peerRetryCount: Map<number, number> = new Map();

    private constructor() {}

    private static createServer(options: {
        port: number;
        onConnection?: (ws: WebSocket) => void;
        onError?: (err: Error) => void;
    }): { server: WebSocketServer; connections: Set<WebSocket> } {
        const { port, onConnection, onError } = options;

        const server = new WebSocketServer({ port });
        const connections = new Set<WebSocket>();

        this.serverConnections.set(server, connections);

        // Register connection handler
        server.on("connection", (ws: WebSocket) => {
            connections.add(ws);

            // Clean up on close
            ws.on("close", () => {
                connections.delete(ws);
            });

            // Swallow per-socket errors
            ws.on("error", () => {
                // Silent per-socket error handling
            });

            // Call custom connection handler if provided
            if (onConnection) {
                onConnection(ws);
            }
        });

        // Register error handler
        server.on("error", (err: Error) => {
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
    private static async createServerWithRetry(
        options: {
            port?: number;
            onConnection?: (ws: WebSocket) => void;
            onError?: (err: Error) => void;
        } = {}
    ): Promise<{
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
                    onConnection: options.onConnection,
                    onError: (err: Error) => {
                        if (serverReady && options.onError) {
                            options.onError(err);
                        }
                    }
                });

                await this.waitForServerReady(result.server);
                serverReady = true;

                const resolvedPort = this.getServerPort(result.server);
                return { ...result, port: resolvedPort };
            } catch (error: any) {
                lastError = error;

                if (result) {
                    await this.closeServer(result.server);
                }

                if (!this.isPortConflictError(error)) {
                    // Non-port error, rethrow immediately
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
        console.log("isPortConflictError", error);
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
        if (this.discoveryServer) {
            return false; // Already started
        }

        let lastError: Error | null = null;
        const maxRetries = 30;

        try {
            const { server, port } = await this.createServerWithRetry({
                onConnection: (ws: WebSocket) => {
                    this.handleIncomingRegistration(ws);
                },
                onError: (_err: Error) => {
                    // Silent error handling for discovery server
                }
            });

            this.discoveryServer = server;
            this.discoveryPort = port;

            return true;
        } catch (err: any) {
            lastError = err;
        }

        throw new Error(
            `Failed to start discovery server after ${maxRetries} attempts. Last error: ${lastError?.message}`
        );
    }

    /**
     * Registry Logic: Handles a new Peer connecting to the Registry.
     *
     * Flow:
     * 1. Receives {port, channelId} from new peer.
     * 2. Adds to registeredPeers list.
     * 3. Sends FULL list of existing peers to the new peer.
     * 4. Broadcasts the NEW peer to all other connected peers.
     */
    private static handleIncomingRegistration(ws: WebSocket): void {
        ws.on("message", (message: Buffer) => {
            try {
                const { port, channelId } = JSON.parse(
                    message.toString()
                ) as DiscoveryInfo;

                // Append to discovery list
                this.registeredPeers.push({ port, channelId });

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
            } catch (_err) {
                // Ignore malformed messages
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
        channelId?: string
    ): Promise<void> {
        // 1. Start PeerServer (Listens for incoming connections)
        const { server, port } = await this.createServerWithRetry({
            onConnection: (ws: WebSocket) => {
                // Accepted a direct connection from another peer
                const lt = new LocalTransport(ws, p2pManager);
                p2pManager.addConnection(lt);
            },
            onError: (err: Error) => {
                const errorCode = (err as any)?.code;
                if (errorCode === "EADDRINUSE") {
                    console.warn(`Port ${port} became in use after creation`);
                } else {
                    console.error("WebSocketServer error:", err.message);
                }
            }
        });

        this.peerServers.add(server);
        this._peerDiscoveryState.set(server, new Set<number>());

        // 2. Connect to Registry
        if (!this.discoveryPort) {
            throw new Error(
                "Discovery server not started. Call tryStart() before connectToPeers()."
            );
        }
        const discoveryWs = new WebSocket(
            `ws://localhost:${this.discoveryPort}`
        );
        this.activeDiscoveryConnections.add(discoveryWs);

        discoveryWs.on("open", () => {
            // Announce ourselves: {port, channelId}
            discoveryWs.send(JSON.stringify({ port, channelId }));
        });

        discoveryWs.on("close", () => {
            this.activeDiscoveryConnections.delete(discoveryWs);
        });

        discoveryWs.on("error", (_err: Error) => {
            this.activeDiscoveryConnections.delete(discoveryWs);
        });

        // 3. Handle Registry Announcements
        discoveryWs.on("message", (message: Buffer) => {
            this.handlePeerAnnouncement(
                message.toString(),
                server,
                port,
                p2pManager,
                channelId
            );
        });
    }

    /**
     * Peer Logic: Process a peer announcement from the Registry.
     *
     * Strategy:
     * - If peer is new AND (peerPort > myPort): Connect to them.
     * - If peerPort < myPort: Do nothing (they will connect to us).
     */
    private static handlePeerAnnouncement(
        msg: string,
        myServer: WebSocketServer,
        myPort: Port,
        p2pManager: P2PManager,
        myChannelId?: ChannelId
    ): void {
        try {
            const { port: peerPort, channelId: peerChannelId } = JSON.parse(
                msg
            ) as DiscoveryInfo;

            // Deduplication: Check if we already know this peer
            const seenPorts = this._peerDiscoveryState.get(myServer);
            if (!seenPorts || seenPorts.has(peerPort)) {
                return;
            }
            seenPorts.add(peerPort);

            // Connection Rule: Only connect if THEIR port is HIGHER.
            // (Matches channelId if specified)
            if (
                peerPort > myPort &&
                (!myChannelId || myChannelId === peerChannelId)
            ) {
                this.connectToSinglePeer(peerPort, p2pManager, myChannelId);
            }
        } catch (_err) {
            // Ignore malformed messages
        }
    }

    /**
     * Peer Logic: Connects to a specific peer.
     * Retries up to 3 times on failure.
     */
    private static connectToSinglePeer(
        peerPort: Port,
        p2pManager: P2PManager,
        channelId?: ChannelId
    ): void {
        const maxRetries = 3;
        const retryCount = this._peerRetryCount.get(peerPort) || 0;

        if (retryCount >= maxRetries) {
            return;
        }

        // Direct peer-to-peer connection
        const ws = new WebSocket(`ws://localhost:${peerPort}`);

        ws.on("open", () => {
            // Successful direct connection
            const lt = new LocalTransport(ws, p2pManager);
            p2pManager.addConnection(lt);
            this._peerRetryCount.delete(peerPort);
        });

        ws.on("error", (_err: Error) => {
            // Retry with backoff
            this._peerRetryCount.set(peerPort, retryCount + 1);
            setTimeout(
                () => this.connectToSinglePeer(peerPort, p2pManager, channelId),
                100 * (retryCount + 1)
            );
        });
    }

    public static async cleanup(): Promise<void> {
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

        // 2. Close all discovery connections (outgoing from peers)
        this.activeDiscoveryConnections.forEach((ws) => ws.terminate());
        this.activeDiscoveryConnections.clear();

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
        }

        // 4. Clear internal state
        this._peerRetryCount.clear();
        this.registeredPeers = [];

        // Wait for everything to close
        await Promise.all(closePromises);
    }
}
