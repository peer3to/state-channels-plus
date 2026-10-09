// @spec-test-coverage-ignore: staged sync install staging exercised by explicit SpectateService declarations
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import { stageSpectatorBehindUnfinalizedTail } from "./SyncReplayBaseStaging";
import { Block } from "@/models";
import type { SyncPayload } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import {
    latestHeight,
    proofHeights,
    servedPayload,
    syncFromResponder
} from "@test/fixtures/MilestoneSyncStaging";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;

/** What an install changes on `peer`: VM, latest state, head, fork, status. */
async function installState(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: ForkId
) {
    const query = h.control(peer).query;
    return {
        vmState: await h.execOnHost(peer, (sm) =>
            sm.diamondStateMachine.getState()
        ),
        stateHash: await query.getLatestStateMachineStateHash(forkId).request(),
        latestHeight: await query.getLatestBlockHeight(forkId).request(),
        forkId: await query.getForkId().request(),
        status: await query.getStatus().request()
    };
}

/** The served finalized block at `height`, re-signed by `signer` with another snapshot hash. */
async function conflictingBlock(
    payload: SyncPayload,
    height: number,
    signer: ethers.Signer
): Promise<Block> {
    const served = payload.stateProof.milestones
        .flatMap((milestone) => milestone.blockConfirmations)
        .map((confirmation) => Block.fromBlockConfirmation(confirmation))
        .find((block) => block.height === height);
    expect(served, `served block at ${height}`).to.not.be.undefined;
    const struct = Codec.decode(served!.encode(), Type.Block);
    struct.stateSnapshotHash = ethers.keccak256(
        ethers.toUtf8Bytes(`conflict-${served!.hash}`)
    );
    return await Block.fromBlockStruct(struct, signer);
}

/**
 * The spectator stands one height below the served base. Its sync stages
 * the proof, then the install is held at its entry, before the VM write.
 * With `conflict`, a different block is stored at the base height in that
 * window, as a dispute audit stores verified blocks outside the state mutex.
 * The commit then finds the conflict: the VM is restored and nothing is
 * published. Without it the base installs and the sync reaches the tip.
 */
export async function assertConflictBeforeSyncCommit(
    h: MathPeerTestHarness,
    conflict: boolean
): Promise<void> {
    const { forkId, spectator, responder, tip } =
        await stageSpectatorBehindUnfinalizedTail(h, {
            finalBlocksWhileCutOff: 1
        });
    const payload = await servedPayload(h, responder, forkId);
    const baseHeight = proofHeights(payload).at(-1)![0];
    const before = await installState(h, spectator, forkId);
    // premise - the requester stands one below the base, so it installs
    expect(before.latestHeight).to.equal(baseHeight - 1);
    const block = await conflictingBlock(payload, baseHeight, spectator.signer);
    const control = h.control(spectator);
    await control.stub.holdSyncInstall().request();
    try {
        const sync = syncFromResponder(h, spectator, responder, forkId, tip);
        await waitFor(
            async () =>
                (await control.stub.getSyncInstallEntered().request()) === 1
        );
        if (conflict)
            expect(
                await control.spectate
                    .storeBlockJustPersist(
                        Codec.encode(
                            block.signedBlock,
                            Type.SignedBlock
                        ) as string
                    )
                    .request()
            ).to.equal(block.hash);
        await control.stub.releaseSyncInstall().request();
        if (!conflict) {
            expect(await sync).to.deep.equal({
                synced: true,
                rejections: [],
                blacklisted: false,
                latestHeight: tip
            });
            return;
        }
        expect(await sync).to.deep.equal({
            synced: false,
            rejections: ["payload persistence aborted"],
            blacklisted: true,
            latestHeight: baseHeight - 1
        });
    } finally {
        await control.stub.releaseSyncInstall().request();
    }
    expect(await installState(h, spectator, forkId)).to.deep.equal(before);
    expect(
        await control.query.getBlockHashAt(forkId, baseHeight).request()
    ).to.equal(block.hash);
}

/**
 * The spectator already holds the served base, so its sync would keep the
 * local state. Its stored base block is replaced by a different one before
 * the sync: the conflict is found when the proof is staged, before the
 * held-base branch, and the sync aborts with the local state kept.
 */
export async function assertConflictWhileHoldingBase(
    h: MathPeerTestHarness
): Promise<void> {
    const { forkId, spectator, responder, tip } =
        await stageSpectatorBehindUnfinalizedTail(h, {
            finalBlocksWhileCutOff: 0
        });
    const payload = await servedPayload(h, responder, forkId);
    const baseHeight = proofHeights(payload).at(-1)![0];
    // premise - the requester holds the base
    expect(await latestHeight(h, spectator, forkId)).to.equal(baseHeight);
    const block = await conflictingBlock(payload, baseHeight, spectator.signer);
    const control = h.control(spectator);
    expect(
        await control.spectate
            .replaceStoredBlock(
                Codec.encode(block.signedBlock, Type.SignedBlock) as string
            )
            .request()
    ).to.equal(block.hash);
    const before = await installState(h, spectator, forkId);
    await control.stub.stubRecordUnsafeSetLatestState().request();
    try {
        expect(
            await syncFromResponder(h, spectator, responder, forkId, tip)
        ).to.deep.equal({
            synced: false,
            rejections: ["payload persistence aborted"],
            blacklisted: true,
            latestHeight: baseHeight
        });
        expect(
            await control.stub.wasUnsafeSetLatestStateCalled().request()
        ).to.equal(false);
    } finally {
        await control.stub.restoreUnsafeSetLatestState().request();
    }
    expect(await installState(h, spectator, forkId)).to.deep.equal(before);
    expect(
        await control.query.getBlockHashAt(forkId, baseHeight).request()
    ).to.equal(block.hash);
}

/**
 * The spectator's sync is held at its install entry; its runtime stops in
 * that window (parked before the custom RPC root disposes). After the
 * release the install commits nothing, the VM is restored, and the sync
 * returns false with no verdict on the responder.
 */
export async function assertDisposalDuringSyncInstall(
    h: MathPeerTestHarness
): Promise<void> {
    const { forkId, spectator, responder, tip } =
        await stageSpectatorBehindUnfinalizedTail(h, {
            finalBlocksWhileCutOff: 1,
            inline: true
        });
    const { host, sm, stub, query } = runtimeEndpointFor(spectator.p2pInstance);
    const state = async () => ({
        vmState: await sm.diamondStateMachine.getState(),
        stateHash: query.getLatestStateMachineStateHash(forkId),
        latestHeight: query.getLatestBlockHeight(forkId),
        forkId: sm.forkId
    });
    const before = await state();
    const localRpc = sm.p2pManager.localRpc;
    const disposeLocalRpc = localRpc.dispose;
    let releaseTeardown!: () => void;
    const teardown = new Promise<void>((resolve) => {
        releaseTeardown = resolve;
    });
    localRpc.dispose = async () => {
        await teardown;
        return disposeLocalRpc.call(localRpc);
    };
    stub.holdSyncInstall();
    try {
        const sync = localRpc.spectateService.sync(
            responder.address,
            sm.channelId,
            forkId,
            tip
        );
        await waitFor(async () => stub.getSyncInstallEntered() === 1);
        const stopping = sm.stop();
        stub.releaseSyncInstall();
        expect(await sync).to.equal(false);
        expect(await state()).to.deep.equal(before);
        expect(sm.p2pManager.isBlacklisted(responder.address)).to.equal(false);
        releaseTeardown();
        await stopping;
    } finally {
        stub.releaseSyncInstall();
        releaseTeardown();
        localRpc.dispose = disposeLocalRpc;
    }
    await host.dispose();
}

/**
 * The spectator's install runs its commit callback after the VM write, and
 * the callback throws. The VM is restored to the pre-install state, the fork
 * and the stored state are unchanged, and the sync rejects with that error
 * with no verdict on the responder.
 */
export async function assertThrowDuringSyncCommit(
    h: MathPeerTestHarness
): Promise<void> {
    const { forkId, spectator, responder, tip } =
        await stageSpectatorBehindUnfinalizedTail(h, {
            finalBlocksWhileCutOff: 1,
            inline: true
        });
    const { host, sm, query } = runtimeEndpointFor(spectator.p2pInstance);
    const state = async () => ({
        vmState: await sm.diamondStateMachine.getState(),
        stateHash: query.getLatestStateMachineStateHash(forkId),
        latestHeight: query.getLatestBlockHeight(forkId),
        forkId: sm.forkId
    });
    const before = await state();
    const application = sm.stateApplicationService;
    const install = application.unsafeSetLatestState;
    const vm = sm.diamondStateMachine;
    const setState = vm.setState;
    const vmWrites: string[] = [];
    const failure = new Error("sync commit callback failed");
    vm.setState = (serializedState) => {
        vmWrites.push(String(serializedState));
        return setState.call(vm, serializedState);
    };
    application.unsafeSetLatestState = (snapshot, encodedState, outbound) =>
        install.call(application, snapshot, encodedState, outbound, () => {
            throw failure;
        });
    try {
        const error = await sm.p2pManager.localRpc.spectateService
            .sync(responder.address, sm.channelId, forkId, tip)
            .then(
                () => undefined,
                (thrown: unknown) => thrown
            );
        expect(error).to.equal(failure);
    } finally {
        application.unsafeSetLatestState = install;
        vm.setState = setState;
    }
    // premise - the install wrote the served base before the callback threw
    expect(vmWrites).to.have.length(2);
    expect(vmWrites[0]).to.not.equal(before.vmState);
    expect(vmWrites[1]).to.equal(before.vmState);
    expect(await state()).to.deep.equal(before);
    expect(sm.p2pManager.isBlacklisted(responder.address)).to.equal(false);
    await host.dispose();
}
