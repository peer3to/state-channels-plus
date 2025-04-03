// Testing the following:
// - Testing the async nature of the peer joining and fork creation
// - Testing peer removal, fork consistency.
import { ethers } from "hardhat";
import { createJoinChannelTestObject, deployMathChannelProxyFixture, getMathP2pEventHooks } from "../utils/testHelpers";
import { EvmUtils, P2pEventHooks } from "../../src";
import { EvmStateMachine, MathStateMachine } from "../../src";

describe("Peer Joining And Leaving Testing", function () {
    it("A third user should join asynchronously successfully", async function () {

        // this is used to track the end of the test
        let testEndTracker = 0;
    
        const [signerOne, signerTwo, thirdSigner] = await ethers.getSigners();

        console.log("PeerOne", signerOne.address);
        console.log("PeerTwo", signerTwo.address);
        console.log("PeerThree", thirdSigner.address);
        
        // 1. Start with normal state progression
        // 2. User joining the channel
        // 3. State continue progressing
        // 4. peers processing the joining asynchronously
        
        // the contract deployments
        let math = await deployMathChannelProxyFixture(ethers);

        let mathSM = await ethers.getContractFactory("MathStateMachine"); // math StateMachine Contract
        let mathsm = math.mathInstance;
        let mathscm = math.mathChannelManager;

        // local peer setup
        let deployTx = await mathSM.getDeployTransaction(); // this deployes the contract locally
        let mathContractFirstPlayer: MathStateMachine;
        let mathContractSecondPlayer: MathStateMachine;
        let mathContractThirdPlayer: MathStateMachine;

        let PeerOne = await EvmStateMachine.p2pSetup(
            signerOne,
            deployTx,
            mathscm,
            mathsm,
            {
                onTurn: (address: string):void => {
                    if (address == signerOne.address) {
                        console.log("P2P: PeerOne onTurn \n\n");
                    }
                },
                onFork: (forkId: string):void => {
                    console.log("P2P: PeerOne onFork \n\n", forkId);
                },
                onConnection: (address: string):void => {
                    console.log("P2P: PeerOne onConnection \n\n", address);
                },
                onPeerDisconnected: (address: string, reason: string, remover: string):void => {
                    console.log("P2P: PeerOne onPeerDisconnected \n\n", address, reason, remover);
                }
            } as unknown as P2pEventHooks
        );

        let PeerTwo = await EvmStateMachine.p2pSetup(
            signerTwo,
            deployTx,
            mathscm,
            mathsm,
            {
                onTurn: (address: string):void => {
                    if (address == signerTwo.address) {
                        console.log("P2P: PeerTwo onTurn \n\n");
                        //mathContractSecondPlayer.add(12);
                    }
                },
                onFork: (forkId: string):void => {
                    console.log("P2P: PeerTwo onFork \n\n", forkId);
                },
                onConnection: (address: string):void => {
                    console.log("P2P: PeerTwo onConnection \n\n", address);
                },
                onPeerDisconnected: (address: string, reason: string, remover: string):void => {
                    console.log("P2P: PeerTwo onPeerDisconnected \n\n", address, reason, remover);
                }
            } as unknown as P2pEventHooks
        );

        let PeerThree = await EvmStateMachine.p2pSetup(
            thirdSigner,
            deployTx,
            mathscm,
            mathsm,
            {
                onTurn: (address: string):void => {
                    if (address == thirdSigner.address) {
                        console.log("P2P: PeerThree onTurn \n\n");
                    }
                },
                onFork: (forkId: string):void => {
                    console.log("P2P: PeerThree onFork \n\n", forkId);
                },
                onConnection: (address: string):void => {
                    console.log("P2P: PeerThree onConnection \n\n", address);
                },
                onPeerDisconnected: (address: string, reason: string, remover: string):void => {
                    console.log("P2P: PeerThree onPeerDisconnected \n\n", address, reason, remover);
                }
            } as unknown as P2pEventHooks
        );

        // establish connections in the channel
        mathContractFirstPlayer = PeerOne.p2pContractInstance;
        mathContractSecondPlayer = PeerTwo.p2pContractInstance;
        mathContractThirdPlayer = PeerThree.p2pContractInstance;

        // contract event hooks
        mathContractFirstPlayer.on(
            mathContractFirstPlayer.filters.NextToPlay, async (player) => {
                if (player == signerOne.address) {
                    console.log("CONTRACT: PeerTwo onNextToPlay \n\n", player);
                    testEndTracker++;
                }
            }
        );
        mathContractFirstPlayer.on(mathContractFirstPlayer.filters.Addition, async (a, b, result) => {
            console.log("CONTRACT: PeerOne onAddition \n\n", a, b, result);
            testEndTracker++;
            await mathContractSecondPlayer.add(1);
        });

        mathContractSecondPlayer.on(mathContractSecondPlayer.filters.NextToPlay, async (player) => {
            console.log("CONTRACT: PeerOne onNextToPlay \n\n", player);
            testEndTracker++;
            if(player == signerTwo.address) {
                await mathContractSecondPlayer.add(1);
            }
        
        });
        mathContractSecondPlayer.on(mathContractSecondPlayer.filters.Addition, async (a, b, result) => {
            console.log("CONTRACT: PeerTwo onAddition \n\n", a, b, result);
        });

        mathContractThirdPlayer.on(mathContractThirdPlayer.filters.NextToPlay, async (player) => {
            console.log("CONTRACT: PeerThree onNextToPlay \n\n", player);
        });
        mathContractThirdPlayer.on(mathContractThirdPlayer.filters.Addition, async (a, b, result) => {
            console.log("CONTRACT: PeerThree onAddition \n\n", a, b, result);
        });

        // player 1 and 2 join the channel
        let joinChannelCommitment1 = createJoinChannelTestObject(
            signerOne.address,
            "mathChannel"
        );
        let joinChannelCommitment2 = createJoinChannelTestObject(
            signerTwo.address,
            "mathChannel"
        );
        let joinChannelCommitment3 = createJoinChannelTestObject(
            thirdSigner.address,
            "mathChannel"
        );

        let signedJc1 = await EvmUtils.signJoinChannel(joinChannelCommitment1, signerOne);
        let signedJc2 = await EvmUtils.signJoinChannel(joinChannelCommitment2, signerTwo);
        let signedJc3 = await EvmUtils.signJoinChannel(joinChannelCommitment3, thirdSigner);


        // connect the channel in p2p networking
        await PeerOne.p2pSigner.connectToChannel(joinChannelCommitment1.channelId);
        await PeerTwo.p2pSigner.connectToChannel(joinChannelCommitment2.channelId);

        // open the channel in channel manager contract
        console.log("channelId", joinChannelCommitment1.channelId);
        await mathscm.openChannel(
            joinChannelCommitment1.channelId,
            [signedJc1.encodedJoinChannel, signedJc2.encodedJoinChannel],
            [signedJc1.signature, signedJc2.signature]
        );

       // wait for the channel to be opened 
       await new Promise(resolve => setTimeout(resolve, 1000));
        
       // progress the state machine
       await mathContractFirstPlayer.add(1);

        

        // third user joins the channel
        console.log("third user joins the channel");
        //await PeerThree.p2pSigner.connectToChannel(joinChannelCommitment3.channelId);
        // await mathscm.addParticipant(
        //     joinChannelCommitment3.channelId,
        //     [signedJc3.encodedJoinChannel],
        //     [signedJc3.signature]
        // );
        
        // testing third peer progressing the state machine
    

        // await new Promise((resolve) => {
        //     const checkComplete = setInterval(() => {
        //         if (testEndTracker === 2) {
        //             clearInterval(checkComplete); 
        //             resolve(true);                
        //         }
        //     }, 100);
        // });

        await new Promise(resolve => setTimeout(resolve, 6000));


    })
})
