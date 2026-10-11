// @spec-test-coverage-ignore: shared staging for the WaitForSyncStatusGuard unit declarations
import { Block } from "@/models";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import type { HarnessOptions, TestPeer } from "@test/harness/core/types";
import { waitFor } from "@test/utils/waitFor";
import { ethers } from "ethers";

type Peer = TestPeer;

/**
 * Where the observer's initial sync waits: `install` builds the payload at
 * the idle participant head and holds the observer's state install after
 * the payload arrived (the sync then succeeds); `failingResponse` holds the
 * responders' answer and then fails it (the sync fails and the runtime
 * aborts).
 */
export type InitialSyncHold = "install" | "failingResponse";

export type HeldObserverSync = {
    observer: Peer;
    forkId: ForkId;
    /**
     * Idle participant head when the hold was entered. With `install` the
     * payload ends at this height; with `failingResponse` it serves no higher.
     */
    heldHeight: number;
    /** Ends the hold; idempotent. */
    release: () => Promise<void>;
    /** Spectate requests the two participants received since the spawn. */
    spectateRequests: () => Promise<number>;
};

/**
 * Opens a channel of participants 0 and 1, then spawns an observer whose
 * live block RPCs are recorded and whose initial sync is held (see
 * {@link InitialSyncHold}); `options` reach the harness setup. The
 * participants keep authoring until the observer's spectate request is
 * held and then settle on one head, so every later block reaches the
 * observer only as live gossip.
 * With `install` the request is held before its payload is built and
 * released once the participants are idle, so the payload ends at
 * `heldHeight`; a block in flight while the request arrived cannot leave
 * the payload one block short.
 */
export async function addObserverWithHeldInitialSync(
    h: MathPeerTestHarness,
    hold: InitialSyncHold,
    options: HarnessOptions = {}
): Promise<HeldObserverSync> {
    const forkId = await h.lifecycle.start(2, 1, {
        maxChannelParticipants: 3,
        ...options
    });
    const participants = [0, 1];
    const releases: (() => Promise<unknown>)[] = [];
    const requestReleases: (() => Promise<unknown>)[] = [];
    const { peer: observer } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: participants,
        minimumBlocks: 0,
        maximumBlocks: 20,
        waitForSynced: false,
        beforeConnect: async (peer) => {
            const control = h.control(peer);
            await control.stub.stubRecordLiveBlockRetention().request();
            // counted first: releasing a spectate hold restores the
            // counting answer
            for (const index of participants)
                await h.rpcStub.stubCountSpectateRequests(index);
            if (hold === "install")
                await control.stub.holdSyncInstall().request();
            for (const index of participants)
                requestReleases.push(
                    await h.rpcStub.holdSpectateResponses(
                        index,
                        hold === "failingResponse",
                        hold === "install"
                    )
                );
        }
    });
    const isRequestHeld = async () =>
        (
            await Promise.all(
                participants.map((index) =>
                    h
                        .control(h.getPeer(index))
                        .stub.getHeldSpectateResponseCount()
                        .request()
                )
            )
        ).reduce((sum, count) => sum + count, 0) === 1;
    await h.transition.keepAuthoringUntil({
        until: isRequestHeld,
        waitForPeers: participants,
        maximumBlocks: 20
    });
    // the held request can end the authoring before its last block synced
    await h.syncCoordinator.waitForPeersToSync(
        h.getFilteredPeers(participants),
        forkId,
        { waitForFinalization: true }
    );
    const heldHeight = Number(
        await h
            .control(h.getPeer(0))
            .query.getLatestBlockHeight(forkId)
            .request()
    );
    if (hold === "install") {
        // the payload is built now, at the idle head
        for (const release of requestReleases.splice(0)) await release();
        const stub = h.control(observer).stub;
        await waitFor(
            async () => (await stub.getSyncInstallEntered().request()) === 1
        );
        releases.push(() => stub.releaseSyncInstall().request());
    } else releases.push(...requestReleases);
    let released = false;
    return {
        observer,
        forkId,
        heldHeight,
        release: async () => {
            if (released) return;
            released = true;
            for (const release of releases) await release();
        },
        spectateRequests: async () =>
            (
                await Promise.all(
                    participants.map((index) =>
                        h.rpcStub.getSpectateRequestCount(index)
                    )
                )
            ).reduce((sum, count) => sum + count, 0)
    };
}

/** The observer's recorded live block RPCs and the guard's retained count. */
export async function readLiveBlockRetention(
    h: MathPeerTestHarness,
    observer: Peer
) {
    return await h
        .control(observer)
        .stub.getRecordedLiveBlockRetention()
        .request();
}

/**
 * A block confirmation `author` signs for `height` on a fork the channel
 * never had; returns its encoding and hash.
 */
export async function wrongForkBlock(
    h: MathPeerTestHarness,
    author: Peer,
    height: number
): Promise<{ encoded: string; hash: string; forkId: string }> {
    const forkId = ethers.id(`wrong-fork-${height}`);
    const encoded = await factory.buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId,
            transactionCnt: height,
            participant: author.address
        }
    });
    const block = Block.fromBlockConfirmation(
        Codec.decode(encoded, Type.BlockConfirmation)
    );
    return { encoded, hash: String(block.hash), forkId };
}
