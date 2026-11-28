// @distributed-requires: lightClient
// @spec-test-coverage-ignore: checks of the test-owned light client node fixture; no specification or implementation IDs apply
import {
    assertLightClientEndpoints,
    LIGHT_CLIENT_UNSUPPORTED,
    LightClientNodeFixture
} from "@test/fixtures/lightClient/LightClientNodeFixture";
import { JsonRpcSocket } from "@test/fixtures/lightClient/node/JsonRpcSocket";
import { withPeer3NodeBin } from "@test/fixtures/node/Peer3NodeLauncherFixture";
import { rejectionOf } from "@test/utils/rejectionOf";
import { expect } from "chai";

/** A node binary path that names no file. */
const MISSING_NODE_BIN = "/nonexistent/zero-fee-node";

describe("Light client endpoints", function () {
    let node: LightClientNodeFixture | undefined;

    afterEach(async function () {
        await node?.stop();
        node = undefined;
    });

    it("throws at once when the peer3 node binary cannot be found", async function () {
        const failure = await withPeer3NodeBin(MISSING_NODE_BIN, () =>
            rejectionOf(LightClientNodeFixture.start())
        );
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.includes(LIGHT_CLIENT_UNSUPPORTED);
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
