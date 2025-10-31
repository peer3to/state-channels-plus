import WebSocket, { WebSocketServer } from "ws";
import P2PManager from "@/P2PManager";
import { LocalTransport } from "@/transport";

const PORT = 2001;
const MIN_PORT = 2000;
const MAX_PORT = 2999;
const MAX_PORT_RETRIES = 10;

type DiscoveryInfo = [number, string];
//This is used just for express testing
export class LocalDiscoveryServer {
    private static discoveryServer: WebSocketServer | null = null;
    private static peerServers: Set<WebSocketServer> = new Set();
    private static serverConnections: Map<WebSocketServer, Set<WebSocket>> =
        new Map();
    private constructor() {}

    public static tryStart() {
        if (this.discoveryServer) {
            return; // Already started
        }
        const wss = new WebSocketServer({ port: PORT });
        this.discoveryServer = wss;
        let connections: WebSocket[] = [];
        const discoveryInfo: DiscoveryInfo[] = [];
        wss.on("connection", (ws) => {
            connections.push(ws);
            ws.on("message", (message) => {
                const [peerPort, channelId] = JSON.parse(message.toString());
                discoveryInfo.push([peerPort, channelId]);
                for (const d of discoveryInfo) {
                    ws.send(JSON.stringify(d));
                }
                //broadcast to all other connections
                for (const conn of connections) {
                    if (conn !== ws) {
                        conn.send(message);
                    }
                }
            });
            ws.on("close", () => {
                connections = connections.filter((conn) => conn !== ws);
            });
        });
        wss.on("error", (err) => {
            // console.log("Discovery WSS ERROR: ", err);
        });
    }

    /**
     * Creates a WebSocketServer with retry logic for port conflicts
     */
    private static createWebSocketServerWithRetry(): {
        server: WebSocketServer;
        port: number;
    } {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
            const port =
                Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) +
                MIN_PORT;

            try {
                const server = new WebSocketServer({ port });

                // Track connections for this server
                const connections = new Set<WebSocket>();
                this.serverConnections.set(server, connections);

                server.on("error", (err: Error) => {
                    // Handle errors during operation
                    if ((err as any).code === "EADDRINUSE") {
                        // Port became in use after creation (unlikely
                        console.warn(
                            `Port ${port} became in use after creation`
                        );
                    }
                });

                return { server, port };
            } catch (error) {
                lastError = error as Error;
                const errorCode = (error as any)?.code;
                const errorMessage = (error as any)?.message || "";

                // Check if it's a port conflict error
                const isPortConflict =
                    errorCode === "EADDRINUSE" ||
                    errorMessage.includes("address already in use") ||
                    errorMessage.includes("EADDRINUSE");

                // If it's not a port conflict, rethrow immediately
                if (!isPortConflict) {
                    throw error;
                }
                // Otherwise, try again with a different port
                continue;
            }
        }

        throw new Error(
            `Failed to create WebSocketServer after ${MAX_PORT_RETRIES} attempts. Last error: ${lastError?.message}`
        );
    }

    public static connectToPeers(p2pManager: P2PManager, channelId?: string) {
        const { server: myServer, port: myPort } =
            this.createWebSocketServerWithRetry();
        this.peerServers.add(myServer);

        const duplicateSet = new Set<number>();
        const connectionRetries = new Map<number, number>();
        const maxRetries = 3;

        // Get or create connections set for tracking
        let connections = this.serverConnections.get(myServer);
        if (!connections) {
            connections = new Set<WebSocket>();
            this.serverConnections.set(myServer, connections);
        }

        myServer.on("connection", (ws) => {
            // Track the connection
            connections!.add(ws);

            // Create transport and add to P2P manager
            const lt = new LocalTransport(ws, p2pManager);
            p2pManager.addConnection(lt);

            // Clean up tracking on close
            ws.on("close", () => {
                connections!.delete(ws);
            });
        });

        const ws = new WebSocket(`ws://localhost:${PORT}`);

        const connectToPeer = (peerPort: number) => {
            const retryCount = connectionRetries.get(peerPort) || 0;
            if (retryCount >= maxRetries) return;

            const ws2 = new WebSocket(`ws://localhost:${peerPort}`);

            ws2.on("open", () => {
                const lt = new LocalTransport(ws2, p2pManager);
                p2pManager.addConnection(lt);
                connectionRetries.delete(peerPort);
            });

            ws2.on("error", () => {
                connectionRetries.set(peerPort, retryCount + 1);
                setTimeout(
                    () => connectToPeer(peerPort),
                    100 * (retryCount + 1)
                );
            });
        };

        ws.on("open", () => {
            ws.send(JSON.stringify([myPort, channelId]));
        });

        ws.on("message", (message) => {
            const [peerPort, peerChannelId] = JSON.parse(message.toString());
            if (duplicateSet.has(peerPort)) return;
            duplicateSet.add(peerPort);

            if (
                peerPort > myPort &&
                (!channelId || channelId === peerChannelId)
            ) {
                connectToPeer(peerPort);
            }
        });
    }

    public static cleanup(): void {
        // Close all peer servers
        this.peerServers.forEach((server) => {
            try {
                const connections = this.serverConnections.get(server);

                if (connections) {
                    connections.forEach((ws) => {
                        try {
                            if (
                                ws.readyState === WebSocket.OPEN ||
                                ws.readyState === WebSocket.CONNECTING
                            ) {
                                ws.close();
                            }
                        } catch (error) {
                            // Ignore errors when closing connections
                        }
                    });
                    connections.clear();
                    this.serverConnections.delete(server);
                }

                // Close the server synchronously
                server.close();
            } catch (error) {
                console.error("Error closing peer server:", error);
            }
        });
        this.peerServers.clear();

        // Close discovery server
        if (this.discoveryServer) {
            try {
                this.discoveryServer.close();
            } catch (error) {
                console.error("Error closing discovery server:", error);
            }
            this.discoveryServer = null;
        }
    }
}
