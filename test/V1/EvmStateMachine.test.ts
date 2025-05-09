import { ethers as hre } from "hardhat";
import { BigNumberish } from "ethers";
import { EvmStateMachine } from "@/evm";
import { MathStateMachine } from "@typechain-types";
import {
    createJoinChannelTestObject,
    deployMathChannelProxyFixture,
    getMathP2pEventHooks
} from "@test/utils/testHelpers";
import P2pEventHooks from "@/P2pEventHooks";
import { EvmUtils } from "@/utils";

describe("EvmStateMachine", function () {
    it("EvmStateMachine - P2P simulation - success", async function () {
        let signerOne = (await hre.getSigners())[0];
        let signerTwo = (await hre.getSigners())[1];

        let math = await deployMathChannelProxyFixture(hre);

        let mathSM = await hre.getContractFactory("MathStateMachine");
        let mathsm = math.mathInstance;

        let mathscm = math.mathChannelManager;

        //P2P setup;
        let deployTx = await mathSM.getDeployTransaction(); // this deployes the contract locally
        let mathContractFirstPlayer: MathStateMachine;
        let mathContractSecondPlayer: MathStateMachine;

        let p2pOne = await EvmStateMachine.p2pSetup(
            signerOne,
            deployTx,
            mathscm,
            mathsm,
            {
                ...getMathP2pEventHooks(() => {}, await signerOne.getAddress())
            } as unknown as P2pEventHooks
        );

        let p2pTwo = await EvmStateMachine.p2pSetup(
            signerTwo,
            deployTx,
            mathscm,
            mathsm,
            {
                ...getMathP2pEventHooks(() => {}, await signerTwo.getAddress())
            } as unknown as P2pEventHooks
        );
        mathContractFirstPlayer = p2pOne.p2pContractInstance;
        mathContractSecondPlayer = p2pTwo.p2pContractInstance;

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
        let joinChannelCommitment1 = createJoinChannelTestObject(
            signerOne.address
        );
        let joinChannelCommitment2 = createJoinChannelTestObject(
            signerTwo.address
        );

        let jc1Signed = await EvmUtils.signJoinChannel(
            joinChannelCommitment1,
            signerOne
        );
        let jc2Signed = await EvmUtils.signJoinChannel(
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
            [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
            [jc1Signed.signature, jc2Signed.signature]
        );
        console.log(`Tx hash:${re.hash}`);

        // sleep for 2 seconds - should be enough for the SM to pickup the channel open event and initiate
        await new Promise((resolve) => setTimeout(resolve, 1000));

        //start the p2p state machine
        await mathContractFirstPlayer.add(3);

        // sleep for 10 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));
    });
});
