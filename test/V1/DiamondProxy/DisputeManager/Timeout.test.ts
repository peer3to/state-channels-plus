import { ethers } from "hardhat";
import {
    createJoinChannelTestObject,
    deployMathChannelProxyFixture,
    getMathDeploymentTransaction,
    getMathP2pEventHooks
} from "@test/utils/testHelpers";
import { EvmUtils, BarrierLocal } from "@/utils";
import { P2pInstance, EvmStateMachine } from "@/evm";
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
        it("Timeout - transaction 0", async function () {});
        it("Timeout - transaction 1", async function () {});
        it("Timeout - post on-chain", async function () {});
    });
});
