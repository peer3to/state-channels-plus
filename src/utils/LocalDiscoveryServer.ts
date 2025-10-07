import WebSocket, { WebSocketServer } from "ws";
import P2PManager from "@/P2PManager";
import { LocalTransport } from "@/transport";

const PORT = 2001;

type DiscoveryInfo = [number, string];
//This is used just for express testing
export class LocalDiscoveryServer {
    private static discoveryServer: WebSocketServer | null = null;
    private static peerServers: Set<WebSocketServer> = new Set();
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
            console.log("Discovery WSS connection");
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

    public static connectToPeers(p2pManager: P2PManager, channelId?: string) {
        const myPort = Math.floor(Math.random() * 1000) + 2000;
        // console.log("RANDOM PORT ######", myPort);
        // console.log(new Error().stack);
        const myServer = new WebSocketServer({ port: myPort });
        this.peerServers.add(myServer);
        const duplicateSet = new Set<number>();
        myServer.on("connection", (ws) => {
            console.log("Local WSS connection established");
            const lt = new LocalTransport(ws, p2pManager);
            p2pManager.addConnection(lt);
            ws.on("close", () => {
                console.log("Connection closed");
            });
        });

        const ws = new WebSocket(`ws://localhost:${PORT}`);

        ws.on("open", () => {
            console.log("WebSocket opened");
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
                console.log(
                    `Connecting to peer on port %%%%%%%%%%%%%%%%%%%%%% ${peerPort} - my port ${myPort} - my channel ${channelId} - peer channel ${peerChannelId}`
                );
                const ws2 = new WebSocket(`ws://localhost:${peerPort}`);
                ws2.on("open", () => {
                    const lt = new LocalTransport(ws2, p2pManager);
                    p2pManager.addConnection(lt);
                });
            }
        });
        ws.on("error", (err) => {
            console.log("WebSocket ERROR: ", err);
        });
        ws.on("close", () => {
            console.log(`Connection to peer closed`);
        });
    }

    public static cleanup(): void {
        // Close all peer servers
        this.peerServers.forEach((server) => {
            try {
                server.close();
            } catch (error) {
                console.warn("Error closing peer server:", error);
            }
        });
        this.peerServers.clear();

        // Close discovery server
        if (this.discoveryServer) {
            try {
                this.discoveryServer.close();
            } catch (error) {
                console.warn("Error closing discovery server:", error);
            }
            this.discoveryServer = null;
        }
    }
}
