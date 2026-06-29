import { expect } from "chai";

import P2pRuntimeClient from "@/evm/p2pRuntime/P2pRuntimeClient";
import type { RuntimePort } from "@/evm/p2pRuntime/types";

function makeFakeRuntimePort(): {
    port: RuntimePort;
    deliver: (message: unknown) => void;
} {
    let handler: ((message: unknown) => void) | undefined;
    return {
        port: {
            post: () => undefined,
            onMessage: (h) => {
                handler = h;
            },
            start: () => undefined,
            onClose: () => undefined,
            close: () => undefined
        },
        deliver: (message) => handler?.(message)
    };
}

function makeClient(port: RuntimePort): P2pRuntimeClient {
    return new P2pRuntimeClient(port, {
        signerAddress: "0x0000000000000000000000000000000000000001",
        stateMachine: {
            address: "0x0000000000000000000000000000000000000002",
            abiJson: "[]"
        }
    });
}

describe("P2pRuntimeClient webRTCBridgePort", function () {
    it("surfaces the bridge port the host hands over", function () {
        const fake = makeFakeRuntimePort();
        const client = makeClient(fake.port);
        expect(client.webRTCBridgePort).to.equal(undefined);

        const bridge = new MessageChannel();
        fake.deliver({ type: "webRTCBridgePort", port: bridge.port2 });

        expect(client.webRTCBridgePort).to.equal(bridge.port2);
    });

    it("leaves the bridge port undefined when the host never sends one", function () {
        const fake = makeFakeRuntimePort();
        const client = makeClient(fake.port);

        fake.deliver({ type: "ready" });

        expect(client.webRTCBridgePort).to.equal(undefined);
    });
});
