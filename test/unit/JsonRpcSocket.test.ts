// @spec-test-coverage-ignore: checks of a test-owned JSON-RPC client; not protocol behavior, no specification or implementation IDs apply
import {
    requestAfterClose,
    requestsOnDroppedSocket
} from "@test/fixtures/node/LightClientEndpointCheckFixture";
import { expect } from "chai";

describe("JsonRpcSocket", function () {
    it("fails a request in flight, and every later one, when the node drops the socket", async function () {
        const { inFlight, afterDrop } = await requestsOnDroppedSocket();
        expect(inFlight)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.matches(/closed with code \d+$/);
        expect(afterDrop).to.equal(inFlight);
    });

    it("fails a request made after the socket was closed", async function () {
        const failure = await requestAfterClose();
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.matches(/was closed$/);
    });
});
