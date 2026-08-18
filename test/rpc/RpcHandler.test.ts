import { expect } from "chai";
import { Wallet } from "ethers";

import { RpcHandlerFixture } from "@test/fixtures/RpcHandlerFixture";

describe("RpcHandler", function () {
    let fixture: RpcHandlerFixture | undefined;

    afterEach(async function () {
        await fixture?.cleanup();
        fixture = undefined;
    });

    it("routes broadcast, compatible direct-transport, and loopback sends", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(3);

        await fixture
            .control(0)
            .rpcHandlerProbe.broadcastRecord("broadcast")
            .request();
        await fixture.waitForPingCount(1, "broadcast", 1);
        await fixture.waitForPingCount(2, "broadcast", 1);
        expect(await fixture.receivedPingNonces(0)).not.to.include("broadcast");

        await fixture
            .control(0)
            .rpcHandlerProbe.sendOneByCompatibleTransport(
                "compatible-transport",
                fixture.address(1)
            )
            .request();
        await fixture.waitForPingCount(1, "compatible-transport", 1);

        await fixture
            .control(0)
            .rpcHandlerProbe.sendOneLoopback("loopback")
            .request();
        await fixture.waitForPingCount(0, "loopback", 1);
    });

    it("routes transport and address lists while skipping empty and unresolved targets", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(3);
        const missingAddress = Wallet.createRandom().address;

        await fixture
            .control(0)
            .rpcHandlerProbe.sendMultipleByTransports("transport-list", [
                fixture.address(1),
                fixture.address(2)
            ])
            .request();
        await fixture.waitForPingCount(1, "transport-list", 1);
        await fixture.waitForPingCount(2, "transport-list", 1);
        expect(await fixture.receivedPingNonces(0)).not.to.include(
            "transport-list"
        );

        await fixture
            .control(0)
            .rpcHandlerProbe.sendMultipleByAddresses("address-list", [
                fixture.address(1),
                fixture.address(2)
            ])
            .request();
        await fixture.waitForPingCount(1, "address-list", 1);
        await fixture.waitForPingCount(2, "address-list", 1);
        expect(await fixture.receivedPingNonces(0)).not.to.include(
            "address-list"
        );

        await fixture
            .control(0)
            .rpcHandlerProbe.sendMultipleEmpty("empty-list")
            .request();
        await fixture
            .control(0)
            .rpcHandlerProbe.sendOneByAddress("missing-one", missingAddress)
            .request();
        expect(await fixture.receivedPingNonces(0)).not.to.include(
            "empty-list"
        );
        expect(await fixture.receivedPingNonces(1)).not.to.include(
            "empty-list"
        );
        expect(await fixture.receivedPingNonces(2)).not.to.include(
            "empty-list"
        );
        expect(await fixture.receivedPingNonces(0)).not.to.include(
            "missing-one"
        );
        expect(await fixture.receivedPingNonces(1)).not.to.include(
            "missing-one"
        );
        expect(await fixture.receivedPingNonces(2)).not.to.include(
            "missing-one"
        );

        await fixture
            .control(0)
            .rpcHandlerProbe.sendMultipleByAddresses("partial-list", [
                fixture.address(1),
                missingAddress,
                fixture.address(2)
            ])
            .request();
        await fixture.waitForPingCount(1, "partial-list", 1);
        await fixture.waitForPingCount(2, "partial-list", 1);
        expect(await fixture.receivedPingNonces(0)).not.to.include(
            "partial-list"
        );
    });

    it("routes compatible transport requests and rejects missing targets and loopback timeouts", async function () {
        fixture = new RpcHandlerFixture();
        await fixture.setup(2);

        const response = await fixture
            .control(0)
            .rpcHandlerProbe.requestSumByCompatibleTransport(
                20,
                22,
                "compatible-request",
                fixture.address(1)
            )
            .request();
        expect(response.sum).to.equal(42);
        expect(response.nonce).to.equal("compatible-request");

        const missingAddress = Wallet.createRandom().address;
        let missingError: unknown;
        try {
            await fixture
                .control(0)
                .rpcHandlerProbe.requestMissingAddress(missingAddress)
                .request();
        } catch (error) {
            missingError = error;
        }
        expect(missingError).to.be.instanceOf(Error);
        expect((missingError as Error).message).to.include(
            `RpcHandler.request: no open transport for target '${missingAddress}'`
        );

        let timeoutError: unknown;
        try {
            await fixture
                .control(0)
                .rpcHandlerProbe.requestLoopbackTimeout(25)
                .request();
        } catch (error) {
            timeoutError = error;
        }
        expect(timeoutError).to.be.instanceOf(Error);
        expect((timeoutError as Error).message).to.include(
            "RPC request 'pingService.never' timed out after 25ms"
        );
    });
});
