import { assertUnauthenticatedTransportCleanup } from "@test/fixtures/NetworkRpcRouterFixture";
import {
    assertInternalClosedAdmission,
    assertNetworkByteForwarding,
    assertNetworkRouterOwnership
} from "@test/fixtures/NetworkRpcRouterFixture";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { expect } from "chai";

describe("NetworkRpcRouter", () => {
    it("closes registered unauthenticated transports when its manager is disposed", async () => {
        await assertUnauthenticatedTransportCleanup();
    });
    it("gives the real SDK manager one router shared by services and loopback", async () => {
        await assertNetworkRouterOwnership();
    });
    it("converts WebRTC strings Buffer and Uint8Array before router ingress", async () => {
        await assertNetworkByteForwarding(false);
    });
    it("keeps network receive-after-close admission unchanged", async () => {
        await assertNetworkByteForwarding(true);
    });
    it("ignores internal messages after close at both receive entry points", async () => {
        await assertInternalClosedAdmission();
    });
});

/**
 * Maps to: src/rpc/router/ARpcRouter.ts
 *
 * Every rejection the router produces carries the kind of failure, so a caller
 * branches on it instead of matching message text. A transport close rejects
 * with the reason its caller supplied, so the kind is read back from the
 * router rather than written onto that error.
 */
describe("NetworkRpcRouter request failure causes", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("tags each failure kind and rejects a transport close with the supplied reason", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeRequestFailureCauses()
            .request();

        expect(result).to.deep.equal({
            timeoutCause: "request-timeout",
            remoteErrorCause: "remote-error",
            transportClosedCause: "transport-closed",
            transportClosedReasonIsSupplied: true,
            sendFailedCause: "send-failed",
            pendingCount: 0,
            timerCount: 0
        });
    });
});
