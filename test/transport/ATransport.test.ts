import { expect } from "chai";
import { Wallet } from "ethers";

import { RpcHandlerFixture } from "@test/fixtures/RpcHandlerFixture";

describe("ATransport", function () {
    let fixture: RpcHandlerFixture | undefined;

    afterEach(async function () {
        await fixture?.cleanup();
        fixture = undefined;
    });

    it("compares peer identities across address boundaries and transport replacement", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(2);

        const result = await fixture
            .control(0)
            .aTransportProbe.probeIdentity(
                fixture.address(0),
                Wallet.createRandom().address
            )
            .request();

        expect(result).to.deep.equal({
            sameReferenceWithoutAddress: true,
            distinctWithoutAddresses: false,
            oneAddressMissing: false,
            sameAddressDifferentCase: true,
            differentAddresses: false,
            replacementTransportType: true,
            baseTransportTrusted: false,
            loopbackTransportTrusted: true
        });
    });

    it("serializes RPC calls and responses before delegating to the concrete sender", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(2);

        const rpc = {
            service: "pingService",
            method: "recordPing",
            params: ["serialized"]
        };
        const response = {
            rpcResponse: true as const,
            requestId: "request-1",
            ok: true,
            result: { accepted: true }
        };
        const result = await fixture
            .control(0)
            .aTransportProbe.probeDelivery(rpc, response)
            .request();

        expect(JSON.parse(result.serializedRpc)).to.deep.equal(rpc);
        expect(JSON.parse(result.serializedResponse)).to.deep.equal(response);
    });

    it("closes an unexpected disconnection once and emits its lifecycle event once", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(2);

        const result = await fixture
            .control(0)
            .aTransportProbe.probeClose(
                Wallet.createRandom().address,
                false,
                true
            )
            .request();

        expect(result).to.deep.equal({
            isClosed: true,
            connectionPresentAfterClose: false,
            disconnectCalls: 1,
            disconnectionEvents: 1,
            concreteCloseCalls: 1
        });
    });

    it("closes an expected disconnection without emitting an unexpected-disconnect event", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(2);

        const result = await fixture
            .control(0)
            .aTransportProbe.probeClose(
                Wallet.createRandom().address,
                true,
                false
            )
            .request();

        expect(result).to.deep.equal({
            isClosed: true,
            connectionPresentAfterClose: false,
            disconnectCalls: 1,
            disconnectionEvents: 0,
            concreteCloseCalls: 1
        });
    });

    it("propagates serialization and concrete-send failures", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(2);

        const result = await fixture
            .control(0)
            .aTransportProbe.probeFailures()
            .request();

        expect(result.serializationErrorPropagated).to.equal(true);
        expect(result.sendErrorMessage).to.equal(
            "recording transport send failed"
        );
    });
});
