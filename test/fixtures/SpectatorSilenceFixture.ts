// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import * as factory from "../factory";
import { Block } from "@/models";
import { BlockValidationResult, Status } from "@/types";
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** Observe actual outbound gossip while real participants supply fresh and late copies. */
export async function assertSpectatorSilence() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1);
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const author = await h.query.getNextPeerToWrite();
    const confirmer = h.getPeer(author.index === 0 ? 1 : 0);
    await h.control(spectator).stub.observeAdmission().request();
    await h
        .control(confirmer)
        .stub.observeAdmission({ holdGossip: true })
        .request();
    try {
        await h.transition.increment(1, {
            waitForPeers: [0, 1, spectator.index],
            waitForFinalization: false
        });
        const fresh = await h
            .control(spectator)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        if (!fresh) throw new Error("Expected a fresh spectator block");
        expect(fresh.confirmationSignerAddresses).not.to.include(
            confirmer.address
        );
        expect(
            (
                await h
                    .control(spectator)
                    .stub.getAdmissionObservation()
                    .request()
            ).broadcasts
        ).to.equal(0);
        await h.control(confirmer).stub.releaseAdmissionGossip().request();
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        const finalized = await h
            .control(spectator)
            .query.getBlockByHash(fresh.hash)
            .request();
        expect([
            ...new Set([
                finalized!.author,
                ...finalized!.confirmationSignerAddresses
            ])
        ]).to.have.members([author.address, confirmer.address]);
        expect(
            (
                await h
                    .control(spectator)
                    .stub.getAdmissionObservation()
                    .request()
            ).broadcasts
        ).to.equal(0);
        await h
            .control(author)
            .byzantine.sendBlockConfirmation(
                finalized!.encodedBlockConfirmation,
                spectator.address
            )
            .request();
        await waitFor(
            async () =>
                (await h
                    .control(spectator)
                    .query.getQueuedRetention(fresh.hash)
                    .request()) === null
        );
        const afterDuplicate = await h
            .control(spectator)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        expect(afterDuplicate?.hash).to.equal(fresh.hash);
        expect(afterDuplicate?.confirmationSignatures).to.have.members(
            finalized!.confirmationSignatures
        );
        expect(
            (
                await h
                    .control(spectator)
                    .stub.getAdmissionObservation()
                    .request()
            ).broadcasts
        ).to.equal(0);
        const sync = await h
            .control(author)
            .spectate.sync(
                spectator.address,
                h.activeForkId!,
                finalized!.height
            )
            .request();
        expect(sync).to.equal(true);
        expect(
            await h
                .control(author)
                .query.isBlacklisted(spectator.address)
                .request()
        ).to.equal(false);
        await h.transition.increment(1, {
            waitForPeers: [0, 1, spectator.index],
            waitForFinalization: true
        });
        h.assert.dispute.noDisputes();
    } finally {
        await h.control(confirmer).stub.releaseAdmissionGossip().request();
        await h.control(confirmer).stub.restoreAdmissionObservation().request();
        await h.control(spectator).stub.restoreAdmissionObservation().request();
    }
}

export async function assertSpectatorRejectedWork(
    kind: "invalid" | "not-ready"
) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1);
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const source = h.getPeer(0);
    const before = await h
        .control(spectator)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    if (!before) throw new Error("Expected synced spectator state");
    await h.control(spectator).stub.observeAdmission().request();
    try {
        const encodedBlockConfirmation = await factory.buildAndEncodeBlock(
            source.signer,
            {
                header: {
                    channelId: h.channelId,
                    forkId: h.activeForkId!,
                    transactionCnt: before.height + 5,
                    participant: h.getPeer(kind === "invalid" ? 1 : 0).address
                }
            }
        );
        await h
            .control(source)
            .byzantine.sendBlockConfirmation(
                encodedBlockConfirmation,
                spectator.address
            )
            .request();
        if (kind === "invalid")
            await waitFor(
                async () =>
                    await h
                        .control(spectator)
                        .query.isBlacklisted(source.address)
                        .request()
            );
        else {
            const confirmation = Codec.decode(
                encodedBlockConfirmation,
                Type.BlockConfirmation
            );
            const hash = Block.fromBlockConfirmation(confirmation).hash;
            await waitFor(
                async () =>
                    (await h
                        .control(spectator)
                        .query.getQueuedRetention(hash)
                        .request()) !== null
            );
            const retained = await h
                .control(spectator)
                .query.getQueuedRetention(hash)
                .request();
            expect(retained?.sourceCount).to.equal(1);
            expect(retained?.perSource[0].source).to.equal(source.address);
            await h.execOnHost(h.getPeer(spectator.index), (sm) =>
                sm.blockQueueManager.clearFork(sm.forkId)
            );
        }
        const after = await h
            .control(spectator)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        expect(after?.hash).to.equal(before.hash);
        expect(after?.height).to.equal(before.height);
        expect(
            (
                await h
                    .control(spectator)
                    .stub.getAdmissionObservation()
                    .request()
            ).broadcasts
        ).to.equal(0);
        expect(
            await h
                .control(spectator)
                .query.isBlacklisted(h.getPeer(1).address)
                .request()
        ).to.equal(false);
    } finally {
        await h.control(spectator).stub.restoreAdmissionObservation().request();
    }
}

export async function assertSpectatorStoredMerge(pending = false) {
    const h = MathTestSession.getHarness();
    const prepared = pending
        ? await h.scenario.syncSpectatorAndPrepareJoin(0)
        : undefined;
    if (!prepared) await h.lifecycle.start(2, 1);
    const spectator =
        prepared?.joiner ??
        (
            await h.join.addSpectatorAuthoring({
                authoringPeerIndices: [0, 1],
                minimumBlocks: 2,
                maximumBlocks: 20
            })
        ).peer;
    const participants = pending ? [0, 1, 2] : [0, 1];
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const author = await h.query.getNextPeerToWrite();
    const confirmer = h.getPeer(author.index === 0 ? 1 : 0);
    await h
        .control(confirmer)
        .stub.observeAdmission({ holdGossip: true })
        .request();
    await h.control(spectator).stub.observeAdmission().request();
    try {
        await h.transition.increment(1, {
            waitForPeers: [...participants, spectator.index],
            waitForFinalization: false
        });
        const before = await h
            .control(spectator)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        const complete = await h
            .control(confirmer)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        if (!before || !complete)
            throw new Error("Expected matching committed copies");
        expect(before.hash).to.equal(complete.hash);
        expect(before.confirmationSignerAddresses).not.to.include(
            confirmer.address
        );
        const confirmation = Codec.decode(
            complete.encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        if (prepared) {
            await spectator.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            );
            await h.event.waitUntilPeerStatus(
                spectator.index,
                Status.PENDING_PARTICIPANT
            );
        }
        const result = await h.transition.runStoredBlockMerge({
            peerIndex: spectator.index,
            confirmation: {
                signedBlock: confirmation.signedBlock,
                signatures: confirmation.signatures.map(String)
            },
            strategy: "spectating"
        });
        expect(result.result).to.equal(BlockValidationResult.SUCCESS);
        expect(result.persistedSignatures).to.include.members(
            complete.confirmationSignatures
        );
        expect(await h.control(spectator).query.getStatus().request()).to.equal(
            pending ? Status.PENDING_PARTICIPANT : Status.SYNCED
        );
        expect(
            (
                await h
                    .control(spectator)
                    .stub.getAdmissionObservation()
                    .request()
            ).broadcasts
        ).to.equal(0);
        expect(
            (
                await h
                    .control(spectator)
                    .query.getLatestBlockBundle(h.activeForkId!)
                    .request()
            )?.height
        ).to.equal(before.height);
    } finally {
        await h.control(confirmer).stub.restoreAdmissionObservation().request();
        await h.control(spectator).stub.restoreAdmissionObservation().request();
    }
}
