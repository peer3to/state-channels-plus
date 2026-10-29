import Clock from "@/Clock";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { Codec, getChecksumAddress, SignatureUtils, Type } from "@/utils";
import { DEFAULT_JOIN_CHANNEL_DEADLINE_SECONDS } from "@/utils/config";
import { readTrackedJoin } from "@test/fixtures/ForceJoinCountingStaging";
import { prepareFirstJoinDeadline } from "@test/fixtures/JoinDeadlineStaging";
import { collectAcrossSnapshotMove } from "@test/fixtures/JoinPinRaceStaging";
import { remoteThresholdPeerIndices } from "@test/fixtures/JoinSnapshotRetryStaging";
import { assertJoinSignatureDeadlineBoundary } from "@test/fixtures/node/JoinSignatureDeadlineStaging";
import { runtimeIsClosed } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import assert from "node:assert/strict";

describe("JoinChannel signature requests", function () {
    it("a prepared first join's deadline is its chain time plus the configured lifetime; a later runtime gets the default", async function () {
        const configured = await prepareFirstJoinDeadline(
            TestSession.getHarness(),
            { JOIN_CHANNEL_DEADLINE_SECONDS: 300 }
        );
        expect(configured.signatures).to.equal(2);
        expect(configured.deadline).to.equal(configured.chainTimestamp + 300);
        await TestSession.reset();
        const standard = await prepareFirstJoinDeadline(
            TestSession.getHarness()
        );
        expect(standard.signatures).to.equal(2);
        expect(standard.deadline).to.equal(
            standard.chainTimestamp + DEFAULT_JOIN_CHANNEL_DEADLINE_SECONDS
        );
    });

    it("rejects a signed zero balance and blacklists the requesting joiner", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const joiner = await h.join.addSpectatorWait();
        const chainTime = await Clock.getBlockchainTime();
        const signed = await SignatureUtils.signJoinChannel(
            {
                participant: joiner.address,
                channelId: h.channelId,
                balance: { amount: 0n, data: "0x1234" },
                deadlineTimestamp: BigInt(chainTime.timestamp + 120)
            },
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
        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const transport =
                    sm.p2pManager.profileManager.getTransportByEvmAddress(
                        args.joiner
                    );
                if (!transport) throw new Error("Expected connected joiner");
                let message = "";
                try {
                    await sm.p2pManager.localRpc.joinChannelService.signJoinRequest(
                        transport,
                        args.encodedSignedJoinChannel
                    );
                } catch (error) {
                    message =
                        error instanceof Error ? error.message : String(error);
                }
                return {
                    message,
                    blacklisted: sm.p2pManager.isBlacklisted(args.joiner)
                };
            },
            {
                encodedSignedJoinChannel,
                joiner: joiner.address
            }
        );
        expect(result.message).to.equal(
            "join balance must be greater than zero"
        );
        const blacklisted = result.blacklisted;
        expect(blacklisted).to.equal(true);
    });

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
                timeoutMs: h.event.hostExecTimeoutMs()
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

    it("collects every countersignature when a snapshot post lands between the joiner's pin read and the countersigners' replies", async function () {
        const h = TestSession.getHarness();
        const { pinnedSnapshotHash, movedSnapshotHash, prepared } =
            await collectAcrossSnapshotMove(h);
        expect(movedSnapshotHash).to.not.equal(pinnedSnapshotHash);
        // The joiner keeps its own pin; the chain checks it at submission.
        expect(prepared.expectedSnapshotHash).to.equal(pinnedSnapshotHash);
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
        expect(confirmationSigners).to.have.deep.members(
            await h
                .control(h.getPeer(0))
                .query.getOnChainThresholdSet()
                .request()
        );
        expect(confirmationSigners).to.have.length(3);
    });

    it("rejects collector identity and deadline failures before requesting signatures", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1);
        // Spawn-only, classified (plan 30 item 5): the join-signature flow needs a
        // synced joiner before any transition; nothing authors while it syncs.
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

    it("accepts the exact responder deadline and rejects one second past it on the responder's local clock", async function () {
        await assertJoinSignatureDeadlineBoundary(TestSession.getHarness());
    });

    it("collects every countersignature while a threshold member's chain RPC holds every read: the member answers from its local clock and mirror", async function () {
        const h = TestSession.getHarness();
        const heldIndex = 1;
        await h.lifecycle.start(2, 0, {
            rpcNodeProxiesByPeer: { [heldIndex]: 1 }
        });
        const joiner = await h.join.addSpectatorWait();
        await h.assert.sync.peersInSyncWait();
        const thresholdSet = await h
            .control(h.getPeer(0))
            .query.getOnChainThresholdSet()
            .request();
        const [proxy] = h.getRpcNodeProxies(heldIndex);
        const releases = ["eth_call", "eth_getBlockByNumber"].map((method) =>
            proxy.holdRequests(method)
        );
        try {
            const chainTime = await Clock.getBlockchainTime();
            const prepared =
                await joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                    {
                        participant: joiner.address,
                        channelId: h.channelId,
                        balance: { amount: 500n, data: "0x00" },
                        deadlineTimestamp: BigInt(chainTime.timestamp + 120)
                    }
                );
            const encodedJoinChannel = String(
                prepared.confirmation.signedJoinChannel.encodedJoinChannel
            );
            expect(
                prepared.confirmation.signatures.map((signature) =>
                    SignatureUtils.getSignerAddress(
                        encodedJoinChannel,
                        String(signature)
                    )
                )
            ).to.have.deep.members(thresholdSet);
        } finally {
            for (const release of releases) release();
        }
    });

    it("signs for a threshold member whose mirror misses its own pending join: the chain lists it", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const member = await h.join.addSpectatorWait();
        const joiner = await h.join.addSpectatorWait();
        await h.assert.sync.peersInSyncWait();
        const held = await h.mirror.holdUpdates(
            member.index,
            "onInboundMessagesProcessed"
        );
        try {
            await h.join.forceInboundJoinWait({ participant: member.address });
            // the member's mirror missed its join
            await waitFor(async () => (await held.heldCount()) > 0);
            const listing = await h.execOnHost(
                h.getPeer(member.index),
                async (sm) => ({
                    mirror: (
                        await sm.diamondStateMachine.localDiamondContract.getOnChainThresholdSet(
                            sm.channelId
                        )
                    ).map(String),
                    chain: await sm.membershipService.getOnChainThresholdSet()
                })
            );
            expect(listing.mirror).to.not.include(member.address);
            expect(listing.chain).to.include(member.address);

            const chainTime = await Clock.getBlockchainTime();
            const signed = await SignatureUtils.signJoinChannel(
                {
                    participant: joiner.address,
                    channelId: h.channelId,
                    balance: { amount: 500n, data: "0x00" },
                    deadlineTimestamp: BigInt(chainTime.timestamp + 120)
                },
                joiner.signer
            );
            const response = await h.execOnHost(
                h.getPeer(joiner.index),
                async (sm, args) =>
                    sm.p2pManager.remoteRpc.joinChannelService
                        .requestJoinSignature(args.encodedRequest)
                        .request(args.member),
                {
                    member: member.address,
                    encodedRequest: String(
                        Codec.encode(
                            {
                                encodedJoinChannel: String(signed.encoded),
                                signature: String(signed.signature)
                            },
                            Type.SignedJoinChannel
                        )
                    )
                }
            );
            expect(
                SignatureUtils.getSignerAddress(
                    String(signed.encoded),
                    String(response.signature)
                )
            ).to.equal(member.address);
        } finally {
            await held.release();
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
        // (|now - blockTs| > agreementTime) and dispute. The whole body
        // therefore runs before the first block, whose window is only
        // evidenceTime + p2pTime after genesis; on a loaded farm two spawns
        // and the grace waits outlast the default, so this channel models a
        // long p2p window and keeps the agreement window the grace uses.
        await h.lifecycle.start(2, 0, { timeConfig: { p2pTime: 30 } });
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
            encodedRequest: string
        ) =>
            h.execOnHost(
                h.getPeer(fromPeerIndex),
                async (sm, args) =>
                    sm.p2pManager.remoteRpc.joinChannelService
                        .requestJoinSignature(args.encodedRequest)
                        .request(args.toAddress),
                { toAddress, encodedRequest }
            );

        const valid = await request(
            joiner.index,
            h.getPeer(0).address,
            encodedSignedJoinChannel
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
                        args.encodedRequest
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
            { encodedRequest: encodedSignedJoinChannel }
        );
        expect(missingPeerResult).to.equal(
            "requestJoinSignature: missing peer address"
        );

        await assert.rejects(
            request(joiner.index, h.getPeer(0).address, "0xdeadbeef")
        );

        await assert.rejects(
            request(1, h.getPeer(0).address, encodedSignedJoinChannel),
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
                )
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
            request(joiner.index, h.getPeer(0).address, invalidSignatureRequest)
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
                )
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
                )
            ),
            /join expired/
        );

        await assert.rejects(
            request(
                joiner.index,
                nonUnionSigner.address,
                encodedSignedJoinChannel
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
            encodedSignedJoinChannel
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
        expect(
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).hash
        ).to.not.equal(prepared.expectedSnapshotHash);
        // The signature covers only the encoded join, so the responder signs
        // it after the snapshot moved away from the joiner's pin.
        const afterSnapshotMove = await request(
            joiner.index,
            h.getPeer(0).address,
            encodedSignedJoinChannel
        );
        expect(
            SignatureUtils.getSignerAddress(
                String(signed.encoded),
                String(afterSnapshotMove.signature)
            )
        ).to.equal(h.getPeer(0).address);
        const { participant: unreachable } = await h.join.forceInboundJoinWait({
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
            (error: Error) => {
                // the error names the threshold member that never connected
                expect(error.name).to.equal("JoinCollectionError");
                expect(error.message).to.equal(
                    `collectJoinChannelConfirmation: collection failed: ${getChecksumAddress(unreachable)} (unreachable: no transport after the reachability grace)`
                );
                return true;
            }
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
            async (sm) => ({ status: sm.status }),
            {}
        );
        expect(refusalState.status).to.equal(Status.SYNCED);
        expect(await readTrackedJoin(h, h.getPeer(joiner.index))).to.equal(
            null
        );
    });

    it("waits through reachability grace until a threshold participant's handshake completes, then collects every countersignature", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1);
        const joiner = await h.join.addSpectatorWait();
        await h.assert.sync.peersInSyncWait();
        const missing = h.getPeer(1);
        const joinerControl = h.control(joiner);
        // the joiner loses peer 1, then holds the handshake that would
        // prove peer 1's address again
        await h
            .control(missing)
            .network.blacklistAndDisconnectPeerByAddress(joiner.address)
            .request();
        await joinerControl.network
            .blacklistAndDisconnectPeerByAddress(missing.address)
            .request();
        await joinerControl.stub.holdInitHandshakes().request();
        await h.network.restorePairDiscovery(joiner.index, missing.index);
        await waitFor(
            async () =>
                (await joinerControl.stub.getHeldHandshakeCount().request()) >
                0,
            h.event.protocolEventTimeoutMs()
        );
        const scheduled = await h.rpcStub.recordScheduledTasks(joiner.index);
        try {
            const chainTime = await Clock.getBlockchainTime();
            const collecting =
                joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation({
                    participant: joiner.address,
                    channelId: h.channelId,
                    balance: { amount: 500n, data: "0x00" },
                    deadlineTimestamp: BigInt(chainTime.timestamp + 120)
                });
            // collection is in the grace wait once it scheduled its timeout
            await waitFor(async () =>
                (await scheduled.tasks()).some(
                    (task) =>
                        task.taskName ===
                        "join threshold participant reachability"
                )
            );
            await joinerControl.stub.releaseInitHandshakes().request();
            const prepared = await collecting;
            expect(prepared.confirmation.signatures).to.have.length(2);
        } finally {
            await scheduled.restore();
        }
    });

    it("keeps waiting through reachability grace after a handshake that leaves another threshold participant unreachable", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const joiner = await h.join.addSpectatorWait();
        await h.assert.sync.peersInSyncWait();
        const [first, second] = [h.getPeer(1), h.getPeer(2)];
        const joinerControl = h.control(joiner);
        // the joiner loses peers 1 and 2, then holds the handshake that
        // would prove peer 1's address again
        for (const missing of [first, second]) {
            await h
                .control(missing)
                .network.blacklistAndDisconnectPeerByAddress(joiner.address)
                .request();
            await joinerControl.network
                .blacklistAndDisconnectPeerByAddress(missing.address)
                .request();
        }
        await joinerControl.stub.holdInitHandshakes().request();
        await h.network.restorePairDiscovery(joiner.index, first.index);
        await waitFor(
            async () =>
                (await joinerControl.stub.getHeldHandshakeCount().request()) >
                0,
            h.event.protocolEventTimeoutMs()
        );
        await h
            .control(h.getPeer(0))
            .stub.stubCountJoinSignatureRequests()
            .request();
        const scheduled = await h.rpcStub.recordScheduledTasks(joiner.index);
        try {
            const chainTime = await Clock.getBlockchainTime();
            let settled = false;
            const collecting = joiner.p2pInstance.p2pSigner
                .collectJoinChannelConfirmation({
                    participant: joiner.address,
                    channelId: h.channelId,
                    balance: { amount: 500n, data: "0x00" },
                    deadlineTimestamp: BigInt(chainTime.timestamp + 120)
                })
                .finally(() => {
                    settled = true;
                });
            await waitFor(async () =>
                (await scheduled.tasks()).some(
                    (task) =>
                        task.taskName ===
                        "join threshold participant reachability"
                )
            );
            // peer 1's handshake completes during the grace; peer 2 is
            // still unreachable
            await joinerControl.stub.releaseInitHandshakes().request();
            await waitFor(async () =>
                (await joiner.p2pInstance.p2pSigner.getOpenConnections()).some(
                    (connection) => connection.peerAddress === first.address
                )
            );
            expect(settled).to.equal(false);
            expect(
                await h
                    .control(h.getPeer(0))
                    .stub.getJoinSignatureRequestCount()
                    .request()
            ).to.equal(0);
            await h.network.restorePairDiscovery(joiner.index, second.index);
            const prepared = await collecting;
            expect(prepared.confirmation.signatures).to.have.length(3);
        } finally {
            await scheduled.restore();
        }
    });

    it("rejects erroring, wrong-signer, and deadline-silent threshold members", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1);
        // Spawn-only, classified (plan 30 item 5): the join-signature flow needs a
        // synced joiner before any transition; nothing authors while it syncs.
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
            {
                name: "JoinCollectionError",
                message: `collectJoinChannelConfirmation: collection failed: ${responder.address} (no-answer: stubbed join-signature failure)`
            }
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
            {
                name: "JoinCollectionError",
                message: `collectJoinChannelConfirmation: collection failed: ${responder.address} (wrong-signer: signed by ${joiner.address})`
            }
        );

        // every failed member is named, not only the first
        const other = h.getPeer(1);
        await h.control(other).stub.stubFailJoinSignatureRequests().request();
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            ),
            {
                name: "JoinCollectionError",
                message: `collectJoinChannelConfirmation: collection failed: ${responder.address} (wrong-signer: signed by ${joiner.address}), ${other.address} (no-answer: stubbed join-signature failure)`
            }
        );
        for (const member of [responder, other]) {
            await h
                .control(member)
                .stub.restoreJoinSignatureRequests()
                .request();
        }

        await h.control(responder).stub.holdJoinSignatureResponses().request();
        try {
            const shortWindowTime = await Clock.getBlockchainTime();
            const startedAt = Date.now();
            await assert.rejects(
                joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation({
                    ...joinChannel,
                    deadlineTimestamp: BigInt(shortWindowTime.timestamp + 1)
                })
            );
            expect(Date.now() - startedAt).to.be.lessThan(2800);
        } finally {
            await h
                .control(responder)
                .stub.releaseJoinSignatureResponses()
                .request();
        }

        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(await readTrackedJoin(h, h.getPeer(joiner.index))).to.equal(
            null
        );
    });

    it("a connect's join with one silent threshold member returns false: the joiner aborts and disposes, and submits nothing", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        const [silentIndex] = await remoteThresholdPeerIndices(h, joiner.index);
        const silent = h.getPeer(silentIndex);
        // the member answers only after the joiner's request deadline
        await h.control(silent).stub.holdJoinSignatureResponses().request();
        const nonceBefore = await h.provider.getTransactionCount(
            joiner.address
        );
        try {
            expect(
                await joiner.p2pInstance.p2pSigner.connectToChannel(
                    h.channelId!,
                    { shouldJoin: true }
                )
            ).to.equal(false);
            await waitFor(
                async () => joiner.eventSpies.onAbort?.called === true,
                h.event.protocolEventTimeoutMs()
            );
            expect(joiner.eventSpies.onAbort?.callCount).to.equal(1);
            await waitFor(() => runtimeIsClosed(joiner.p2pInstance));
            expect(
                await h.provider.getTransactionCount(joiner.address)
            ).to.equal(nonceBefore);
            expect(
                await h.channelManager.getPendingParticipants(h.channelId)
            ).to.not.include(joiner.address);
        } finally {
            await h
                .control(silent)
                .stub.releaseJoinSignatureResponses()
                .request();
        }
    });

    it("a committed member's top-up through connect with one silent threshold member returns false: it keeps its status and submits nothing", async function () {
        const h = TestSession.getHarness();
        await h.scenario.syncSpectator();
        const participant = h.getPeer(0);
        const [silentIndex] = await remoteThresholdPeerIndices(
            h,
            participant.index
        );
        const silent = h.getPeer(silentIndex);
        await h.control(silent).stub.holdJoinSignatureResponses().request();
        const nonceBefore = await h.provider.getTransactionCount(
            participant.address
        );
        try {
            expect(
                await participant.p2pInstance.p2pSigner.connectToChannel(
                    h.channelId!,
                    { shouldJoin: true, balance: { amount: 5, data: "0x" } }
                )
            ).to.equal(false);
            expect(
                await h.control(participant).query.getStatus().request()
            ).to.equal(Status.PARTICIPATING);
            expect(participant.eventSpies.onAbort?.called ?? false).to.equal(
                false
            );
            expect(
                await h.provider.getTransactionCount(participant.address)
            ).to.equal(nonceBefore);
        } finally {
            await h
                .control(silent)
                .stub.releaseJoinSignatureResponses()
                .request();
        }
    });

    it("a connect's join whose threshold set read fails rejects: the failure is not a collection failure, so the joiner neither aborts nor submits", async function () {
        const h = TestSession.getHarness();
        const joiner = await h.scenario.syncSpectator();
        await h.control(joiner).stub.failNextJoinThresholdRead().request();
        const nonceBefore = await h.provider.getTransactionCount(
            joiner.address
        );
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.connectToChannel(h.channelId!, {
                shouldJoin: true
            }),
            /stubbed threshold set read failure/
        );
        expect(joiner.eventSpies.onAbort?.called ?? false).to.equal(false);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(await h.provider.getTransactionCount(joiner.address)).to.equal(
            nonceBefore
        );
    });
});
