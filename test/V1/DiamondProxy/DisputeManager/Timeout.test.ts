import { ethers } from "hardhat";
import {
    createJoinChannelTestObject,
    deployMathChannelProxyFixture,
    getMathDeploymentTransaction,
    getMathP2pEventHooks
} from "@test/utils/testHelpers";
import EvmUtils from "@/utils/EvmUtils";
import { P2pInstance, EvmStateMachine } from "@/evm";
import BarrierLocal from "@/utils/BarrierLocal";
import {
    MathStateChannelManagerProxy,
    MathStateMachine
} from "@typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("DisputeManagerProxy", function () {
    // We define a fixture to reuse the same setup in every test. We use
    // loadFixture to run this setup once, snapshot that state, and reset Hardhat
    // Network to that snapshot in every test.

    async function getSigners() {
        const signers = await ethers.getSigners();
        let firstSigner = signers[0];
        let secondSigner = signers[1];
        let thirdSigner = signers[2];
        return { firstSigner, secondSigner, thirdSigner, signers };
    }
    let snapshotId: string;
    let barrier: BarrierLocal;
    let mathChannelManager: MathStateChannelManagerProxy;
    let mathInstance: MathStateMachine;
    let firstSigner: HardhatEthersSigner;
    let secondSigner: HardhatEthersSigner;
    let p2p1: P2pInstance<MathStateMachine>;
    let p2p2: P2pInstance<MathStateMachine>;
    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);
        barrier = BarrierLocal.createNewInstance();
        const contracts = await deployMathChannelProxyFixture(ethers);
        mathChannelManager = contracts.mathChannelManager;
        mathInstance = contracts.mathInstance;
        let signers = await getSigners();
        firstSigner = signers.firstSigner;
        secondSigner = signers.secondSigner;
        let deplymentTx = await getMathDeploymentTransaction(ethers);
        p2p1 = await EvmStateMachine.p2pSetup(
            firstSigner,
            deplymentTx,
            mathChannelManager,
            mathInstance
        );
        p2p2 = await EvmStateMachine.p2pSetup(
            secondSigner,
            deplymentTx,
            mathChannelManager,
            mathInstance
        );
    });
    afterEach(async function () {
        // Revert to the snapshot after each test
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    describe("Timeout", function () {
        it("Timeout - transaction 0", async function () {
            p2p1.setHooks(
                getMathP2pEventHooks(
                    () => {
                        console.log("p2p 1 - BarrierLocal.allowOne()");
                        barrier.allowOne();
                    },
                    await firstSigner.getAddress()
                )
            );
            p2p2.setHooks(
                getMathP2pEventHooks(
                    () => {
                        console.log("p2p 2 - BarrierLocal.allowOne()");
                        barrier.allowOne();
                    },
                    await secondSigner.getAddress()
                )
            );

            let channelId = Math.random().toString();
            let jc1 = createJoinChannelTestObject(
                firstSigner.address,
                channelId
            );
            let jc2 = createJoinChannelTestObject(
                secondSigner.address,
                channelId
            );

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            p2p1.p2pSigner.setChannelId(jc1.channelId);
            p2p2.p2pSigner.setChannelId(jc1.channelId);

            await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );

            let state = await mathChannelManager.getLatestState(jc1.channelId);
            console.log("State: ", state);

            await firstSigner.provider.send("evm_increaseTime", [200]);

            await barrier.tryPass();
            await p2p2.p2pSigner.p2pManager.stateManager.disputeHandler.createDispute(
                0,
                firstSigner.address,
                0,
                []
            );

            state = await mathChannelManager.getLatestState(jc1.channelId);
            console.log("State: ", state);
        });
        it("Timeout - transaction 1", async function () {
            p2p1.setHooks({
                async onTurn(address: string) {
                    if (address != (await p2p1.p2pSigner.getAddress())) return;
                    console.log("p2p 1 - onTurn - BarrierLocal.allowOne()");
                    barrier.allowOne();
                },
                onConnection(address): void {
                    console.log(
                        "p2p 1 - onConnection - BarrierLocal.allowOne()"
                    );
                    barrier.allowOne();
                }
            });
            p2p2.setHooks({
                async onTurn(address: string) {
                    if (address != (await p2p2.p2pSigner.getAddress())) return;
                    console.log("p2p 2 - onTurn - BarrierLocal.allowOne()");
                    barrier.allowOne();
                },
                onConnection(address): void {
                    console.log(
                        "p2p 2 - onConnection - BarrierLocal.allowOne()"
                    );
                    barrier.allowOne();
                }
            });
            let channelId = Math.random().toString();
            let jc1 = createJoinChannelTestObject(
                firstSigner.address,
                channelId
            );
            let jc2 = createJoinChannelTestObject(
                secondSigner.address,
                channelId
            );

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            process.env["DEBUG_LOCAL_TRANSPORT"] = "true";
            p2p1.p2pSigner.connectToChannel(jc1.channelId);
            p2p2.p2pSigner.connectToChannel(jc1.channelId);
            // let time = Clock.getTimeInSeconds();
            // await firstSigner.provider.send("evm_setNextBlockTimestamp", [
            //     time + 1
            // ]);

            await barrier.tryPass();
            await barrier.tryPass();

            console.log("************* 0 ");
            await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            let state = await mathChannelManager.getLatestState(jc1.channelId);
            console.log("State ########### : ", state);
            await barrier.tryPass();
            await p2p1.p2pContractInstance.add(1);
            await firstSigner.provider.send("evm_increaseTime", [200]);
            await p2p1.p2pSigner.p2pManager.stateManager.disputeHandler.createDispute(
                0,
                secondSigner.address,
                1,
                []
            );

            state = await mathChannelManager.getLatestState(jc1.channelId);
            console.log("State: ", state);
        });
        it("Timeout - post on-chain", async function () {
            p2p1.setHooks({
                async onTurn(address: string) {
                    if (address != (await p2p1.p2pSigner.getAddress())) return;
                    console.log("p2p 1 - onTurn - BarrierLocal.allowOne()");
                    barrier.allowOne();
                },
                onConnection(address): void {
                    console.log(
                        "p2p 1 - onConnection - BarrierLocal.allowOne()"
                    );
                    barrier.allowOne();
                    p2p1.p2pSigner.disconnectFromPeers(); // disconnect from peers
                }
            });
            p2p2.setHooks({
                async onTurn(address: string) {
                    if (address != (await p2p2.p2pSigner.getAddress())) return;
                    console.log("p2p 2 - onTurn - BarrierLocal.allowOne()");
                    barrier.allowOne();
                },
                onConnection(address): void {
                    console.log(
                        "p2p 2 - onConnection - BarrierLocal.allowOne()"
                    );
                    barrier.allowOne();
                    p2p2.p2pSigner.disconnectFromPeers(); // disconnect from peers
                }
            });
            let channelId = Math.random().toString();
            let jc1 = createJoinChannelTestObject(
                firstSigner.address,
                channelId
            );
            let jc2 = createJoinChannelTestObject(
                secondSigner.address,
                channelId
            );

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            // process.env["DEBUG_LOCAL_TRANSPORT"] = "true";
            p2p1.p2pSigner.connectToChannel(jc1.channelId);
            p2p2.p2pSigner.connectToChannel(jc1.channelId);
            // let time = Clock.getTimeInSeconds();
            // await firstSigner.provider.send("evm_setNextBlockTimestamp", [
            //     time + 1
            // ]);

            await barrier.tryPass();
            await barrier.tryPass();

            console.log("************* 0 ");
            await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            let state = await mathChannelManager.getLatestState(jc1.channelId);
            console.log("State ########### : ", state);
            await barrier.tryPass();
            console.log("************* 1 ");
            await p2p1.p2pContractInstance.add(1);
            // await firstSigner.provider.send("evm_increaseTime", [200]);
            // await p2p1.p2pSigner.p2pManager.stateManager.disputeHandler.createDispute(
            //     0,
            //     secondSigner.address,
            //     1,
            //     []
            // );
            await barrier.tryPass();
            console.log("************* 2 ");
            await p2p2.p2pContractInstance.add(5);

            state = await mathChannelManager.getLatestState(jc1.channelId);
            console.log("State: ", state);
        });
    });
});
