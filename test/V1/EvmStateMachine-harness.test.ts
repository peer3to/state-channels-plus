import { ethers } from "hardhat";
import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types/index";

describe("EvmStateMachine (Harness Version)", function () {
    it("EvmStateMachine - P2P simulation - success (with harness)", async function () {
        // Setup harness with 2 peers
        const harness = new PeerTestHarness<MathStateMachine>();
        await harness.setup(2, ethers, { debug: true });

        console.log("Establishing connection");

        // Use harness to open channel (includes connection setup and on-chain opening)
        await harness.openChannel();

        console.log("Connection established");

        // Setup genesis state using harness method
        const forkId = await harness.setupGenesisState();

        //start the p2p state machine
        await harness.submitTransaction(0, async (contract) => {
            return await contract.add(3);
        });

        // sleep for 500ms to allow synchronization
        await new Promise((resolve) => setTimeout(resolve, 500));

        // ============================
        // SYNCHRONIZATION VERIFICATION
        // ============================

        const stateManager1 = harness.peers[0].stateManager;
        const stateManager2 = harness.peers[1].stateManager;

        expect(stateManager1.channelId).to.equal(
            stateManager2.channelId,
            "Peers should have matching channel IDs"
        );

        expect(stateManager1.forkId).to.equal(
            stateManager2.forkId,
            "Peers should have matching fork IDs"
        );

        // Get latest blocks from both peers
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
            "Peer 1 and 2 should have the same latest block hash"
        );

        // Get next heights to see if they processed transactions
        const nextHeight1 =
            stateManager1.storage.blocks.getNextBlockHeight(forkId);
        const nextHeight2 =
            stateManager2.storage.blocks.getNextBlockHeight(forkId);
        expect(nextHeight1).to.equal(
            nextHeight2,
            "Peer 1 and 2 should have the same next block height"
        );

        // Cleanup
        await harness.cleanup();
    });
});
