// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import * as factory from "../factory";
import { signBlockVariant } from "./QueueAdmissionFixture";
import { Block } from "@/models";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { BlockValidationResult } from "@/types";
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

/** The signatures over `blockHash` that recover to `signer`. */
function signaturesBy(blockHash: string, signer: string, signatures: string[]) {
    return signatures.filter(
        (signature) =>
            ethers.verifyMessage(ethers.getBytes(blockHash), signature) ===
            signer
    );
}

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
            // The stored block keeps one of the supplier's variants for it.
            expect(
                signaturesBy(
                    authored.hash,
                    badSource.address,
                    stored!.confirmationSignatures
                )
            ).to.have.lengthOf(1);
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

        if (mode === "failure")
            await waitFor(
                async () =>
                    (
                        await h
                            .control(observer)
                            .stub.getAdmissionObservation()
                            .request()
                    ).completedIntakes === 1
            );
        else if (mode === "success" || mode === "busy")
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
    // Finalized: every participant already holds a signature on the block.
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
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
                        .stub.getAdmissionObservation()
                        .request()
                ).storedMergeResults.length >= 2
        );
        const observation = await h
            .control(observer)
            .stub.getAdmissionObservation()
            .request();
        // N = 3 values per copy, one of them the author envelope.
        expect(observation.largestNetworkEntry).to.equal(2);
        // The source already holds a signature, so neither copy adds one.
        expect(observation.storedMergeResults).to.deep.equal([
            BlockValidationResult.DUPLICATE,
            BlockValidationResult.DUPLICATE
        ]);
        expect(observation.broadcasts).to.equal(0);
        expect(
            await h
                .control(observer)
                .query.getQueuedRetention(block.hash)
                .request()
        ).to.equal(null);
        const after = await h
            .control(observer)
            .query.getBlockByHash(block.hash)
            .request();
        expect(after?.confirmationSignatures).to.have.members(
            block.confirmationSignatures
        );
        expect(after?.confirmationSignatures).to.have.lengthOf(
            block.confirmationSignatures.length
        );
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

/**
 * A participant whose honest confirmation never reached the others sends
 * repeated batches of its own alternate signatures for the stored block.
 */
export async function assertRepeatedStoredSignerVariants() {
    const h = MathTestSession.getHarness();
    // long chainFallbackTime keeps timeout disputes away while the source's
    // broadcast is suppressed to stage its missing signature
    await h.lifecycle.start(3, 1, {
        maxChannelParticipants: 3,
        timeConfig: {
            p2pTime: 4,
            agreementTime: 8,
            chainFallbackTime: 30,
            evidenceTime: 6
        }
    });
    const forkId = h.activeForkId!;
    const observer = await h.query.getNextPeerToWrite();
    const [source, bystander] = h.peers.filter(
        (peer) => peer.index !== observer.index
    );
    await h.byzantine.stubBroadcast(source.index);
    // add() resolves after the writer's own commit, so the block is stored
    await h.getPeer(observer.index).p2pInstance.p2pContractInstance.add(1);
    const authored = await h
        .control(observer)
        .query.getLatestBlockBundle(forkId)
        .request();
    expect(authored, "authored block").to.not.equal(null);
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: source.index,
        blockHash: authored!.hash,
        keepConnection: true
    });
    await h.control(source).stub.restoreBroadcast().request();
    // The author processes only the bystander's confirmation; the bystander
    // only commits the authored block with its own signature.
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: observer.index,
        blockHash: authored!.hash
    });
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: bystander.index,
        blockHash: authored!.hash
    });
    for (const peer of [observer, bystander]) {
        const stored = await h
            .control(peer)
            .query.getBlockByHash(authored!.hash)
            .request();
        expect([
            stored!.author,
            ...stored!.confirmationSignerAddresses
        ]).to.have.members([observer.address, bystander.address]);
    }

    const wallet = h.signerFor(slotAccountIndex(source.index));
    const variants = Array.from({ length: 6 }, (_, index) =>
        signBlockVariant(wallet, authored!.hash, index)
    );
    const confirmation = Codec.decode(
        authored!.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const sourceSignatures = (signatures: string[]) =>
        signaturesBy(authored!.hash, source.address, signatures);
    await h
        .control(observer)
        .stub.observeAdmission({ source: source.address })
        .request();
    const sendBatch = async (batch: number) => {
        await h
            .control(source)
            .byzantine.sendBlockConfirmation(
                String(
                    Codec.encode(
                        {
                            signedBlock: confirmation.signedBlock,
                            signatures: variants.slice(batch * 2, batch * 2 + 2)
                        },
                        Type.BlockConfirmation
                    )
                ),
                observer.address
            )
            .request();
    };
    const observerBefore = h.event.blockConfirmationsProcessed(
        observer.index,
        authored!.hash
    );
    const bystanderBefore = h.event.blockConfirmationsProcessed(
        bystander.index,
        authored!.hash
    );
    try {
        // The first batch must be merged first: it is the one with a new signer.
        await sendBatch(0);
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: observer.index,
            blockHash: authored!.hash,
            minCalls: observerBefore + 1
        });
        await sendBatch(1);
        await sendBatch(2);
        // three source batches plus the bystander relaying the new signature
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: observer.index,
            blockHash: authored!.hash,
            minCalls: observerBefore + 4
        });
        const observation = await h
            .control(observer)
            .stub.getAdmissionObservation()
            .request();
        // Only the first batch brings a new signer, so only it is relayed.
        expect(observation.storedMergeResults).to.deep.equal([
            BlockValidationResult.BROADCAST,
            BlockValidationResult.DUPLICATE,
            BlockValidationResult.DUPLICATE
        ]);
        expect(observation.broadcasts).to.equal(1);
        // the relay carries only the new signer's first signature
        expect(observation.broadcastSignatures).to.deep.equal([[variants[0]]]);

        const observed = await h
            .control(observer)
            .query.getBlockByHash(authored!.hash)
            .request();
        expect(
            sourceSignatures(observed!.confirmationSignatures)
        ).to.deep.equal([variants[0]]);
        expect(observed!.confirmationSignatures).to.have.lengthOf(
            observed!.confirmationSignerAddresses.length
        );

        // The relayed first signature reaches the bystander, and nothing else
        // from the source does.
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: bystander.index,
            blockHash: authored!.hash,
            minCalls: bystanderBefore + 1
        });
        const relayed = await h
            .control(bystander)
            .query.getBlockByHash(authored!.hash)
            .request();
        expect(sourceSignatures(relayed!.confirmationSignatures)).to.deep.equal(
            [variants[0]]
        );
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(source.address)
                .request()
        ).to.equal(false);
        h.assert.dispute.noDisputes();
    } finally {
        await h.control(observer).stub.restoreAdmissionObservation().request();
    }
}

/**
 * A block nobody else stores yet arrives with several valid signatures from
 * one participant. The receiver and the peer it relays to each store one
 * signature per signer.
 */
export async function assertNewBlockSignerVariantsStoredOnce() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(3, 0, { maxChannelParticipants: 3 });
    const { leader, observer, authored } =
        await h.transition.authorNextBlockOffWireWait();
    await h.control(leader).stub.restoreBroadcast().request();
    const source = h.peers.find(
        (peer) => peer.index !== leader.index && peer.index !== observer.index
    )!;
    const wallet = h.signerFor(slotAccountIndex(source.index));
    const variants = [0, 1].map((variant) =>
        signBlockVariant(wallet, authored.hash, variant)
    );
    const confirmation = Codec.decode(
        authored.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const leaderBefore = h.event.blockConfirmationsProcessed(
        leader.index,
        authored.hash
    );
    await h
        .control(source)
        .byzantine.sendBlockConfirmation(
            String(
                Codec.encode(
                    {
                        signedBlock: confirmation.signedBlock,
                        signatures: variants
                    },
                    Type.BlockConfirmation
                )
            ),
            observer.address
        )
        .request();
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: observer.index,
        blockHash: authored.hash
    });
    const stored = await h
        .control(observer)
        .query.getBlockByHash(authored.hash)
        .request();
    expect(
        signaturesBy(
            authored.hash,
            source.address,
            stored!.confirmationSignatures
        )
    ).to.deep.equal([variants[0]]);
    expect(stored!.confirmationSignatures).to.have.lengthOf(
        stored!.confirmationSignerAddresses.length
    );

    // The leader, which authored the block, keeps one signature of the
    // source, whichever copy reaches it first.
    await h.event.waitForBlockConfirmationProcessed({
        peerIndex: leader.index,
        blockHash: authored.hash,
        minCalls: leaderBefore + 1
    });
    const relayed = await h
        .control(leader)
        .query.getBlockByHash(authored.hash)
        .request();
    expect(
        signaturesBy(
            authored.hash,
            source.address,
            relayed!.confirmationSignatures
        )
    ).to.have.lengthOf(1);
    expect(relayed!.confirmationSignatures).to.have.lengthOf(
        relayed!.confirmationSignerAddresses.length
    );
    h.assert.dispute.noDisputes();
}
