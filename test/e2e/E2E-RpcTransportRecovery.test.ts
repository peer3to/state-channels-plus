import { assertPeerRpcRecovery } from "@test/fixtures/node/PeerRpcRecoveryFixture";

describe("RPC transport recovery", () => {
    it("rejects a foreign response retires the original transport and serves a reconnected peer", async () => {
        await assertPeerRpcRecovery();
    });
});
