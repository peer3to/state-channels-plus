import type { ForkId, Hash } from "@/types/types";
import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { ZeroHash } from "ethers";
import StateSnapshot from "@/models/StateSnapshot";

export class AssertSyncActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(private readonly harness: PeerTestHarness<TCustomRpc>) {}

    async peersInSyncWait(options?: {
        expectedStateMachineStateHash?: Hash;
        peerIndices?: number[];
        timeout?: number;
        waitForFinalization?: boolean;
    }): Promise<void> {
        const {
            expectedStateMachineStateHash,
            peerIndices,
            timeout = this.harness.event.protocolEventTimeoutMs(1),
            waitForFinalization = true
        } = options || {};
        const peers = this.harness.getFilteredPeers(peerIndices);
        if (peers.length < 2)
            throw new Error("Need at least 2 peers to check sync");

        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - cannot wait for sync");
        }
        const effectiveWaitForFinaliztion =
            peerIndices !== undefined ? false : waitForFinalization;

        await this.harness.syncCoordinator.waitForPeersToSync(peers, forkId, {
            timeoutMs: timeout,
            waitForFinalization: effectiveWaitForFinaliztion
        });

        const firstPeerIndex = peers[0].index;
        const firstPeerState =
            await this.harness.query.getLatestStateMachineStateHash(
                firstPeerIndex
            );

        for (let i = 1; i < peers.length; i++) {
            const peerIndex = peers[i].index;
            const peerState =
                await this.harness.query.getLatestStateMachineStateHash(
                    peerIndex
                );

            expect(peerState).to.deep.equal(
                firstPeerState,
                `Peer ${peerIndex} state does not match Peer ${firstPeerIndex}`
            );
        }

        if (expectedStateMachineStateHash !== undefined) {
            expect(firstPeerState).to.deep.equal(
                expectedStateMachineStateHash,
                "State does not match expected state"
            );
        }
    }

    async blockHeight(options: {
        expectedHeight: number;
        peerIndices?: number[];
    }): Promise<void> {
        const { expectedHeight, peerIndices } = options;
        const peers = this.harness.getFilteredOrHonestPeers(peerIndices);
        if (peers.length === 0) {
            throw new Error("No peers available to check block height");
        }

        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        for (const peer of peers) {
            const height = await this.harness
                .control(peer)
                .query.getLatestBlockHeight(forkId)
                .request();
            expect(height).to.not.equal(
                null,
                `Peer ${peer.index} should have a latest block`
            );
            expect(height).to.equal(
                expectedHeight,
                `Peer ${peer.index} block height should be ${expectedHeight}`
            );
        }
    }

    async forkChanged(options?: {
        originalForkId?: ForkId;
        expectedForkId?: ForkId;
        excludeForkIds?: ForkId[];
        honestPeerIndices?: number[];
    }) {
        const {
            originalForkId = this.harness.context.originalForkId ||
                this.harness.activeForkId!,
            expectedForkId,
            excludeForkIds = [],
            honestPeerIndices
        } = options || {};

        const peers = this.harness.getFilteredOrHonestPeers(honestPeerIndices);

        const excludeSet = new Set([
            ...excludeForkIds,
            ZeroHash,
            originalForkId
        ]);

        const peerForks = (await this.harness.peerForkIds(peers)).filter(
            (fid) => !excludeSet.has(fid)
        );

        if (peerForks.length != peers.length)
            throw new Error(
                `Not all peers have moved to a new fork - expected ${peers.length}, actual ${peerForks.length}`
            );

        if (expectedForkId) {
            const isGood = peerForks.every((fid) => fid === expectedForkId);
            if (!isGood)
                throw new Error(
                    `Expected all peers to move to fork ${expectedForkId}, but found: ${JSON.stringify(peerForks)}`
                );
            return;
        } else {
            // All peers have moved to same new fork
            const uniqueForks = new Set(peerForks);
            const isGood = uniqueForks.size === 1;
            if (!isGood)
                throw new Error(
                    `Expected all peers to move to the same new fork, but found: ${JSON.stringify(peerForks)}`
                );
            return;
        }
    }
    async forkChangedWait(options?: {
        originalForkId?: ForkId;
        expectedForkId?: ForkId;
        excludeForkIds?: ForkId[];
        honestPeerIndices?: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const { timeoutMs = this.harness.event.protocolEventTimeoutMs(0) } =
            options || {};
        const condition = async () => {
            try {
                await this.forkChanged(options);
                return true;
            } catch {
                return false;
            }
        };

        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs,
            timeoutMessageFn: async () => {
                let errorMsg = `Fork change not detected within ${timeoutMs}ms`;
                try {
                    await this.forkChanged(options);
                } catch (error) {
                    errorMsg += ` - ${error instanceof Error ? error.message : String(error)}`;
                }
                return errorMsg;
            }
        });
    }

    async onChainSnapshotAndPeersSameFork(): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active forkId");
        }
        const onChainSnapshot = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(
                this.harness.channelId
            )
        );
        if (onChainSnapshot.forkID !== forkId) {
            throw new Error(
                `Expected on-chain snapshot to be on same fork as peers (${forkId}), but found ${onChainSnapshot.forkID}`
            );
        }
    }

    async onChainSnapshotAndPeersSameForkWait(options?: {
        timeoutMs?: number;
    }) {
        const condition = async () => {
            try {
                await this.onChainSnapshotAndPeersSameFork();
                return true;
            } catch {
                return false;
            }
        };
        await this.harness.eventCountsBarrier.waitFor(condition, {
            timeoutMs: options?.timeoutMs,
            timeoutMessageFn: async () => {
                let errorMsg = "";
                try {
                    await this.onChainSnapshotAndPeersSameFork();
                } catch (error) {
                    errorMsg += ` - ${error instanceof Error ? error.message : String(error)}`;
                }
                return errorMsg;
            }
        });
    }

    async forkUnchanged(): Promise<void> {
        const originalForkId = this.harness.context.originalForkId;
        if (!originalForkId) {
            throw new Error(
                "No original fork ID captured. Call captureOriginalFork() first."
            );
        }

        const forkIds = await this.harness.peerForkIds();
        if (!forkIds.every((fid) => fid === originalForkId)) {
            throw new Error(
                `Expected fork to remain ${originalForkId}, but found: ${JSON.stringify(forkIds)}`
            );
        }
    }

    async onlyHonestPeersInSync(): Promise<void> {
        const indices = this.harness.getActiveHonestPeers().map((p) => p.index);
        if (!indices || indices.length === 0) {
            throw new Error("No peers for transition sync barrier");
        }

        await this.peersInSyncWait({ peerIndices: indices });
    }

    async maliciousPeerExcluded(): Promise<void> {
        const maliciousIndices = this.harness.context.maliciousPeerIndices;
        if (!maliciousIndices || maliciousIndices.length === 0) {
            throw new Error(
                "maliciousPeerIndex not set - resolve dispute context first"
            );
        }

        const nextWriter = await this.harness.query.getNextPeerToWrite();
        if (maliciousIndices.includes(nextWriter.index)) {
            throw new Error(
                `Malicious peer ${nextWriter.index} should not receive next turn, but it did`
            );
        }
    }

    async peerBlockHeightGreaterThan(
        peerIndex: number,
        otherPeerIndex: number,
        options?: { timeoutMs?: number }
    ): Promise<void> {
        const { timeoutMs = this.harness.event.protocolEventTimeoutMs(1) } =
            options || {};
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID");
        }

        const condition = async () => {
            const [peerHeight, otherHeight] = await Promise.all([
                this.harness
                    .control(this.harness.getPeer(peerIndex))
                    .query.getNextBlockHeight(forkId)
                    .request(),
                this.harness
                    .control(this.harness.getPeer(otherPeerIndex))
                    .query.getNextBlockHeight(forkId)
                    .request()
            ]);
            return peerHeight > otherHeight;
        };

        if (!(await condition())) {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Peer ${peerIndex} height did not exceed peer ${otherPeerIndex} within ${timeoutMs}ms`
            });
        }
    }

    async participantCount(options: {
        expectedCount: number;
        peerIndex?: number;
        timeoutMs?: number;
    }): Promise<void> {
        const {
            expectedCount,
            peerIndex = 0,
            timeoutMs = this.harness.event.protocolEventTimeoutMs(1)
        } = options;

        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const condition = async () => {
            const participants = await this.harness
                .control(peer)
                .query.getParticipants()
                .request();
            return participants.length === expectedCount;
        };

        if (!(await condition())) {
            await this.harness.eventCountsBarrier.waitFor(condition, {
                timeoutMs,
                timeoutMessage: `Participant count did not reach ${expectedCount} within ${timeoutMs}ms for peer ${peerIndex}`
            });
        }

        const participants = await this.harness
            .control(peer)
            .query.getParticipants()
            .request();
        expect(participants.length).to.equal(expectedCount);
    }

    async spectatorNoTransportToPeersWait(options: {
        spectatorPeerIndex: number;
        peerIndices: number[];
        timeoutMs?: number;
    }): Promise<void> {
        const {
            spectatorPeerIndex,
            peerIndices,
            timeoutMs = this.harness.event.protocolEventTimeoutMs(1)
        } = options;
        const spectator = this.harness.getPeer(spectatorPeerIndex);

        await this.harness.disconnectionBarrier.waitFor(
            async () => {
                for (const i of peerIndices) {
                    const peer = this.harness.getPeer(i);
                    const [spectatorConnected, peerConnected] =
                        await Promise.all([
                            this.harness
                                .control(spectator)
                                .query.isConnectedTo(peer.address)
                                .request(),
                            this.harness
                                .control(peer)
                                .query.isConnectedTo(spectator.address)
                                .request()
                        ]);
                    if (spectatorConnected || peerConnected) return false;
                }
                return true;
            },
            {
                timeoutMs,
                timeoutMessage: `Spectator ${spectatorPeerIndex} should have no transport to/from peers [${peerIndices.join(", ")}] within ${timeoutMs}ms`
            }
        );
    }
}
