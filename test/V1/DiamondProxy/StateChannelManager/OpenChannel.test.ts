import { expect } from "chai";
import { ethers } from "hardhat";
import { EventLog } from "ethers";

import {
    deployMathChannelProxyFixture,
    getSigners,
    createJoinChannelTestObject
} from "@test/test_utils/testHelpers";
import { SignatureUtils } from "@/utils";
import {
    MathStateChannelManagerProxy,
    MathStateMachine
} from "@typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bytes } from "@/types/types";
import { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";

describe("StateChannelManagerProxy", function () {
    process.env.DEBUG_LOCAL_TRANSPORT = "true"; //will use local transport - these tests aren't meant to test the distributed system

    let mathChannelManager: MathStateChannelManagerProxy;
    let mathInstance: MathStateMachine;
    let firstSigner: HardhatEthersSigner;
    let secondSigner: HardhatEthersSigner;

    // Default test objects - can be overridden in individual tests
    let jc1: JoinChannelStruct;
    let jc2: JoinChannelStruct;
    let jc1Signed: any;
    let jc2Signed: any;

    beforeEach(async function () {
        const contracts = await deployMathChannelProxyFixture(ethers);
        mathChannelManager = contracts.mathChannelManager;
        mathInstance = contracts.mathInstance;

        const signers = await getSigners(ethers);
        firstSigner = signers.firstSigner;
        secondSigner = signers.secondSigner;

        jc1 = createJoinChannelTestObject(firstSigner.address);
        jc2 = createJoinChannelTestObject(secondSigner.address);

        jc1Signed = await SignatureUtils.signJoinChannel(jc1, firstSigner);
        jc2Signed = await SignatureUtils.signJoinChannel(jc2, secondSigner);
    });

    describe("Open Channel - MathStateChannel", function () {
        it("2 participants - success", async function () {
            const res = await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature as Bytes, jc2Signed.signature as Bytes]
            );
            const receipt = await res.wait();
            expect(receipt?.logs.length, "Event logs").to.be.equal(1);
            receipt?.logs.forEach((event) => {
                const e: EventLog = event as EventLog;
                const id = e.topics[1];

                expect(id, "Game not created successfully").to.be.equal(
                    jc1.channelId
                );
            });
        });

        it("2 participants signatures not inorder - success", async function () {
            const res = await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc2Signed.signature as Bytes, jc1Signed.signature as Bytes]
            );
            const receipt = await res.wait();
            expect(receipt?.logs.length, "Event logs").to.be.equal(1);
            receipt?.logs.forEach((event) => {
                const e: EventLog = event as EventLog;
                const id = e.topics[1];

                expect(id, "Game not created successfully").to.be.equal(
                    jc1.channelId
                );
            });
        });

        it("2 participants 1 signature - fail", async function () {
            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel (openChannel <> signatures) incorrect length"
            );
        });

        it("2 participants double signature - fail", async function () {
            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature as Bytes, jc1Signed.signature as Bytes]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel (openChannel <> signatures) signatures don't match"
            );
        });

        it("2 participants wrong encoded openChannel msg - fail", async function () {
            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded + "00", jc2Signed.encoded],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel (openChannel <> signatures) signatures don't match"
            );
        });

        it("2 participants no signatures - fail", async function () {
            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                []
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel (openChannel <> signatures) incorrect length"
            );
        });

        it("2 participants invalid signature length - fail", async function () {
            const resultPromise = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
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
            // Override default objects for this test
            jc1.channelId = new Uint8Array(32);
            jc2.channelId = new Uint8Array(32);

            jc1Signed = await SignatureUtils.signJoinChannel(jc1, firstSigner);
            jc2Signed = await SignatureUtils.signJoinChannel(jc2, secondSigner);

            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel channelId cannot be 0x0"
            );
        });

        it.skip("2 participants game already exists - fail", async function () {
            await mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature, jc2Signed.signature]
            );
            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel - channel already open"
            );
        });

        it("2 participants channelId doesn't match - fail", async function () {
            // Override default objects for this test
            jc2.channelId = ethers.keccak256("0x1aaa");

            jc1Signed = await SignatureUtils.signJoinChannel(jc1, firstSigner);
            jc2Signed = await SignatureUtils.signJoinChannel(jc2, secondSigner);

            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel channelId doesn't match"
            );
        });

        it("2 participants amount 0 - fail", async function () {
            // Override default objects for this test
            jc2.balance = {
                amount: 0,
                data: "0x"
            };

            jc1Signed = await SignatureUtils.signJoinChannel(jc1, firstSigner);
            jc2Signed = await SignatureUtils.signJoinChannel(jc2, secondSigner);

            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel amount must be greater than 0"
            );
        });

        it("2 participants time expired - fail", async function () {
            // Override default objects for this test
            jc2.deadlineTimestamp = Number(jc2.deadlineTimestamp) - 300;

            jc1Signed = await SignatureUtils.signJoinChannel(jc1, firstSigner);
            jc2Signed = await SignatureUtils.signJoinChannel(jc2, secondSigner);

            const res = mathChannelManager.openChannel(
                jc1.channelId,
                [jc1Signed.encoded, jc2Signed.encoded],
                [jc1Signed.signature, jc2Signed.signature]
            );
            await expect(res).to.be.revertedWith(
                "MathConsumerFacet: openChannel timestampDeadline must be in the future"
            );
        });
    });
});
