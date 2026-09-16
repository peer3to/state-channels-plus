import { assertUnauthenticatedTransportCleanup } from "@test/fixtures/NetworkRpcRouterFixture";
import {
    assertInternalClosedAdmission,
    assertNetworkByteForwarding,
    assertNetworkRouterOwnership
} from "@test/fixtures/NetworkRpcRouterFixture";

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
