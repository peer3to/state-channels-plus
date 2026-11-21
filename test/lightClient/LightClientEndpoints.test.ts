// @distributed-requires: lightClient
// @spec-test-coverage-ignore: checks of the test-owned light client node fixture; no specification or implementation IDs apply
import { JsonRpcSocket } from "@test/fixtures/lightClient/JsonRpcSocket";
import {
    assertLightClientEndpoints,
    LIGHT_CLIENT_UNSUPPORTED,
    LightClientNodeFixture
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { rejectionOf } from "@test/utils/rejectionOf";
import { expect } from "chai";

describe("Light client endpoints", function () {
    let node: LightClientNodeFixture | undefined;

    afterEach(async function () {
        await node?.stop();
        node = undefined;
    });

    it("throws at once when no peer3 node binary is named", async function () {
        const nodeBin = process.env.PEER3_NODE_BIN;
        delete process.env.PEER3_NODE_BIN;
        try {
            const failure = await rejectionOf(LightClientNodeFixture.start());
            expect(failure)
                .to.be.instanceOf(Error)
                .with.property("message")
                .that.includes(LIGHT_CLIENT_UNSUPPORTED);
        } finally {
            if (nodeBin !== undefined) process.env.PEER3_NODE_BIN = nodeBin;
        }
    });

    it("throws when the RPC node lists no light client endpoints", async function () {
        node = await LightClientNodeFixture.start();
        const proxy = await node.proxyToNode();
        proxy.answerRequests("rpc_methods", { methods: ["eth_call"] });
        const socket = await JsonRpcSocket.open(proxy.url);
        try {
            const failure = await rejectionOf(
                assertLightClientEndpoints(socket)
            );
            expect(failure)
                .to.be.instanceOf(Error)
                .with.property("message")
                .that.includes(LIGHT_CLIENT_UNSUPPORTED);
        } finally {
            socket.close();
        }
    });

    it("connects to a node that lists the light client endpoints", async function () {
        node = await LightClientNodeFixture.start();
        const connection = await node.connect();
        expect(await connection.request("eth_chainId")).to.match(/^0x/);
    });
});
