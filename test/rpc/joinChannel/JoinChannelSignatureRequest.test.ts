import { expect } from "chai";
import assert from "node:assert/strict";

import Clock from "@/Clock";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { Codec, SignatureUtils, sleep, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

describe("JoinChannel signature requests", function () {
    it("excludes an on-chain-slashed participant from collection", async function () {
        const h = TestSession.getHarness();
        const { killer, spammer, spectator } =
            await h.scenario.stageUnkilledSpamDispute({
                addSpectatorBeforeDispute: true
            });
        if (!spectator) {
            throw new Error("Expected a spectator joiner");
        }

        await h.execOnHost(
            killer,
            async (sm) => {
                const proofs =
                    sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                await sm.disputeManager.killDispute(proofs[0].dispute);
            },
            {},
            {
                timeoutMs:
                    h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    }) * 2
            }
        );
        expect(await h.query.onChainSlashedParticipants()).to.include(
            spammer.address
        );

        const thresholdSet = await h
            .control(killer)
            .query.getOnChainThresholdSet()
            .request();
        expect(thresholdSet).to.have.length(2);
        expect(thresholdSet).to.not.include(spammer.address);

        const chainTime = await Clock.getBlockchainTime();
        const prepared =
            await spectator.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                {
                    participant: spectator.address,
                    channelId: h.channelId,
                    balance: { amount: 500n, data: "0x00" },
                    deadlineTimestamp: BigInt(chainTime.timestamp + 120)
                }
            );

        const encodedJoinChannel = String(
            prepared.confirmation.signedJoinChannel.encodedJoinChannel
        );
        const confirmationSigners = prepared.confirmation.signatures.map(
            (signature) =>
                SignatureUtils.getSignerAddress(
                    encodedJoinChannel,
                    String(signature)
                )
        );
        expect(confirmationSigners).to.have.deep.members(thresholdSet);
        expect(confirmationSigners).to.not.include(spammer.address);
    });

    it("rejects collector identity and deadline failures before requesting signatures", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1);
        const joiner = await h.join.addSpectatorWait();
        await h.assert.sync.peersInSyncWait();

        for (const peerIndex of [0, 1]) {
            await h
                .control(h.getPeer(peerIndex))
                .stub.stubCountJoinSignatureRequests()
                .request();
        }

        const chainTime = await Clock.getBlockchainTime();
        const joinChannel = {
            participant: joiner.address,
            channelId: h.channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(chainTime.timestamp)
        };
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            ),
            /join expired/
        );
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation({
                ...joinChannel,
                participant: h.getPeer(0).address,
                deadlineTimestamp: BigInt(chainTime.timestamp + 120)
            }),
            /participant must be the local signer/
        );

        for (const peerIndex of [0, 1]) {
            expect(
                await h
                    .control(h.getPeer(peerIndex))
                    .stub.getJoinSignatureRequestCount()
                    .request()
            ).to.equal(0);
        }
    });

    it("validates requests, signs exact joins, and waits through reachability grace for a missing threshold transport", async function () {
        const h = TestSession.getHarness();
        // Spectating is asynchronous to the channel: spawn both spectators
        // detached and await SYNCED only where the assertions below need
        // them. No transition is scheduled until the closing advanceState,
        // so nothing blocks an author's window; producing a block up front
        // instead would cap the next block's timestamp at prev + p2pTime and
        // this setup phase would make peer 0 reject it as stale
        // (|now - blockTs| > agreementTime) and dispute.
        await h.lifecycle.start(2, 0);
        const joiner = await h.join.addSpectatorDetached();
        const nonUnionSigner = await h.join.addSpectatorDetached();
        await h.event.waitUntilPeerStatus(joiner.index, Status.SYNCED);
        await h.event.waitUntilPeerStatus(nonUnionSigner.index, Status.SYNCED);
        await h.assert.sync.peersInSyncWait();

        const joinChannel = {
            participant: joiner.address,
            channelId: h.channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(Clock.getTimeInSeconds() + 120)
        };
        const prepared =
            await joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            );
        expect(prepared.confirmation.signatures).to.have.length(2);
        const pinnedSnapshot = StateSnapshot.from(
            await h.channelManager.getStateSnapshot(h.channelId)
        );
        expect(prepared.expectedSnapshotHash).to.equal(pinnedSnapshot.hash);
        expect(prepared.expectedForkId).to.equal(pinnedSnapshot.forkID);

        const signed = await SignatureUtils.signJoinChannel(
            joinChannel,
            joiner.signer
        );
        const encodedSignedJoinChannel = String(
            Codec.encode(
                {
                    encodedJoinChannel: String(signed.encoded),
                    signature: String(signed.signature)
                },
                Type.SignedJoinChannel
            )
        );
        const request = (
            fromPeerIndex: number,
            toAddress: string,
            encodedRequest: string,
            expectedSnapshotHash: string,
            expectedForkId: string
        ) =>
            h.execOnHost(
                h.getPeer(fromPeerIndex),
                async (sm, args) =>
                    sm.p2pManager.remoteRpc.joinChannelService
                        .requestJoinSignature(
                            args.encodedRequest,
                            args.expectedSnapshotHash,
                            args.expectedForkId
                        )
                        .request(args.toAddress),
                {
                    toAddress,
                    encodedRequest,
                    expectedSnapshotHash,
                    expectedForkId
                }
            );

        const valid = await request(
            joiner.index,
            h.getPeer(0).address,
            encodedSignedJoinChannel,
            String(prepared.expectedSnapshotHash),
            String(prepared.expectedForkId)
        );
        expect(
            SignatureUtils.getSignerAddress(
                String(signed.encoded),
                String(valid.signature)
            )
        ).to.equal(h.getPeer(0).address);

        const missingPeerResult = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const transport = sm.p2pManager.loopbackTransport;
                const peerAddress = transport.peerAddress;
                transport.peerAddress = undefined;
                try {
                    await sm.p2pManager.localRpc.joinChannelService.signJoinRequest(
                        transport,
                        args.encodedRequest,
                        args.expectedSnapshotHash,
                        args.expectedForkId
                    );
                    return "resolved";
                } catch (error) {
                    return error instanceof Error
                        ? error.message
                        : String(error);
                } finally {
                    transport.peerAddress = peerAddress;
                }
            },
            {
                encodedRequest: encodedSignedJoinChannel,
                expectedSnapshotHash: String(prepared.expectedSnapshotHash),
                expectedForkId: String(prepared.expectedForkId)
            }
        );
        expect(missingPeerResult).to.equal(
            "requestJoinSignature: missing peer address"
        );

        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                "0xdeadbeef",
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            )
        );

        await assert.rejects(
            request(
                1,
                h.getPeer(0).address,
                encodedSignedJoinChannel,
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            ),
            /invalid participant signature/
        );

        const wrongEmbeddedSigner = await SignatureUtils.signJoinChannel(
            joinChannel,
            h.getPeer(1).signer
        );
        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                String(
                    Codec.encode(
                        {
                            encodedJoinChannel: String(
                                wrongEmbeddedSigner.encoded
                            ),
                            signature: String(wrongEmbeddedSigner.signature)
                        },
                        Type.SignedJoinChannel
                    )
                ),
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            ),
            /invalid participant signature/
        );

        const invalidSignatureRequest = String(
            Codec.encode(
                {
                    encodedJoinChannel: String(signed.encoded),
                    signature: `0x${"11".repeat(65)}`
                },
                Type.SignedJoinChannel
            )
        );
        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                invalidSignatureRequest,
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            )
        );

        const wrongChannelJoin = {
            ...joinChannel,
            channelId: `0x${"44".repeat(32)}`
        };
        const wrongChannelSigned = await SignatureUtils.signJoinChannel(
            wrongChannelJoin,
            joiner.signer
        );
        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                String(
                    Codec.encode(
                        {
                            encodedJoinChannel: String(
                                wrongChannelSigned.encoded
                            ),
                            signature: String(wrongChannelSigned.signature)
                        },
                        Type.SignedJoinChannel
                    )
                ),
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            ),
            /channel mismatch/
        );

        const expiredJoin = {
            ...joinChannel,
            deadlineTimestamp: 0n
        };
        const expiredSigned = await SignatureUtils.signJoinChannel(
            expiredJoin,
            joiner.signer
        );
        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                String(
                    Codec.encode(
                        {
                            encodedJoinChannel: String(expiredSigned.encoded),
                            signature: String(expiredSigned.signature)
                        },
                        Type.SignedJoinChannel
                    )
                ),
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            ),
            /join expired/
        );

        const boundaryTime = await Clock.getBlockchainTime();
        const boundaryJoin = {
            ...joinChannel,
            deadlineTimestamp: BigInt(boundaryTime.timestamp)
        };
        const boundarySigned = await SignatureUtils.signJoinChannel(
            boundaryJoin,
            joiner.signer
        );
        const boundaryResponse = await request(
            joiner.index,
            h.getPeer(0).address,
            String(
                Codec.encode(
                    {
                        encodedJoinChannel: String(boundarySigned.encoded),
                        signature: String(boundarySigned.signature)
                    },
                    Type.SignedJoinChannel
                )
            ),
            String(prepared.expectedSnapshotHash),
            String(prepared.expectedForkId)
        );
        expect(
            SignatureUtils.getSignerAddress(
                String(boundarySigned.encoded),
                String(boundaryResponse.signature)
            )
        ).to.equal(h.getPeer(0).address);

        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                encodedSignedJoinChannel,
                `0x${"55".repeat(32)}`,
                String(prepared.expectedForkId)
            ),
            /snapshot mismatch/
        );
        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                encodedSignedJoinChannel,
                String(prepared.expectedSnapshotHash),
                `0x${"66".repeat(32)}`
            ),
            /fork mismatch/
        );
        await assert.rejects(
            request(
                joiner.index,
                nonUnionSigner.address,
                encodedSignedJoinChannel,
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            ),
            /local signer not in threshold/
        );
        expect(
            await h.control(nonUnionSigner).query.getStatus().request()
        ).to.equal(Status.SYNCED);
        expect(
            await h
                .control(nonUnionSigner)
                .query.isConnectedTo(joiner.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(h.getPeer(0))
                .query.isConnectedTo(joiner.address)
                .request()
        ).to.equal(true);

        const retry = await request(
            joiner.index,
            h.getPeer(0).address,
            encodedSignedJoinChannel,
            String(prepared.expectedSnapshotHash),
            String(prepared.expectedForkId)
        );
        expect(
            SignatureUtils.getSignerAddress(
                String(signed.encoded),
                String(retry.signature)
            )
        ).to.equal(h.getPeer(0).address);
        expect(
            await h.control(h.getPeer(0)).query.getStatus().request()
        ).to.equal(Status.PARTICIPATING);

        for (const peerIndex of [0, 1]) {
            await h
                .control(h.getPeer(peerIndex))
                .stub.stubCountJoinSignatureRequests()
                .request();
        }

        await h.transition.advanceState({ count: 1 });
        await h.transition.postSnapshotWait({ peerIndex: 0 });
        await assert.rejects(
            request(
                joiner.index,
                h.getPeer(0).address,
                encodedSignedJoinChannel,
                String(prepared.expectedSnapshotHash),
                String(prepared.expectedForkId)
            ),
            /snapshot mismatch/
        );
        await h.join.forceInboundJoinWait({
            waitForHonestPeersObserve: false
        });
        const requestCountsBeforePreflight = await Promise.all(
            [0, 1].map((peerIndex) =>
                h
                    .control(h.getPeer(peerIndex))
                    .stub.getJoinSignatureRequestCount()
                    .request()
            )
        );
        const agreementTime = h.options.timeConfig?.agreementTime;
        if (!agreementTime) {
            throw new Error("Expected a resolved agreementTime");
        }
        const startedAt = Date.now();
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            ),
            /threshold participant unavailable/
        );
        expect(Date.now() - startedAt).to.be.greaterThanOrEqual(
            agreementTime * 2 * 1000 - 250
        );
        const requestCountsAfterPreflight = await Promise.all(
            [0, 1].map((peerIndex) =>
                h
                    .control(h.getPeer(peerIndex))
                    .stub.getJoinSignatureRequestCount()
                    .request()
            )
        );
        expect(requestCountsAfterPreflight).to.deep.equal(
            requestCountsBeforePreflight
        );
        const refusalState = await h.execOnHost(
            h.getPeer(joiner.index),
            async (sm) => ({
                status: sm.status,
                joinSubmissionHeight:
                    sm.storage.forceJoin.getJoinSubmissionBlockHeight()
            }),
            {}
        );
        expect(refusalState.status).to.equal(Status.SYNCED);
        expect(refusalState.joinSubmissionHeight).to.equal(undefined);
    });

    it("rejects erroring, wrong-signer, and deadline-silent threshold members", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1);
        const joiner = await h.join.addSpectatorWait();
        await h.assert.sync.peersInSyncWait();
        const responder = h.getPeer(0);
        const chainTime = await Clock.getBlockchainTime();
        const joinChannel = {
            participant: joiner.address,
            channelId: h.channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(chainTime.timestamp + 120)
        };

        await h
            .control(responder)
            .stub.stubFailJoinSignatureRequests()
            .request();
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            ),
            /stubbed join-signature failure/
        );
        await h
            .control(responder)
            .stub.restoreJoinSignatureRequests()
            .request();

        await h
            .control(responder)
            .stub.stubWrongJoinSignatureSigner()
            .request();
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            ),
            new RegExp(`invalid signature from ${responder.address}`)
        );
        await h
            .control(responder)
            .stub.restoreJoinSignatureRequests()
            .request();

        await h
            .control(responder)
            .stub.stubDelayJoinSignatureResponses(1500)
            .request();
        const shortWindowTime = await Clock.getBlockchainTime();
        const startedAt = Date.now();
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation({
                ...joinChannel,
                deadlineTimestamp: BigInt(shortWindowTime.timestamp + 1)
            })
        );
        expect(Date.now() - startedAt).to.be.lessThan(2800);
        await sleep(700);
        await h
            .control(responder)
            .stub.restoreJoinSignatureRequests()
            .request();

        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(
            await h.execOnHost(
                h.getPeer(joiner.index),
                (sm) => sm.storage.forceJoin.getJoinSubmissionBlockHeight(),
                {}
            )
        ).to.equal(undefined);
    });
});
