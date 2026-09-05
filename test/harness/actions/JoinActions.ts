// @spec-test-coverage-ignore: shared join test setup exercised by owning mapped test declarations
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Signer } from "ethers";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { Status } from "@/types";
import {
    addressesEqual,
    DetachedPromises,
    SignatureUtils,
    sleep
} from "@/utils";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import {
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { TestPeer } from "@test/harness/core/types";
import StateSnapshot from "@/models/StateSnapshot";
import type { PreparedJoinChannelConfirmation } from "@/rpc/services";

export type AddPeerOptions = {
    signer?: Signer;
    statusTimeoutMs?: number;
    statusTimeoutMessage?: string;
};

export type AddSpectatorAuthoringOptions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> = AddPeerOptions & {
    /** Participants that author while the spectator spawns and syncs. */
    authoringPeerIndices: number[];
    /** Blocks authored before the helper may return, however fast the spawn. */
    minimumBlocks: number;
    /** Hard bound on blocks authored; reaching it fails with diagnostics. */
    maximumBlocks: number;
    /** Runs on the created, still disconnected peer; host stubs go here. */
    beforeConnect?: (peer: TestPeer<TCustomRpc>) => Promise<void>;
    /** Keep authoring until the spectator is SYNCED (default), or stop once the connection dispatch settled. */
    waitForSynced?: boolean;
    waitForFinalization?: boolean;
    /** Helper self-test injection: fail the named phase with this error. */
    phaseFailures?: Partial<Record<"creating" | "dispatching", Error>>;
};

export type AddSpectatorAuthoringResult<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> = {
    peer: TestPeer<TCustomRpc>;
    blocksAuthored: number;
    /** Latest block height on the first authoring peer when the helper returned. */
    height: number;
};

export type BuildJoinChannelConfirmationParams = {
    joiner: { address: string; signer: Signer };
    channelId: JoinChannelStruct["channelId"];
    jcOverrides?: Partial<JoinChannelStruct>;
};

export class JoinActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(protected harness: PeerTestHarness<TCustomRpc>) {}

    protected thresholdSignerForAddress(address: string): Signer | undefined {
        return this.harness.peers.find((candidate) =>
            addressesEqual(candidate.address, address)
        )?.signer;
    }

    private async buildJoinChannel(
        joiner: { address: string },
        channelId: JoinChannelStruct["channelId"],
        overrides?: Partial<JoinChannelStruct>
    ): Promise<JoinChannelStruct> {
        const chainTime = await Clock.getBlockchainTime();
        return {
            participant: joiner.address,
            channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(chainTime.timestamp + 120),
            ...overrides
        };
    }

    /**
     * Phase one of a spectator spawn: create the peer process without
     * connecting it. The slow part of a spawn lives here.
     */
    async createSpectatorPeer(
        options?: AddPeerOptions
    ): Promise<TestPeer<TCustomRpc>> {
        if (!this.harness.canAddPeer) {
            throw new Error("Harness not initialized; call setup() first");
        }

        const index = this.harness.peers.length;
        const resolvedSigner =
            options?.signer ?? this.harness.signerFor(slotAccountIndex(index));
        if (!resolvedSigner) {
            throw new Error(
                `No signer available to create peer at index ${index}`
            );
        }

        await this.harness.createPeer(index, resolvedSigner);
        const peer = this.harness.peers[index];
        if (!peer) {
            throw new Error(`Failed to create peer ${index}`);
        }
        return peer;
    }

    /**
     * Phase three of a spectator spawn: dispatch the channel connection. The
     * RPC acknowledges the detached dispatch; it does not wait for sync. The
     * single owner of connection dispatch for every spectator entry point.
     */
    async connectSpectator(peer: TestPeer<TCustomRpc>): Promise<void> {
        if (!this.harness.channelId) return;
        await this.harness
            .control(peer)
            .network.connectToChannel(this.harness.channelId.toString())
            .request();
    }

    /** Add a spectator without waiting for sync (lets a test install host-side
     * stubs before sync starts). Prefer {@link addSpectatorDetached} when the
     * channel will keep authoring. */
    async addSpectator(
        options?: AddPeerOptions
    ): Promise<TestPeer<TCustomRpc>> {
        const peer = await this.createSpectatorPeer(options);
        await this.connectSpectator(peer);
        return peer;
    }

    /**
     * Spawn a spectator while the channel keeps authoring. Four monotonic
     * phases run as one promise chain started without awaiting: create the
     * peer, run `beforeConnect` on the created but disconnected peer, dispatch
     * the connection exactly once, then sync. The loop authors one block while
     * `blocksAuthored < minimumBlocks || phase !== "done"`, counts every block
     * against `maximumBlocks`, and rethrows the first phase error unchanged.
     * `authorBlock` authors one block with `authoringPeerIndices`.
     */
    async addSpectatorAuthoring(
        options: AddSpectatorAuthoringOptions<TCustomRpc> & {
            authorBlock: () => Promise<void>;
        }
    ): Promise<AddSpectatorAuthoringResult<TCustomRpc>> {
        const {
            minimumBlocks,
            maximumBlocks,
            authorBlock,
            waitForSynced = true
        } = options;
        if (
            !Number.isInteger(minimumBlocks) ||
            !Number.isInteger(maximumBlocks) ||
            minimumBlocks < 0 ||
            minimumBlocks > maximumBlocks
        ) {
            throw new Error(
                `Spectator authoring bounds must satisfy 0 <= minimumBlocks (${minimumBlocks}) <= maximumBlocks (${maximumBlocks})`
            );
        }

        // Mutable spawn state shared with the phase chain below; kept on an
        // object so closure writes stay visible to the loop's type checks.
        const state: {
            // Monotonic stages of the spawn; `done` ends the authoring loop.
            phase: "creating" | "staging" | "dispatching" | "syncing" | "done";
            peer?: TestPeer<TCustomRpc>;
            failure?: { error: unknown };
        } = { phase: "creating" };
        // One chain, handlers attached synchronously: the promise is never
        // unobserved and the connection is dispatched once, after staging.
        const spawn = (async () => {
            if (options.phaseFailures?.creating) {
                throw options.phaseFailures.creating;
            }
            const created = await this.createSpectatorPeer(options);
            state.peer = created;
            state.phase = "staging";
            await options.beforeConnect?.(created);
            state.phase = "dispatching";
            if (options.phaseFailures?.dispatching) {
                throw options.phaseFailures.dispatching;
            }
            await this.connectSpectator(created);
            state.phase = waitForSynced ? "syncing" : "done";
        })().catch((error: unknown) => {
            state.failure = { error };
        });

        // The harness authors far faster than real time, so keep-alive blocks
        // beyond the minimum are paced by the p2p window: enough to keep the
        // writer slot alive, no faster. Otherwise the bound would burn through
        // in a second while a spawn still takes several.
        const keepAliveMs =
            resolveTestTimeConfig(this.harness.options.timeConfig).p2pTime *
            1000;
        let blocksAuthored = 0;
        let lastAuthoredAt = 0;
        while (
            !state.failure &&
            (blocksAuthored < minimumBlocks || state.phase !== "done")
        ) {
            const peer = state.peer;
            if (
                state.phase === "syncing" &&
                peer &&
                (await this.harness
                    .control(peer)
                    .query.getStatus()
                    .request()) === Status.SYNCED
            ) {
                state.phase = "done";
                continue;
            }
            if (
                blocksAuthored >= minimumBlocks &&
                Date.now() - lastAuthoredAt < keepAliveMs
            ) {
                await sleep(100);
                continue;
            }
            if (blocksAuthored >= maximumBlocks) {
                throw new Error(
                    `Spectator spawn hit its block bound (${maximumBlocks}) in phase ${state.phase}` +
                        ` (creation ${peer ? "settled" : "unresolved"}): ${await this.describePeers()}`
                );
            }
            // Sync time is part of this turn, not an extra delay before the next one.
            lastAuthoredAt = Date.now();
            await authorBlock();
            blocksAuthored += 1;
        }
        await spawn;
        if (state.failure) throw state.failure.error;
        const peer = state.peer;
        if (!peer) throw new Error("Spectator spawn ended without a peer");

        const forkId = this.harness.activeForkId;
        const height = forkId
            ? Number(
                  (await this.harness
                      .control(
                          this.harness.getPeer(options.authoringPeerIndices[0])
                      )
                      .query.getLatestBlockHeight(forkId)
                      .request()) ?? 0
              )
            : 0;
        return { peer, blocksAuthored, height };
    }

    private async describePeers(): Promise<string> {
        const forkId = this.harness.activeForkId;
        const lines = await Promise.all(
            this.harness.peers.map(async (peer) => {
                const control = this.harness.control(peer);
                const status =
                    Status[await control.query.getStatus().request()];
                const height = forkId
                    ? await control.query.getLatestBlockHeight(forkId).request()
                    : null;
                return `peer ${peer.index}: ${status} height=${height ?? "none"}`;
            })
        );
        return lines.join("; ");
    }

    async addSpectatorWait(
        options?: AddPeerOptions
    ): Promise<TestPeer<TCustomRpc>> {
        const peer = await this.addSpectator(options);
        if (this.harness.channelId) {
            await this.harness.event.waitUntilPeerStatus(
                peer.index,
                Status.SYNCED,
                {
                    timeoutMs:
                        options?.statusTimeoutMs ??
                        this.harness.event.protocolEventTimeoutMs(),
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${peer.index} did not reach SYNCED after connect`
                }
            );
        }
        return peer;
    }

    async addSpectatorDetached(
        options?: AddPeerOptions
    ): Promise<TestPeer<TCustomRpc>> {
        const peer = await this.addSpectator(options);
        if (this.harness.channelId) {
            const promise = this.harness.event.waitUntilPeerStatus(
                peer.index,
                Status.SYNCED,
                {
                    timeoutMs:
                        options?.statusTimeoutMs ??
                        this.harness.event.protocolEventTimeoutMs(),
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${peer.index} did not reach SYNCED after connect`
                }
            );
            DetachedPromises.collect(promise);
        }
        return peer;
    }

    async joinChannelWait(params: {
        joiner: TestPeer<TCustomRpc>;
        channelId?: JoinChannelStruct["channelId"];
        jcOverrides?: Partial<JoinChannelStruct>;
    }): Promise<JoinChannelConfirmationStruct> {
        const channelId = params.channelId ?? this.harness.channelId;
        const joinChannel = await this.buildJoinChannel(
            params.joiner,
            channelId,
            params.jcOverrides
        );
        const prepared =
            await params.joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            );
        await params.joiner.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        return prepared.confirmation;
    }

    async buildJoinChannelConfirmation(
        params: BuildJoinChannelConfirmationParams
    ): Promise<PreparedJoinChannelConfirmation> {
        const { joiner, channelId, jcOverrides } = params;
        const jc = await this.buildJoinChannel(joiner, channelId, jcOverrides);
        const { encoded, signature: joinerSignature } =
            await SignatureUtils.signJoinChannel(jc, joiner.signer);
        const snapshot = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(channelId)
        );
        const thresholdParticipants = await this.harness
            .control(this.harness.getPeer(0))
            .query.getOnChainThresholdSet()
            .request();
        const existingParticipantSigners = thresholdParticipants.map(
            (participant) => {
                const signer = this.thresholdSignerForAddress(
                    String(participant)
                );
                if (!signer) {
                    throw new Error(
                        `buildJoinChannelConfirmation: no harness signer for ${participant}`
                    );
                }
                return signer;
            }
        );
        const confirmationSignatures = await Promise.all(
            existingParticipantSigners.map((signer) =>
                SignatureUtils.signJoinChannel(jc, signer).then((s) =>
                    String(s.signature)
                )
            )
        );
        return {
            confirmation: {
                signedJoinChannel: {
                    encodedJoinChannel: String(encoded),
                    signature: String(joinerSignature)
                },
                signatures: confirmationSignatures
            },
            expectedSnapshotHash: snapshot.hash,
            expectedForkId: snapshot.forkID
        };
    }
}
