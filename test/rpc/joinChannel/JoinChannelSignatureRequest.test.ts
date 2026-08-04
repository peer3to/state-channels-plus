import { expect } from "chai";
import assert from "node:assert/strict";

import Clock from "@/Clock";
import { Status } from "@/types";
import { Codec, SignatureUtils, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

describe("JoinChannel signature requests", function () {
    it("validates requests, signs exact joins, and fails fast when a threshold transport is missing", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1);
        const joiner = await h.join.addSpectatorWait();
        const nonUnionSigner = await h.join.addSpectatorWait();
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
            String(
                SignatureUtils.getSignerAddress(
                    String(signed.encoded),
                    String(valid.signature)
                )
            ).toLowerCase()
        ).to.equal(h.getPeer(0).address.toLowerCase());

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

        await h.join.forceInboundJoinWait({
            waitForHonestPeersObserve: false
        });
        const startedAt = Date.now();
        await assert.rejects(
            joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            ),
            /no transport for threshold participant/
        );
        expect(Date.now() - startedAt).to.be.lessThan(1000);
        const refusalState = await h.execOnHost(
            h.getPeer(joiner.index),
            async (sm) => ({
                status: sm.getStatus(),
                joinSubmissionHeight:
                    sm.storage.forceJoin.getJoinSubmissionBlockHeight()
            }),
            {}
        );
        expect(refusalState.status).to.equal(Status.SYNCED);
        expect(refusalState.joinSubmissionHeight).to.equal(undefined);
    });
});
