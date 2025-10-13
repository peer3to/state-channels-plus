import { expect } from "chai";
import { ethers } from "hardhat";
import { EventLog } from "ethers";

import {
    deployMathChannelProxyFixture,
    getSigners,
    createJoinChannelTestObject,
    createOpenChannelTestObject
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
    let mathChannelManager: MathStateChannelManagerProxy;
    let mathInstance: MathStateMachine;
    let firstSigner: HardhatEthersSigner;
    let secondSigner: HardhatEthersSigner;

    // Default test objects - can be overridden in individual tests
    let jc1: JoinChannelStruct;
    let jc2: JoinChannelStruct;
    let jc1Signed: any;
    let jc2Signed: any;

    // Open channel test objects
    let openChannel: any;
    let openChannelSigned: any;

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

        // Create open channel test objects
        openChannel = createOpenChannelTestObject([
            firstSigner.address,
            secondSigner.address
        ]);
        openChannelSigned = await SignatureUtils.signOpenChannel(
            openChannel,
            firstSigner
        );
    });

    describe("Open Channel - MathStateChannel", function () {
        it("2 participants - success", async function () {
            const res = await mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        firstSigner
                    ).then((s) => s.signature as Bytes),
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        secondSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });
            const receipt = await res.wait();
            expect(receipt?.logs.length, "Event logs").to.be.equal(1);
            receipt?.logs.forEach((event: any) => {
                const e: EventLog = event as EventLog;
                const id = e.topics[1];

                expect(id, "Game not created successfully").to.be.equal(
                    openChannel.channelId
                );
            });
        });

        it("2 participants signatures not inorder - success", async function () {
            const res = await mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        secondSigner
                    ).then((s) => s.signature as Bytes),
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        firstSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });
            const receipt = await res.wait();
            expect(receipt?.logs.length, "Event logs").to.be.equal(1);
            receipt?.logs.forEach((event: any) => {
                const e: EventLog = event as EventLog;
                const id = e.topics[1];

                expect(id, "Game not created successfully").to.be.equal(
                    openChannel.channelId
                );
            });
        });

        it("2 participants 1 signature - fail", async function () {
            const res = mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        firstSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });
            await expect(res).to.be.revertedWith(
                "Cryptography: Not enough signatures provided"
            );
        });

        it("2 participants double signature - fail", async function () {
            const sig1 = await SignatureUtils.signOpenChannel(
                openChannel,
                firstSigner
            ).then((s) => s.signature as Bytes);
            const res = mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: [sig1, sig1]
            });
            await expect(res).to.be.revertedWith(
                "Cryptography: Not enough valid signatures"
            );
        });

        it("2 participants wrong encoded openChannel msg - fail", async function () {
            const res = mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded + "00", // Corrupt the encoded data
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        firstSigner
                    ).then((s) => s.signature as Bytes),
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        secondSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });
            await expect(res).to.be.revertedWith(
                "Cryptography: Not enough valid signatures"
            );
        });

        it("2 participants no signatures - fail", async function () {
            const res = mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: []
            });
            await expect(res).to.be.revertedWith(
                "Cryptography: Not enough signatures provided"
            );
        });

        it("2 participants invalid signature length - fail", async function () {
            const resultPromise = mathChannelManager.joinChannel({
                signedJoinChannel: {
                    encodedJoinChannel: jc1Signed.encoded,
                    signature: jc1Signed.signature as Bytes
                },
                signatures: [jc1Signed.signature, jc2Signed.signature + "00"]
            });
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

            await expect(
                mathChannelManager.joinChannel({
                    signedJoinChannel: {
                        encodedJoinChannel: jc1Signed.encoded,
                        signature: jc1Signed.signature as Bytes
                    },
                    signatures: [jc1Signed.signature, jc2Signed.signature]
                })
            ).to.be.revertedWithCustomError(
                {
                    interface: new ethers.Interface([
                        "error ErrorInvalidChannelId()"
                    ])
                },
                "ErrorInvalidChannelId"
            );
        });

        it("2 participants channel already exists - fail", async function () {
            // First, open a channel successfully
            await mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        firstSigner
                    ).then((s) => s.signature as Bytes),
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        secondSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });

            // Try to open the same channel again with the same channelId
            const res = mathChannelManager.open({
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        firstSigner
                    ).then((s) => s.signature as Bytes),
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        secondSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });
            await expect(res).to.be.revertedWithCustomError(
                {
                    interface: new ethers.Interface([
                        "error ErrorChannelAlreadyOpen()"
                    ])
                },
                "ErrorChannelAlreadyOpen"
            );
        });

        it("2 participants channelId cannot be 0x0 - fail", async function () {
            // Create OpenChannel with channelId = 0x0
            const invalidOpenChannel = createOpenChannelTestObject([
                firstSigner.address,
                secondSigner.address
            ]);
            invalidOpenChannel.channelId =
                "0x0000000000000000000000000000000000000000000000000000000000000000";

            const res = mathChannelManager.open({
                encodedOpenChannel: await SignatureUtils.signOpenChannel(
                    invalidOpenChannel,
                    firstSigner
                ).then((s) => s.encoded),
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        invalidOpenChannel,
                        firstSigner
                    ).then((s) => s.signature as Bytes),
                    await SignatureUtils.signOpenChannel(
                        invalidOpenChannel,
                        secondSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });
            await expect(res).to.be.revertedWithCustomError(
                {
                    interface: new ethers.Interface([
                        "error ErrorInvalidJoinChannel()"
                    ])
                },
                "ErrorInvalidJoinChannel"
            );
        });

        it("2 participants amount 0 - success with zero balance", async function () {
            // Create OpenChannel with amount 0
            const openChannelWithZeroBalance = createOpenChannelTestObject(
                [firstSigner.address, secondSigner.address],
                {
                    initialBalance: 0
                }
            );

            const res = await mathChannelManager.open({
                encodedOpenChannel: await SignatureUtils.signOpenChannel(
                    openChannelWithZeroBalance,
                    firstSigner
                ).then((s) => s.encoded),
                signatures: [
                    await SignatureUtils.signOpenChannel(
                        openChannelWithZeroBalance,
                        firstSigner
                    ).then((s) => s.signature as Bytes),
                    await SignatureUtils.signOpenChannel(
                        openChannelWithZeroBalance,
                        secondSigner
                    ).then((s) => s.signature as Bytes)
                ]
            });
            await res.wait();

            // Check that the channel was opened successfully
            expect(
                await mathChannelManager.isChannelOpen(
                    openChannelWithZeroBalance.channelId
                )
            ).to.be.true;

            // Check that the total deposits in the state snapshot is 0
            const stateSnapshot = await mathChannelManager.getStateSnapshot(
                openChannelWithZeroBalance.channelId
            );
            expect(stateSnapshot.snapshotData.totalDeposits.amount).to.equal(0);
        });

        it("2 participants time expired - fail", async function () {
            // Create JoinChannel with past deadline
            const invalidJoinChannel = createJoinChannelTestObject(
                firstSigner.address
            );
            invalidJoinChannel.deadlineTimestamp =
                Math.floor(Date.now() / 1000) - 300; // 5 minutes ago

            const invalidJoinChannelSigned =
                await SignatureUtils.signJoinChannel(
                    invalidJoinChannel,
                    firstSigner
                );

            const res = mathChannelManager.joinChannel({
                signedJoinChannel: {
                    encodedJoinChannel: invalidJoinChannelSigned.encoded,
                    signature: invalidJoinChannelSigned.signature as Bytes
                },
                signatures: [
                    invalidJoinChannelSigned.signature,
                    jc2Signed.signature
                ]
            });
            await expect(res).to.be.revertedWithCustomError(
                {
                    interface: new ethers.Interface([
                        "error ErrorJoinChannelExpired()"
                    ])
                },
                "ErrorJoinChannelExpired"
            );
        });
    });
});
