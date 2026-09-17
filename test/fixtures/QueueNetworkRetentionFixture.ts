// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import * as factory from "../factory";
import { signBlockVariant } from "./QueueAdmissionFixture";
import { Block } from "@/models";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertIndependentNetworkAllowances(
    validVariants = false
) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 0, { maxChannelParticipants: 3 });
    const { leader, observer, authored } =
        await h.transition.authorNextBlockOffWireWait();
    await h.control(leader).stub.restoreBroadcast().request();
    const badSource = h.peers.find(
        (peer) => peer.index !== leader.index && peer.index !== observer.index
    )!;
    const hold = await h.rpcStub.holdBlockWork(observer.index, "queueDequeue");
    const confirmation = Codec.decode(
        authored.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const malformedValues = [
        "0x" + "00".repeat(64) + "1b",
        "0x" + "00".repeat(64) + "ff",
        "0x" + "00".repeat(63) + "011b"
    ];
    const wallet = h.signerFor(slotAccountIndex(badSource.index));
    expect(wallet.address).to.equal(badSource.address);
    const badValues = validVariants
        ? Array.from({ length: 8 }, (_, index) =>
              signBlockVariant(wallet, authored.hash, index)
          )
        : malformedValues;
    const encodedBad = String(
        Codec.encode(
            { signedBlock: confirmation.signedBlock, signatures: badValues },
            Type.BlockConfirmation
        )
    );
    const validSignatures = await Promise.all(
        h.peers.map((peer) =>
            peer.signer.signMessage(ethers.getBytes(authored.hash))
        )
    );
    const encodedGood = String(
        Codec.encode(
            {
                signedBlock: confirmation.signedBlock,
                signatures: validSignatures
            },
            Type.BlockConfirmation
        )
    );
    try {
        await h
            .control(badSource)
            .byzantine.sendBlockConfirmation(encodedBad, observer.address)
            .request();
        await hold.waitUntilEntered();
        await h
            .control(badSource)
            .byzantine.sendBlockConfirmation(encodedGood, observer.address)
            .request();
        await h
            .control(leader)
            .byzantine.sendBlockConfirmation(encodedGood, observer.address)
            .request();
        await waitFor(
            async () =>
                (
                    await h
                        .control(observer)
                        .query.getQueuedRetention(authored.hash)
                        .request()
                )?.sourceCount === 2
        );
        const retained = await h
            .control(observer)
            .query.getQueuedRetention(authored.hash)
            .request();
        expect(retained?.perSource).to.have.deep.members([
            { source: badSource.address, count: 3 },
            { source: leader.address, count: 3 }
        ]);
        expect(retained?.retainedSignatures).to.equal(5);
        if (validVariants)
            expect(
                retained?.perSource.every((entry) => entry.count <= 3)
            ).to.equal(true);
        expect(
            Number(await h.channelManager.getMaxChannelParticipants())
        ).to.equal(3);
        expect(retained?.maxChannelParticipants).to.equal(3);
        await hold.release();
        await waitFor(async () => {
            const block = await h
                .control(observer)
                .query.getBlockByHash(authored.hash)
                .request();
            return (
                block !== null &&
                new Set([block.author, ...block.confirmationSignerAddresses])
                    .size === 3
            );
        });
        const stored = await h
            .control(observer)
            .query.getBlockByHash(authored.hash)
            .request();
        expect([
            ...new Set([stored!.author, ...stored!.confirmationSignerAddresses])
        ]).to.have.members(h.peers.map((peer) => peer.address));
        if (!validVariants)
            expect(stored?.confirmationSignatures).not.to.include.members(
                badValues
            );
        else
            expect(stored?.confirmationSignatures).to.include.members(
                badValues.slice(0, 2)
            );
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(badSource.address)
                .request()
        ).to.equal(!validVariants);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(leader.address)
                .request()
        ).to.equal(false);
        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .query.getQueuedRetention(authored.hash)
                    .request()) === null
        );
        h.assert.dispute.noDisputes();
    } finally {
        await hold.release();
    }
}

export async function assertStoredMalformedNetworkCopy() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 1, { maxChannelParticipants: 3 });
    const observer = h.getPeer(0),
        source = h.getPeer(1);
    const before = await h
        .control(observer)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!before) throw new Error("Expected a committed block");
    const confirmation = Codec.decode(
        before.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const malformed = "0x" + "00".repeat(64) + "ff";
    const encodedBlockConfirmation = String(
        Codec.encode(
            {
                signedBlock: confirmation.signedBlock,
                signatures: [malformed, ...confirmation.signatures]
            },
            Type.BlockConfirmation
        )
    );
    await h
        .control(source)
        .byzantine.sendBlockConfirmation(
            encodedBlockConfirmation,
            observer.address
        )
        .request();
    await waitFor(
        async () =>
            await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
    );
    const after = await h
        .control(observer)
        .query.getBlockByHash(before.hash)
        .request();
    expect(after?.hash).to.equal(before.hash);
    expect(after?.height).to.equal(before.height);
    expect(after?.confirmationSignatures).to.have.members(
        before.confirmationSignatures
    );
    expect(after?.confirmationSignatures).not.to.include(malformed);
    expect(
        await h
            .control(observer)
            .query.isBlacklisted(h.getPeer(2).address)
            .request()
    ).to.equal(false);
    h.assert.dispute.noDisputes();
}

export async function assertOutsiderProofDoesNotAdmitCopy(
    mode: "success" | "busy" | "failure" = "success",
    failMembership = false
) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const { peer: outsider } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const observer = h.getPeer(0);
    const stored = await h
        .control(outsider)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!stored) throw new Error("Expected a verified spectator block");
    const encodedBlockConfirmation =
        mode === "failure"
            ? await factory.buildAndEncodeBlock(h.getPeer(1).signer, {
                  header: {
                      channelId: h.channelId,
                      forkId: h.activeForkId!,
                      transactionCnt: stored.height + 20,
                      participant: h.getPeer(1).address
                  }
              })
            : stored.encodedBlockConfirmation;
    const block = Block.fromBlockConfirmation(
        Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation)
    );
    await h
        .control(observer)
        .stub.observeAdmission({ source: outsider.address, failMembership })
        .request();
    await h.control(outsider).stub.holdSpectateResponses().request();
    const ordinarySync =
        mode === "busy"
            ? h
                  .control(observer)
                  .spectate.sync(
                      outsider.address,
                      h.activeForkId!,
                      stored.height
                  )
                  .request()
            : undefined;
    try {
        if (ordinarySync)
            await waitFor(
                async () =>
                    (await h
                        .control(outsider)
                        .stub.getHeldSpectateResponseCount()
                        .request()) === 1
            );
        await h
            .control(outsider)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                observer.address
            )
            .request();
        if (mode !== "failure") {
            await waitFor(
                async () =>
                    (await h
                        .control(outsider)
                        .stub.getHeldSpectateResponseCount()
                        .request()) === 1
            );
        }

        if (ordinarySync || mode === "failure")
            await waitFor(
                async () =>
                    (
                        await h
                            .control(observer)
                            .stub.getAdmissionObservation()
                            .request()
                    ).completedIntakes === 1
            );
        else if (mode === "success")
            expect(
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).completedIntakes
            ).to.equal(0);
        expect(
            await h
                .control(observer)
                .query.getQueuedRetention(block.hash)
                .request()
        ).to.equal(null);
        expect(
            (await h.control(observer).stub.getAdmissionObservation().request())
                .syncRequests
        ).to.equal(1);
        await h.control(outsider).stub.releaseSpectateResponses().request();
        await waitFor(
            async () =>
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).completedIntakes === 1
        );
        if (ordinarySync) await ordinarySync;
        if (mode === "success")
            expect(
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).successfulSyncs
            ).to.equal(1);
        expect(
            await h
                .control(observer)
                .query.getQueuedRetention(block.hash)
                .request()
        ).to.equal(null);
        expect(
            (await h.control(observer).stub.getAdmissionObservation().request())
                .networkEntries
        ).to.equal(0);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(outsider.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(observer)
                .query.getSourceEligibility(outsider.address)
                .request()
        ).to.equal(SourceEligibility.ABSENT);
        if (mode === "failure")
            expect(
                await h
                    .control(observer)
                    .query.getBlockByHash(block.hash)
                    .request()
            ).to.equal(null);
        else
            expect(
                (
                    await h
                        .control(observer)
                        .query.getBlockByHash(stored.hash)
                        .request()
                )?.hash
            ).to.equal(stored.hash);
        h.assert.dispute.noDisputes();
    } finally {
        await h.control(outsider).stub.releaseSpectateResponses().request();
        await ordinarySync;
        await h.control(observer).stub.restoreAdmissionObservation().request();
    }
}

export async function assertPendingJoinAdmission(dropEvent: boolean) {
    const h = MathTestSession.getHarness();
    const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
    const observer = h.getPeer(0),
        joiner = prepared.joiner;
    const block = await h
        .control(observer)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!block) throw new Error("Expected a committed block");
    const dropped = dropEvent
        ? await h.rpcStub.dropInboundMessageLogs(observer.index)
        : undefined;
    try {
        expect(
            await h
                .control(observer)
                .query.getSourceEligibility(joiner.address)
                .request()
        ).to.equal(SourceEligibility.ABSENT);
        await h.control(observer).stub.observeAdmission().request();
        await joiner.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        if (dropped) await dropped.waitUntilDropped();
        else
            await waitFor(
                async () =>
                    (await h
                        .control(observer)
                        .query.getSourceEligibility(joiner.address)
                        .request()) === SourceEligibility.ELIGIBLE
            );
        expect(
            (await h
                .control(observer)
                .query.getSourceEligibility(joiner.address)
                .request()) === SourceEligibility.ELIGIBLE
        ).to.equal(!dropEvent);
        const validation = await h.rpcStub.holdBlockWork(
            observer.index,
            "confirmationValidation"
        );
        try {
            await h
                .control(joiner)
                .byzantine.sendBlockConfirmation(
                    block.encodedBlockConfirmation,
                    observer.address
                )
                .request();
            await validation.waitUntilEntered();
            // Reaching held validation proves this stored copy passed source admission.
            const mirrored = await h.execOnHost(observer, (sm) =>
                sm.diamondStateMachine.localDiamondContract.getOnChainThresholdSet(
                    sm.channelId
                )
            );
            expect(mirrored).to.include(joiner.address);
            expect(
                await h
                    .control(observer)
                    .query.getQueuedRetention(block.hash)
                    .request()
            ).to.equal(null);
            expect(
                (await h
                    .control(observer)
                    .query.getSourceEligibility(joiner.address)
                    .request()) === SourceEligibility.ELIGIBLE
            ).to.equal(true);
            expect(
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).chainReads
            ).to.equal(dropEvent ? 1 : 0);
            expect(
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).syncRequests
            ).to.equal(0);
            expect(
                await h
                    .control(observer)
                    .query.isBlacklisted(joiner.address)
                    .request()
            ).to.equal(false);
        } finally {
            await validation.release();
        }
    } finally {
        await dropped?.release();
        await h.control(observer).stub.restoreAdmissionObservation().request();
    }
}

export async function assertStoredCopyQuota(network: boolean) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 1, { maxChannelParticipants: 3 });
    const observer = h.getPeer(0),
        source = h.getPeer(1);
    const block = await h
        .control(observer)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!block) throw new Error("Expected stored block");
    await waitFor(
        async () =>
            (await h
                .control(observer)
                .query.getQueuedRetention(block.hash)
                .request()) === null
    );
    const wallet = h.signerFor(slotAccountIndex(source.index));
    const variants = Array.from({ length: 13 }, (_, index) =>
        signBlockVariant(wallet, block.hash, index)
    );
    for (const signature of variants)
        expect(
            ethers.verifyMessage(ethers.getBytes(block.hash), signature)
        ).to.equal(source.address);
    const confirmation = Codec.decode(
        block.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const hold = await h.rpcStub.holdBlockWork(
        observer.index,
        "confirmationValidation"
    );
    await h
        .control(observer)
        .stub.observeAdmission({ source: source.address })
        .request();
    let delivered = 0;
    const deliver = async (signatures: string[]) => {
        const encodedBlockConfirmation = String(
            Codec.encode(
                { signedBlock: confirmation.signedBlock, signatures },
                Type.BlockConfirmation
            )
        );
        if (network)
            await h
                .control(source)
                .byzantine.sendBlockConfirmation(
                    encodedBlockConfirmation,
                    observer.address
                )
                .request();
        else
            await h
                .control(observer)
                .transition.ingestBlockConfirmation(encodedBlockConfirmation, {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: source.address
                })
                .request();
        delivered++;
        await waitFor(
            async () =>
                (
                    await h
                        .control(observer)
                        .stub.getAdmissionObservation()
                        .request()
                ).completedIntakes >= delivered
        );
    };
    try {
        await deliver(variants.slice(0, 8));
        await hold.waitUntilEntered();
        expect(
            await h
                .control(observer)
                .query.getQueuedRetention(block.hash)
                .request()
        ).to.equal(null);
        await deliver(variants.slice(8));
        await hold.release();
        await waitFor(
            async () =>
                (
                    await h
                        .control(observer)
                        .query.getBlockByHash(block.hash)
                        .request()
                )?.confirmationSignatures.includes(variants[1]) ?? false
        );
        await waitFor(
            async () =>
                (await h
                    .control(observer)
                    .query.getQueuedRetention(block.hash)
                    .request()) === null
        );
        const after = await h
            .control(observer)
            .query.getBlockByHash(block.hash)
            .request();
        expect(after?.confirmationSignatures).to.have.members([
            ...new Set([
                ...block.confirmationSignatures,
                ...variants.slice(0, 2),
                ...variants.slice(8, 10)
            ])
        ]);
        expect(after?.height).to.equal(block.height);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
        ).to.equal(false);
    } finally {
        await hold.release();
        await h.control(observer).stub.restoreAdmissionObservation().request();
    }
}
