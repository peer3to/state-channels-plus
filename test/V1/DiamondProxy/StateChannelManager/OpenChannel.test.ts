import { expect } from "chai";
import { ethers } from "hardhat";
import { EventLog } from "ethers";

import {
    deployMathChannelProxyFixture,
    getSigners,
    createJoinChannelTestObject
} from "@test/utils/testHelpers";
import { EvmUtils } from "@/utils";
import {
    MathStateChannelManagerProxy,
    MathStateMachine
} from "@typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("StateChannelManagerProxy", function () {
    process.env.DEBUG_LOCAL_TRANSPORT = "true"; //will use local transport - these tests aren't meant to test the distributed system

    let mathChannelManager: MathStateChannelManagerProxy;
    let mathInstance: MathStateMachine;
    let firstSigner: HardhatEthersSigner;
    let secondSigner: HardhatEthersSigner;

    beforeEach(async function () {
        const contracts = await deployMathChannelProxyFixture(ethers);
        mathChannelManager = contracts.mathChannelManager;
        mathInstance = contracts.mathInstance;

        const signers = await getSigners(ethers);
        firstSigner = signers.firstSigner;
        secondSigner = signers.secondSigner;
    });

    describe("Open Channel - MathStateChannel", function () {
        it("2 participants - success", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            let receipt = await res.wait();
            expect(receipt?.logs.length, "Event logs").to.be.equal(1);
            receipt?.logs.forEach((event) => {
                let e: EventLog = event as EventLog;
                let id = e.args[0];
                let poker = e.args[1];
                expect(id, "Game not created successfully").to.be.equal(
                    jc1.channelId
                );
            });
        });
        it("2 participants signatures not inorder - success", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc2Signed.signature, jc1Signed.signature]
            );
            let receipt = await res.wait();
            expect(receipt?.logs.length, "Event logs").to.be.equal(1);
            receipt?.logs.forEach((event) => {
                let e: EventLog = event as EventLog;
                let id = e.args[0];
                let poker = e.args[1];
                expect(id, "Game not created successfully").to.be.equal(
                    jc1.channelId
                );
            });
        });
        it("2 participants 1 signature - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel (openChannel <> signatures) incorect length"
            );
        });

        it("2 participants double signature - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc1Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel (openChannel <> signatures) singatures don't match"
            );
        });

        it("2 participants wrong encoded openChannel msg - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [
                    jc1Signed.encodedJoinChannel + "00",
                    jc2Signed.encodedJoinChannel
                ],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel (openChannel <> signatures) singatures don't match"
            );
        });

        it("2 participants no signatures - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                []
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel (openChannel <> signatures) incorect length"
            );
        });

        it("2 participants invalid signature length - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let resultPromise = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature + "00"]
            );
            await expect(resultPromise)
                .to.be.revertedWithCustomError(
                    {
                        interface: new ethers.Interface([
                            "error ECDSAInvalidSignatureLength(uint256 length)"
                        ])
                    },
                    "ECDSAInvalidSignatureLength"
                )
                .withArgs(66);
        });

        it("2 participants channelId = 0 - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);
            jc1.channelId = new Uint8Array(32);
            jc2.channelId = new Uint8Array(32);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel channelId cannot be 0x0"
            );
        });

        it.skip("2 participants game already exists - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel - channel already open"
            );
        });

        it("2 participants channelId doesn't match - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);
            jc2.channelId = ethers.keccak256("0x1aaa");

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel channelId doesn't match"
            );
        });

        it("2 participants amount 0 - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);
            jc2.amount = 0;

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel amount must be greater than 0"
            );
        });

        it("2 participants time expired - fail", async function () {
            let jc1 = createJoinChannelTestObject(firstSigner.address);
            let jc2 = createJoinChannelTestObject(secondSigner.address);
            jc2.deadlineTimestamp = Number(jc2.deadlineTimestamp) - 300;

            let jc1Signed = await EvmUtils.signJoinChannel(jc1, firstSigner);
            let jc2Signed = await EvmUtils.signJoinChannel(jc2, secondSigner);

            let res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encodedJoinChannel, jc2Signed.encodedJoinChannel],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathStateChannelManager: openChannel timestampDeadline must be in the future"
            );
        });
    });
});
