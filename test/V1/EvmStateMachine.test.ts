import { ethers, ethers as hre } from "hardhat";
import { BigNumberish } from "ethers";
import { EvmStateMachine } from "@/evm";
import { Codec, Type } from "@/utils/Codec";
import { StateSnapshot } from "@/models";

import {
    createJoinChannelTestObject,
    deployMathChannelProxyFixture,
    getMathP2pEventHooks
} from "@test/test_utils/testHelpers";
import P2pEventHooks from "@/P2pEventHooks";
import { hash, SignatureUtils } from "@/utils";
import { Bytes } from "@/types/types";

describe("EvmStateMachine", function () {
    it("EvmStateMachine - P2P simulation - success", async function () {
        const signerOne = (await hre.getSigners())[0];
        const signerTwo = (await hre.getSigners())[1];

        const math = await deployMathChannelProxyFixture(hre);

        const mathSM = await hre.getContractFactory("MathStateMachine");
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
                //sleep 1 second
                if (signerOne.address != player) return;
                await new Promise((resolve) => setTimeout(resolve, 1000));
                if (player === signerOne.address) {
                    mathContractFirstPlayer.add(3);
                } else {
                    mathContractSecondPlayer.add(5);
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
                //sleep 1 second
                if (signerTwo.address != player) return;
                await new Promise((resolve) => setTimeout(resolve, 1000));
                if (player === signerOne.address) {
                    mathContractFirstPlayer.add(3);
                } else {
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

        // sleep for 2 seconds - should be enough for the SM to pickup the channel open event and initiate
        await new Promise((resolve) => setTimeout(resolve, 1000));

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
        const timestamp = Math.floor(Date.now() / 1000);

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

        await p2pOne.p2pSigner.p2pManager.stateManager.setState(
            genesisStateEncoded,
            forkId,
            timestamp
        );
        await p2pTwo.p2pSigner.p2pManager.stateManager.setState(
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

        // Store the corresponding encoded state machine state
        p2pOne.p2pSigner.p2pManager.stateManager.storage.stateMachineStates.storeStateMachineState(
            genesisStateEncoded,
            { hash: stateMachineStateHash }
        );
        p2pTwo.p2pSigner.p2pManager.stateManager.storage.stateMachineStates.storeStateMachineState(
            genesisStateEncoded,
            { hash: stateMachineStateHash }
        );

        // ===============================================
        //  End of ugly ugly work around
        // ===============================================

        //start the p2p state machine
        await mathContractFirstPlayer.add(3);

        // sleep for 10 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));
    });
});
