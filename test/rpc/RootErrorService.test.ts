import { assertUnobservedClientError } from "@test/fixtures/node/ClientUnhandledErrorFixture";
import { assertEarlyRootError } from "@test/fixtures/RootBoundaryFixture";
import {
    assertHostRpcSelectors,
    assertNotificationErrorReported,
    assertRootErrorForwarding,
    assertErrorDirection,
    assertRequestErrorNotReported
} from "@test/fixtures/RootErrorFixture";

describe("RootErrorService", () => {
    it("rejects unknown host RPC services and unsupported delivery selectors", async () => {
        await assertHostRpcSelectors();
    });
    it("surfaces a client host error as an unhandled rejection when no listener exists", async () => {
        await assertUnobservedClientError();
    });
    it("reports a fire-and-forget endpoint failure once without closing the root", async () => {
        await assertNotificationErrorReported();
    });
    it("rejects readiness when a child reports an error before ready", async () => {
        await assertEarlyRootError(false);
    });
    it("rejects readiness through the startupFailed wire endpoint", async () => {
        await assertEarlyRootError(true);
    });
    it("rejects an error report from a parent without closing the connection", async () => {
        await assertErrorDirection();
    });
    it("forwards a child error once through an inline SDK and keeps both roots usable", async () => {
        await assertRootErrorForwarding(true);
    });
    it("forwards a child error once through a worker SDK and keeps both roots usable", async () => {
        await assertRootErrorForwarding(false);
    });
    it("returns an inline child request failure without an autonomous report", async () => {
        await assertRequestErrorNotReported(true);
    });
    it("returns a worker child request failure without an autonomous report", async () => {
        await assertRequestErrorNotReported(false);
    });
});
