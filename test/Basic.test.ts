import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";

describe("Basic P2P Simulation", function () {
    it("should successfully transtion a single block between 2 peers", async function () {
        const harness = new PeerTestHarness<MathStateMachine>();
        await harness.setup(2);
        const forkId = await harness.openChannel();

        await harness.submitNextTransaction((contract) => contract.add(3));

        const stateManager1 = harness.peers[0].stateManager;
        const stateManager2 = harness.peers[1].stateManager;

        expect(stateManager1.channelId).to.equal(stateManager2.channelId);
        expect(stateManager1.forkId).to.equal(stateManager2.forkId);

        const latestBlock1 =
            stateManager1.storage.blocks.getLatestBlock(forkId);
        const latestBlock2 =
            stateManager2.storage.blocks.getLatestBlock(forkId);

        expect(latestBlock1).to.not.equal(
            undefined,
            "Peer 1 should have a latest block"
        );
        expect(latestBlock2).to.not.equal(
            undefined,
            "Peer 2 should have a latest block"
        );
        expect(latestBlock1?.hash).to.equal(
            latestBlock2?.hash,
            "Peers should have same block hash"
        );

        await harness.cleanup();
    });
});
