import {
    ApplicationHostRootE2EFixture,
    PEER_DISCONNECTED_ERROR
} from "@test/fixtures/hostRoot/ApplicationHostRootE2EFixture";
import { expect } from "chai";

describe("E2E: ApplicationHostRoot", function () {
    let fixture: ApplicationHostRootE2EFixture;

    beforeEach(function () {
        fixture = new ApplicationHostRootE2EFixture();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("a peer's client calls its host root service", async function () {
        await fixture.setup(2);
        const [first, second] = fixture.harness.peers;

        expect(
            await fixture.host(first).probe.echo("first").request()
        ).to.deep.equal({ value: "first", signerAddress: first.address });
        expect(
            await fixture.host(second).probe.echo("second").request()
        ).to.deep.equal({ value: "second", signerAddress: second.address });
        // Each client reached only its own runtime.
        expect(
            await fixture.host(first).probe.getEchoes().request()
        ).to.deep.equal(["first"]);
        expect(
            await fixture.host(second).probe.getEchoes().request()
        ).to.deep.equal(["second"]);
    });

    it("a peer's network call to the service finds no network service and has no effect", async function () {
        await fixture.setup(2);
        const [receiver, caller] = fixture.harness.peers;

        const outcome = await fixture.networkProbeEchoOutcome(
            caller,
            receiver,
            "remote"
        );

        // No network service answers: the receiver refuses the dispatch and
        // disconnects the caller instead of replying.
        expect(outcome).to.deep.equal({
            ok: false,
            error: PEER_DISCONNECTED_ERROR
        });
        await fixture.expectDisconnected(receiver, caller);
        expect(
            await fixture.host(receiver).probe.getEchoes().request()
        ).to.deep.equal([]);
    });
});
