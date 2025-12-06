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
    StateChannelManagerProxy,
    MathStateMachine,
    MathConsumerFacet__factory
} from "@typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bytes } from "@/types/types";
import { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";

describe("StateChannelManagerProxy", function () {
    let mathChannelManager: StateChannelManagerProxy;
    let mathInstance: MathStateMachine;
    let firstSigner: HardhatEthersSigner;
    let secondSigner: HardhatEthersSigner;
    let thirdSigner: HardhatEthersSigner;

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
        thirdSigner = signers.thirdSigner;

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
            expect(receipt?.logs.length, "Event logs").to.be.equal(2); // ChannelOpened & InboundMessagesProcessed
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
            expect(receipt?.logs.length, "Event logs").to.be.equal(2); // ChannelOpened & InboundMessagesProcessed
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

        it("forces inbound join message and updates math state machine", async function () {
            const consumerFacet = MathConsumerFacet__factory.connect(
                await mathChannelManager.getAddress(),
                firstSigner
            );
            const openTx = await mathChannelManager.open({
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
            const openReceipt = await openTx.wait();

            const parsedOpenEvent = openReceipt?.logs
                .map((log) => {
                    try {
                        return mathChannelManager.interface.parseLog(log);
                    } catch (error) {
                        return null;
                    }
                })
                .find((parsed) => parsed && parsed.name === "ChannelOpened");
            if (!parsedOpenEvent) {
                throw new Error("ChannelOpened event not found");
            }
            const genesisState = parsedOpenEvent.args.encodedState as string;

            const forcedAmount = 250n;
            const [messageBlock, newTotalDeposits] =
                await consumerFacet.forceInboundJoin.staticCall(
                    openChannel.channelId,
                    thirdSigner.address,
                    forcedAmount
                );
            await consumerFacet.forceInboundJoin(
                openChannel.channelId,
                thirdSigner.address,
                forcedAmount
            );

            expect(messageBlock.messages.length).to.equal(1);
            expect(messageBlock.blockHeight).to.equal(2);

            const forcedMessage = messageBlock.messages[0];
            const joinMessageType = ethers.keccak256(
                ethers.toUtf8Bytes("JOIN_CHANNEL_MESSAGE")
            );
            expect(forcedMessage.messageType).to.equal(joinMessageType);
            expect(forcedMessage.participant).to.equal(thirdSigner.address);
            expect(forcedMessage.balance.amount).to.equal(forcedAmount);

            const initialDeposits =
                BigInt(jc1.balance.amount) + BigInt(jc2.balance.amount);
            expect(newTotalDeposits.amount).to.equal(
                initialDeposits + forcedAmount
            );

            await mathInstance
                .connect(firstSigner)
                .setState(genesisState as Bytes);

            await mathInstance.connect(firstSigner).processInboundMessage({
                messageType: forcedMessage.messageType,
                participant: forcedMessage.participant,
                balance: {
                    amount: forcedMessage.balance.amount,
                    data: forcedMessage.balance.data
                },
                data: forcedMessage.data
            });

            const participants = await mathInstance.getParticipants();
            expect(participants).to.have.length(3);
            expect(participants).to.include(thirdSigner.address);

            const insertedBalance = await mathInstance.getBalance(
                thirdSigner.address
            );
            expect(insertedBalance).to.equal(forcedAmount);
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
