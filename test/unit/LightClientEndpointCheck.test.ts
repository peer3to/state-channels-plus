// @spec-test-coverage-ignore: checks of the test-owned light client fixture's endpoint check; the endpoint's behavior is not specified yet, no specification or implementation IDs apply
import { LIGHT_CLIENT_UNSUPPORTED } from "@test/fixtures/lightClient/LightClientNodeFixture";
import { lightClientEndpointCheckFailure } from "@test/fixtures/node/LightClientEndpointCheckFixture";
import { expect } from "chai";

describe("Light client endpoint check", function () {
    it("throws when the RPC node lists no light client endpoints", async function () {
        const failure = await lightClientEndpointCheckFailure(["eth_call"]);
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.equals(
                `${LIGHT_CLIENT_UNSUPPORTED}: lightClient_subscribeStorage, lightClient_unsubscribeStorage not listed`
            );
    });

    it("throws when the RPC node does not answer rpc_methods", async function () {
        const failure = await lightClientEndpointCheckFailure(undefined);
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.equals(
                `${LIGHT_CLIENT_UNSUPPORTED}: lightClient_subscribeStorage, lightClient_unsubscribeStorage not listed`
            );
    });

    it("names only the light client endpoint the RPC node does not list", async function () {
        const failure = await lightClientEndpointCheckFailure([
            "lightClient_subscribeStorage"
        ]);
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.equals(
                `${LIGHT_CLIENT_UNSUPPORTED}: lightClient_unsubscribeStorage not listed`
            );
    });

    it("passes when the RPC node lists both light client endpoints", async function () {
        const failure = await lightClientEndpointCheckFailure([
            "lightClient_subscribeStorage",
            "lightClient_unsubscribeStorage"
        ]);
        expect(failure).to.equal(undefined);
    });
});
