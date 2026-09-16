import type { Logger } from "@/utils/logging/Logger";
import { LocalDiscoveryServer } from "@/utils/node/LocalDiscoveryServer";
import { expect } from "chai";
// @spec-test-coverage-ignore: stages a real accepted socket before runtime disposal
import { once } from "node:events";
import WebSocket, { type WebSocketServer } from "ws";

export async function stageLocalDiscoveryReady() {
    // Inspect the real private listener registry; do not replace its behavior.
    const servers = Reflect.get(
        LocalDiscoveryServer,
        "peerServers"
    ) as Set<WebSocketServer>;
    if (servers.size !== 1)
        throw new Error("Expected one local discovery listener");
    const server = [...servers][0];
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Expected a TCP listener");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    let messages = 0;
    socket.on("message", () => messages++);
    await once(socket, "open");
    return {
        async sendReady() {
            const closed = once(socket, "close");
            socket.send("peer3:local-transport-client-ready:v1");
            await closed;
            return messages;
        },
        dispose() {
            socket.terminate();
        }
    };
}

export function observeDiscoveryLogger() {
    const logger = Reflect.get(LocalDiscoveryServer, "_logger") as Logger;
    const service = logger.loggerService;
    const store = Reflect.get(logger, "logStore");
    return {
        assertActive() {
            expect(() =>
                logger.info("discovery after manager disposal")
            ).not.to.throw();
        },
        async cleanup() {
            const first = LocalDiscoveryServer.cleanup();
            const second = LocalDiscoveryServer.cleanup();
            expect(first === second).to.equal(true);
            await Promise.all([first, second]);
        },
        assertDisposed() {
            expect(() => logger.info("after discovery cleanup")).to.throw(
                "disposed"
            );
            expect(logger.loggerService).to.equal(undefined);
            if (service)
                expect(Reflect.get(service, "stores").has(store)).to.equal(
                    false
                );
        }
    };
}
