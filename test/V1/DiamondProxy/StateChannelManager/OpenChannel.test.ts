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
import StateSnapshot from "@/models/StateSnapshot";
import {
    StateChannelManagerInterface,
    MathStateMachine
} from "@typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bytes } from "@/types/types";
import { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";

describe("StateChannelManagerProxy", function () {
    let mathChannelManager: StateChannelManagerInterface;
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
        it("enumerates successful opens in append order with safe page boundaries", async function () {
            const secondOpenChannel = createOpenChannelTestObject(
                [firstSigner.address, secondSigner.address],
                { channelId: "open-channel-registry-second" }
            );

            await mathChannelManager.open({
                encodedOpenChannel: (
                    await SignatureUtils.signOpenChannel(
                        openChannel,
                        firstSigner
                    )
                ).encoded,
                signatures: [
                    (
                        await SignatureUtils.signOpenChannel(
                            openChannel,
                            firstSigner
                        )
                    ).signature as Bytes,
                    (
                        await SignatureUtils.signOpenChannel(
                            openChannel,
                            secondSigner
                        )
                    ).signature as Bytes
                ]
            });
            await mathChannelManager.open({
                encodedOpenChannel: (
                    await SignatureUtils.signOpenChannel(
                        secondOpenChannel,
                        firstSigner
                    )
                ).encoded,
                signatures: [
                    (
                        await SignatureUtils.signOpenChannel(
                            secondOpenChannel,
                            firstSigner
                        )
                    ).signature as Bytes,
                    (
                        await SignatureUtils.signOpenChannel(
                            secondOpenChannel,
                            secondSigner
                        )
                    ).signature as Bytes
                ]
            });

            expect(await mathChannelManager.getOpenChannelCount()).to.equal(2);
            expect(
                await mathChannelManager.getOpenChannelIds(0, 10)
            ).to.deep.equal([
                openChannel.channelId,
                secondOpenChannel.channelId
            ]);
            expect(
                await mathChannelManager.getOpenChannelIds(1, 1)
            ).to.deep.equal([secondOpenChannel.channelId]);
            expect(
                await mathChannelManager.getOpenChannelIds(0, 0)
            ).to.deep.equal([]);
            expect(
                await mathChannelManager.getOpenChannelIds(2, 1)
            ).to.deep.equal([]);
            expect(
                await mathChannelManager.getOpenChannelIds(1, 100)
            ).to.deep.equal([secondOpenChannel.channelId]);
        });

        it("keeps the open-channel registry unchanged after a duplicate open reverts", async function () {
            const confirmation = {
                encodedOpenChannel: openChannelSigned.encoded,
                signatures: [
                    (
                        await SignatureUtils.signOpenChannel(
                            openChannel,
                            firstSigner
                        )
                    ).signature as Bytes,
                    (
                        await SignatureUtils.signOpenChannel(
                            openChannel,
                            secondSigner
                        )
                    ).signature as Bytes
                ]
            };
            await mathChannelManager.open(confirmation);
            await expect(mathChannelManager.open(confirmation)).to.be.reverted;

            expect(await mathChannelManager.getOpenChannelCount()).to.equal(1);
            expect(
                await mathChannelManager.getOpenChannelIds(0, 2)
            ).to.deep.equal([openChannel.channelId]);
        });

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
            const expectedSnapshotHash = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(jc1.channelId)
            ).hash;
            const expectedForkId = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(jc1.channelId)
            ).forkID;
            const resultPromise = mathChannelManager
                .connect(firstSigner)
                .joinChannel(
                    {
                        signedJoinChannel: {
                            encodedJoinChannel: jc1Signed.encoded,
                            signature: jc1Signed.signature as Bytes
                        },
                        signatures: [
                            jc1Signed.signature,
                            jc2Signed.signature + "00"
                        ]
                    },
                    expectedSnapshotHash,
                    expectedForkId
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

        it("forces inbound join message and updates math state machine", async function () {
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
                    } catch {
                        return null;
                    }
                })
                .find((parsed) => parsed && parsed.name === "ChannelOpened");
            expect(parsedOpenEvent, "ChannelOpened event not found").to.exist;
            const channelOpenedEvent = parsedOpenEvent!;
            const genesisState = channelOpenedEvent.args.encodedState as string;

            const forcedAmount = 250n;
            const join = {
                participant: thirdSigner.address,
                channelId: openChannel.channelId,
                balance: { amount: forcedAmount, data: "0x00" },
                deadlineTimestamp: BigInt(Math.floor(Date.now() / 1000) + 300)
            };
            const signedJoin = await SignatureUtils.signJoinChannel(
                join,
                thirdSigner
            );
            const snapshot = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(openChannel.channelId)
            );
            const balanceBeforeJoin =
                await mathChannelManager.getChannelBalance(
                    openChannel.channelId
                );
            const joinTx = await mathChannelManager
                .connect(thirdSigner)
                .joinChannel(
                    {
                        signedJoinChannel: {
                            encodedJoinChannel: String(signedJoin.encoded),
                            signature: String(signedJoin.signature)
                        },
                        signatures: await Promise.all(
                            [firstSigner, secondSigner].map((signer) =>
                                SignatureUtils.signJoinChannel(
                                    join,
                                    signer
                                ).then(({ signature }) => String(signature))
                            )
                        )
                    },
                    snapshot.hash,
                    snapshot.forkID
                );
            const joinReceipt = await joinTx.wait();
            const inboundEvent = joinReceipt?.logs
                .map((log) => {
                    try {
                        return mathChannelManager.interface.parseLog(log);
                    } catch {
                        return null;
                    }
                })
                .find((parsed) => parsed?.name === "InboundMessagesProcessed");
            expect(inboundEvent, "InboundMessagesProcessed event not found").to
                .exist;
            const messageBlock = inboundEvent!.args.messageBlock;
            const newTotalDeposits = (
                await mathChannelManager.getChannelBalance(
                    openChannel.channelId
                )
            ).totalDeposits;

            expect(messageBlock.messages.length).to.equal(1);
            expect(messageBlock.blockHeight).to.equal(2);
            expect(messageBlock.previousBlockHash).to.equal(
                balanceBeforeJoin.latestInboundMessageBlockHash
            );

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
            // Only the JOIN the snapshot has not consumed is pending: the
            // third signer's deposit. The open joins were consumed by the
            // genesis snapshot, so the original participants are not pending
            // even though their JOIN messages remain in the inbound chain.
            expect(
                await mathChannelManager.getPendingParticipants(
                    openChannel.channelId
                )
            ).to.deep.equal([thirdSigner.address]);

            const insertedBalance = await mathInstance.getBalance(
                thirdSigner.address
            );
            expect(insertedBalance).to.equal(forcedAmount);
        });

        it("requires the encoded participant to submit the join", async function () {
            const snapshot = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(jc1.channelId)
            );
            await expect(
                mathChannelManager.connect(secondSigner).joinChannel(
                    {
                        signedJoinChannel: {
                            encodedJoinChannel: jc1Signed.encoded,
                            signature: String(jc1Signed.signature)
                        },
                        signatures: []
                    },
                    snapshot.hash,
                    snapshot.forkID
                )
            )
                .to.be.revertedWithCustomError(
                    {
                        interface: new ethers.Interface([
                            "error ErrorJoinChannelInvalidSubmitter(address expectedParticipant, address actualSubmitter)"
                        ])
                    },
                    "ErrorJoinChannelInvalidSubmitter"
                )
                .withArgs(firstSigner.address, secondSigner.address);
        });

        it("tops up an existing participant without duplicating membership", async function () {
            await (
                await mathChannelManager.open({
                    encodedOpenChannel: openChannelSigned.encoded,
                    signatures: await Promise.all(
                        [firstSigner, secondSigner].map((signer) =>
                            SignatureUtils.signOpenChannel(
                                openChannel,
                                signer
                            ).then(({ signature }) => String(signature))
                        )
                    )
                })
            ).wait();
            const topUp = {
                participant: firstSigner.address,
                channelId: openChannel.channelId,
                balance: { amount: 125n, data: "0x00" },
                deadlineTimestamp: BigInt(Math.floor(Date.now() / 1000) + 300)
            };
            const signedTopUp = await SignatureUtils.signJoinChannel(
                topUp,
                firstSigner
            );
            const snapshot = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(openChannel.channelId)
            );
            const topUpTx = await mathChannelManager
                .connect(firstSigner)
                .topUpBalance(
                    {
                        signedJoinChannel: {
                            encodedJoinChannel: String(signedTopUp.encoded),
                            signature: String(signedTopUp.signature)
                        },
                        signatures: await Promise.all(
                            [firstSigner, secondSigner].map((signer) =>
                                SignatureUtils.signJoinChannel(
                                    topUp,
                                    signer
                                ).then(({ signature }) => String(signature))
                            )
                        )
                    },
                    snapshot.hash,
                    snapshot.forkID
                );
            const topUpReceipt = await topUpTx.wait();
            const inboundEvent = topUpReceipt?.logs
                .map((log) => {
                    try {
                        return mathChannelManager.interface.parseLog(log);
                    } catch {
                        return null;
                    }
                })
                .find((parsed) => parsed?.name === "InboundMessagesProcessed");
            expect(inboundEvent, "InboundMessagesProcessed event not found").to
                .exist;
            expect(inboundEvent!.args.messageBlock.blockHeight).to.equal(2);
            expect(inboundEvent!.args.messageBlock.messages).to.have.length(1);
            expect(
                inboundEvent!.args.messageBlock.messages[0].balance.amount
            ).to.equal(125n);

            // Only the JOIN the snapshot has not consumed is pending: the
            // top-up's message. The open joins were consumed by the genesis
            // snapshot, so the original participants are not pending.
            const pending = await mathChannelManager.getPendingParticipants(
                openChannel.channelId
            );
            expect(pending).to.deep.equal([firstSigner.address]);
            expect(
                (
                    await mathChannelManager.getChannelBalance(
                        openChannel.channelId
                    )
                ).totalDeposits.amount
            ).to.equal(
                BigInt(openChannel.balances[0].amount) +
                    BigInt(openChannel.balances[1].amount) +
                    125n
            );
        });

        it("2 participants channelId = 0 - fail", async function () {
            // Override default objects for this test
            jc1.channelId = new Uint8Array(32);
            jc2.channelId = new Uint8Array(32);

            jc1Signed = await SignatureUtils.signJoinChannel(jc1, firstSigner);
            jc2Signed = await SignatureUtils.signJoinChannel(jc2, secondSigner);

            const expectedSnapshotHash = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(jc1.channelId)
            ).hash;
            const expectedForkId = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(jc1.channelId)
            ).forkID;
            await expect(
                mathChannelManager.connect(firstSigner).joinChannel(
                    {
                        signedJoinChannel: {
                            encodedJoinChannel: jc1Signed.encoded,
                            signature: jc1Signed.signature as Bytes
                        },
                        signatures: [jc1Signed.signature, jc2Signed.signature]
                    },
                    expectedSnapshotHash,
                    expectedForkId
                )
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
                        "error RaceConditionChannelAlreadyOpen()"
                    ])
                },
                "RaceConditionChannelAlreadyOpen"
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
            const [isOpen] = await mathChannelManager.isChannelOpen(
                openChannelWithZeroBalance.channelId
            );
            expect(isOpen).to.be.true;

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

            const expectedSnapshotHash = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(
                    invalidJoinChannel.channelId
                )
            ).hash;
            const expectedForkId = StateSnapshot.from(
                await mathChannelManager.getStateSnapshot(
                    invalidJoinChannel.channelId
                )
            ).forkID;
            const res = mathChannelManager.connect(firstSigner).joinChannel(
                {
                    signedJoinChannel: {
                        encodedJoinChannel: invalidJoinChannelSigned.encoded,
                        signature: invalidJoinChannelSigned.signature as Bytes
                    },
                    signatures: [
                        invalidJoinChannelSigned.signature,
                        jc2Signed.signature
                    ]
                },
                expectedSnapshotHash,
                expectedForkId
            );
            await expect(res).to.be.revertedWithCustomError(
                {
                    interface: new ethers.Interface([
                        "error RaceConditionJoinChannelExpired()"
                    ])
                },
                "RaceConditionJoinChannelExpired"
            );
        });
    });
});
