import { ethers } from "hardhat";
import { EvmStateMachine, P2pInstance } from "@/evm";
import { expect } from "chai";

import {
    createOpenChannelTestObject,
    deployMathChannelProxyFixture,
    getMathP2pEventHooks
} from "@test/test_utils/testHelpers";
import P2pEventHooks from "@/P2pEventHooks";
import { SignatureUtils } from "@/utils";
import { Bytes } from "@/types/types";
import { waitForStateSync } from "../utils/waitFor";
import { sleep } from "@test/fixtures/PeerTestHarness";
import {
    MathStateChannelManagerProxy,
    MathStateMachine
} from "@typechain-types/index";
import { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import StateManager from "@/stateManager";

describe("EvmStateMachine", function () {
    // Only keep what we actually need to access later
    let signerOne: HardhatEthersSigner, signerTwo: HardhatEthersSigner;
    let p2pOne: P2pInstance<MathStateMachine>,
        p2pTwo: P2pInstance<MathStateMachine>;
    let mathscm: MathStateChannelManagerProxy;
    let openChannel: OpenChannelStruct;
    let stateManager1: StateManager, stateManager2: StateManager;

    before(async function () {
        // Get signers
        signerOne = (await ethers.getSigners())[0];
        signerTwo = (await ethers.getSigners())[1];

        // Deploy contracts
        const math = await deployMathChannelProxyFixture(ethers);
        const mathSM = await ethers.getContractFactory("MathStateMachine");
        const mathsm = math.mathInstance;
        mathscm = math.mathChannelManager;

        // Create deploy transaction
        const deployTx = await mathSM.getDeployTransaction(500000);

        // Setup P2P instances
        p2pOne = await EvmStateMachine.p2pSetup(
            signerOne,
            deployTx,
            mathscm,
            mathsm,
            {
                ...getMathP2pEventHooks(() => {}, await signerOne.getAddress())
            } as unknown as P2pEventHooks
        );

        p2pTwo = await EvmStateMachine.p2pSetup(
            signerTwo,
            deployTx,
            mathscm,
            mathsm,
            {
                ...getMathP2pEventHooks(() => {}, await signerTwo.getAddress())
            } as unknown as P2pEventHooks
        );
        stateManager1 = p2pOne.p2pSigner.p2pManager.stateManager;
        stateManager2 = p2pTwo.p2pSigner.p2pManager.stateManager;

        // Create open channel object
        openChannel = createOpenChannelTestObject([
            signerOne.address,
            signerTwo.address
        ]);
    });

    after(async function () {
        // Cleanup
        try {
            await p2pOne.p2pSigner.p2pManager.stateManager.dispose();
            await p2pTwo.p2pSigner.p2pManager.stateManager.dispose();
            const { LocalDiscoveryServer } = await import(
                "@/utils/LocalDiscoveryServer"
            );
            LocalDiscoveryServer.cleanup();
        } catch (error) {
            console.warn("Error during cleanup:", error);
        }
    });

    it("EvmStateMachine - P2P simulation - success", async function () {
        await Promise.all([
            p2pOne.p2pSigner.connectToChannel(openChannel.channelId),
            p2pTwo.p2pSigner.connectToChannel(openChannel.channelId)
        ]);

        const signaturesOverOpenChannel = await Promise.all([
            SignatureUtils.signOpenChannel(openChannel, signerOne),
            SignatureUtils.signOpenChannel(openChannel, signerTwo)
        ]);
        const openChannelConfirmation = {
            encodedOpenChannel: signaturesOverOpenChannel[0].encoded,
            signatures: signaturesOverOpenChannel.map(
                (s) => s.signature as Bytes
            )
        };

        // On-chain open the channel
        const re = await mathscm.open(openChannelConfirmation);
        // sleep needed in order to allow P2P connections to be established
        await Promise.all([re.wait(), sleep(100)]);

        await p2pOne.p2pContractInstance.add(3);

        // Wait for state synchronization
        await waitForStateSync(stateManager1, stateManager2, 2000);

        // Assertions
        expect(stateManager1.channelId).to.equal(
            stateManager2.channelId,
            "Peers should have matching channel IDs"
        );

        expect(stateManager1.forkId).to.equal(
            stateManager2.forkId,
            "Peers should have matching fork IDs"
        );

        // Get latest blocks from both peers
        const latestBlock1 = stateManager1.storage.blocks.getLatestBlock(
            stateManager1.forkId
        );
        const latestBlock2 = stateManager2.storage.blocks.getLatestBlock(
            stateManager2.forkId
        );

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
        const nextHeight1 = stateManager1.storage.blocks.getNextBlockHeight(
            stateManager1.forkId
        );
        const nextHeight2 = stateManager2.storage.blocks.getNextBlockHeight(
            stateManager2.forkId
        );
        expect(nextHeight1).to.equal(
            nextHeight2,
            "Peer 1 and 2 should have the same next block height"
        );
    });
});
