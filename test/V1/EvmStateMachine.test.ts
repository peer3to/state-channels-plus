import { ethers } from "hardhat";
import { BigNumberish } from "ethers";
import { EvmStateMachine } from "@/evm";
import { Codec, Type } from "@/utils/Codec";
import { StateSnapshot } from "@/models";
import { expect } from "chai";
import Clock from "@/Clock";

import {
    createJoinChannelTestObject,
    deployMathChannelProxyFixture,
    getMathP2pEventHooks
} from "@test/test_utils/testHelpers";
import P2pEventHooks from "@/P2pEventHooks";
import { hash, SignatureUtils } from "@/utils";
import { Bytes } from "@/types/types";
import { waitForP2PConnections, waitForStateSync } from "../utils/waitFor";
import { sleep } from "@test/fixtures/PeerTestHarness";

describe("EvmStateMachine", function () {
    it("EvmStateMachine - P2P simulation - success", async function () {
        const signerOne = (await ethers.getSigners())[0];
        const signerTwo = (await ethers.getSigners())[1];

        const math = await deployMathChannelProxyFixture(ethers);

        const mathSM = await ethers.getContractFactory("MathStateMachine");
        const mathsm = math.mathInstance;

        const mathscm = math.mathChannelManager;

        //P2P setup;
        const deployTx = await mathSM.getDeployTransaction(500000); // this deployes the contract locally

        const p2pOne = await EvmStateMachine.p2pSetup(
            signerOne,
            deployTx,
            mathscm,
            mathsm,
            {
                ...getMathP2pEventHooks(() => {}, await signerOne.getAddress())
            } as unknown as P2pEventHooks
        );

        const p2pTwo = await EvmStateMachine.p2pSetup(
            signerTwo,
            deployTx,
            mathscm,
            mathsm,
            {
                ...getMathP2pEventHooks(() => {}, await signerTwo.getAddress())
            } as unknown as P2pEventHooks
        );
        const mathContractFirstPlayer = p2pOne.p2pContractInstance;
        const mathContractSecondPlayer = p2pTwo.p2pContractInstance;

        mathContractFirstPlayer.on(
            mathContractFirstPlayer.filters.Addition,
            (a: BigNumberish, b: BigNumberish, sum: BigNumberish) => {
                console.log(a, " + ", b, " = ", sum);
            }
        );
        mathContractFirstPlayer.on(
            mathContractFirstPlayer.filters.NextToPlay,
            async (player) => {
                console.log("Next to play ", player);
                if (player === signerOne.address) {
                    mathContractFirstPlayer.add(3);
                }
            }
        );
        mathContractSecondPlayer.on(
            mathContractSecondPlayer.filters.Addition,
            (a, b, sum) => {
                console.log(a, " + ", b, " = ", sum);
            }
        );

        mathContractSecondPlayer.on(
            mathContractSecondPlayer.filters.NextToPlay,
            async (player) => {
                console.log("Next to play ", player);
                if (player === signerTwo.address) {
                    mathContractSecondPlayer.add(5);
                }
            }
        );

        //P2P disovery/matchamking (this is not done here - just the end result)
        const joinChannelCommitment1 = createJoinChannelTestObject(
            signerOne.address
        );
        const joinChannelCommitment2 = createJoinChannelTestObject(
            signerTwo.address
        );

        const jc1Signed = await SignatureUtils.signJoinChannel(
            joinChannelCommitment1,
            signerOne
        );
        const jc2Signed = await SignatureUtils.signJoinChannel(
            joinChannelCommitment2,
            signerTwo
        );

        console.log("Establishing connection");

        p2pOne.p2pSigner.connectToChannel(joinChannelCommitment1.channelId);
        await p2pTwo.p2pSigner.connectToChannel(
            joinChannelCommitment2.channelId
        );
        console.log("Connection established");
        //on-chain open the channel
        const re = await mathscm.openChannel(
            joinChannelCommitment1.channelId,
            [jc1Signed.encoded, jc2Signed.encoded],
            [jc1Signed.signature as Bytes, jc2Signed.signature as Bytes]
        );
        console.log(`Tx hash:${re.hash}`);
        // Wait for P2P connections to be established
        await waitForP2PConnections(p2pOne, p2pTwo, 500);

        await sleep(50); // Give connections time to establish

        // ============================
        //  Ugly Ugly work around to make the test pass by setting genesis snapshot manually

        // TODO: remove when https://trello.com/c/u4NqFBlJ is done
        // ============================
        const genesisState = {
            number: 0,
            participants: [signerOne.address, signerTwo.address],
            balances: [500, 500]
        };
        const genesisStateEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "address[]", "uint256[]"],
            [
                genesisState.number,
                genesisState.participants,
                genesisState.balances
            ]
        );

        const stateMachineStateHash = hash(genesisStateEncoded);
        const timestamp = Clock.getTimeInSeconds();

        const genesisSnapshotData = {
            originForkId:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            stateMachineStateHash: stateMachineStateHash,
            participants: [signerOne.address, signerTwo.address],
            latestJoinChannelBlockHash:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            latestExitChannelBlockHash:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
            totalDeposits: { amount: 1000, data: "0x00" },
            totalWithdrawals: { amount: 0, data: "0x00" }
        };

        const snapshotDataEncoded = Codec.encode(
            genesisSnapshotData,
            Type.SnapshotData
        );
        const forkId = hash(snapshotDataEncoded);

        const genesisSnapshot = {
            forkId: forkId,
            blockHeight: BigInt(0),
            timestamp: timestamp,
            snapshotData: genesisSnapshotData
        };

        await p2pOne.p2pSigner.p2pManager.stateManager.setGenesisState(
            genesisSnapshotData,
            genesisStateEncoded,
            forkId,
            timestamp
        );
        await p2pTwo.p2pSigner.p2pManager.stateManager.setGenesisState(
            genesisSnapshotData,
            genesisStateEncoded,
            forkId,
            timestamp
        );

        // Store the genesis state snapshot in both P2P instances
        const stateSnapshot = StateSnapshot.from(genesisSnapshot);
        p2pOne.p2pSigner.p2pManager.stateManager.storage.stateSnapshots.storeStateSnapshot(
            stateSnapshot
        );
        p2pTwo.p2pSigner.p2pManager.stateManager.storage.stateSnapshots.storeStateSnapshot(
            stateSnapshot
        );
        // ===============================================
        //  End of ugly ugly work around
        // ===============================================
        await mathContractFirstPlayer.add(3);

        const stateManager1 = p2pOne.p2pSigner.p2pManager.stateManager;
        const stateManager2 = p2pTwo.p2pSigner.p2pManager.stateManager;

        await waitForStateSync(stateManager1, stateManager2, 1500);

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
});
