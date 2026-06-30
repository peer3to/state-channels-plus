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

describe("P2pRuntimeClient contract events", function () {
    const EVENT_ABI = JSON.stringify([
        {
            type: "event",
            name: "ValueChanged",
            anonymous: false,
            inputs: [{ name: "value", type: "uint256", indexed: false }]
        }
    ]);

    function makeClientWithEvents(port: RuntimePort): P2pRuntimeClient {
        return new P2pRuntimeClient(port, {
            signerAddress: "0x0000000000000000000000000000000000000001",
            stateMachine: {
                address: "0x0000000000000000000000000000000000000002",
                abiJson: EVENT_ABI
            }
        });
    }

    it("delivers host-forwarded contract events to a .on subscriber", async function () {
        const fake = makeFakeRuntimePort();
        const client = makeClientWithEvents(fake.port);
        const contract = client.contract;

        const received: bigint[] = [];
        // Mirrors the app: subscribe through the main-thread contract whose
        // runner is the provider-less ClientP2pSigner. Without an event-capable
        // provider, ethers rejects this `on(...)` ("contract runner does not
        // support subscribing") and the subscription never registers, so the
        // forwarded event below would reach no listener.
        await contract.on(contract.filters.ValueChanged(), (value: bigint) => {
            received.push(value);
        });

        // The host detected a contract event and forwarded it over the port;
        // dispatchContractEvent re-emits it on the main-thread contract.
        fake.deliver({
            type: "contractEvent",
            name: "ValueChanged",
            args: [42n]
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(received).to.deep.equal([42n]);
    });
});
