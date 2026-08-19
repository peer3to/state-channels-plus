import { ethers, type Signer } from "ethers";

import { JoinActions } from "@test/harness/actions/JoinActions";
import type { Hash } from "@/types/types";
import { addressesEqual, DetachedPromises } from "@/utils";
import { TestPeer } from "@test/harness/core/types";
import Clock from "@/Clock";
import type { PreparedJoinChannelConfirmation } from "@/rpc/services";

export type ForceInboundJoinOptions = {
    deposit?: bigint;
    timeoutMs?: number;
    waitForHonestPeersObserve?: boolean;
    participant?: string;
    /** Peers that must observe the new inbound block; defaults to all honest. */
    observePeerIndices?: number[];
};

export type PreparedForceInboundJoin = {
    participant: string;
    participantSigner: Signer;
    prepared: PreparedJoinChannelConfirmation;
    isTopUp: boolean;
    submissionPeerIndex?: number;
};

export class MathJoinActions extends JoinActions {
    // Test-only wallets retained so later N/N confirmations can include dead pending entries.
    private retainedJoinWallets = new Map<string, Signer>();

    protected override thresholdSignerForAddress(
        address: string
    ): Signer | undefined {
        return (
            super.thresholdSignerForAddress(address) ??
            [...this.retainedJoinWallets.entries()].find(([walletAddress]) =>
                addressesEqual(walletAddress, address)
            )?.[1]
        );
    }

    private async pickSubmitterWithLatestInbound(): Promise<TestPeer> {
        const candidates = this.harness.getActiveHonestPeers();
        if (candidates.length === 0) {
            throw new Error(
                "forceInboundJoin: no honest non-leaver peers to submit from (all peers are malicious or have left)"
            );
        }
        const heights = await Promise.all(
            candidates.map((peer) =>
                this.harness
                    .control(peer)
                    .query.getInboundLatestHeight()
                    .request()
            )
        );
        let best = candidates[0];
        let bestHeight = heights[0] ?? 0;
        candidates.forEach((peer, i) => {
            const h = heights[i] ?? 0;
            if (h > bestHeight) {
                bestHeight = h;
                best = peer;
            }
        });
        return best;
    }

    private async submitPreparedForceInboundJoinTxWait(
        forceJoin: PreparedForceInboundJoin
    ): Promise<{
        participant: string;
        previousLatestHash: Hash | undefined;
    }> {
        const submitter = await this.pickSubmitterWithLatestInbound();
        const previousLatestHash =
            ((await this.harness
                .control(submitter)
                .query.getLatestInboundMessageHash()
                .request()) as Hash | null) ?? undefined;
        const { participant, prepared, isTopUp, submissionPeerIndex } =
            forceJoin;

        if (submissionPeerIndex !== undefined) {
            const peer = this.harness.getPeer(submissionPeerIndex);
            if (isTopUp) {
                await peer.p2pInstance.p2pSigner.topUpBalance(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            } else {
                await peer.p2pInstance.p2pSigner.joinChannel(
                    prepared.confirmation,
                    prepared.expectedSnapshotHash,
                    prepared.expectedForkId
                );
            }
        } else {
            const channelManager = this.harness.channelManager.connect(
                forceJoin.participantSigner
            );
            const tx = isTopUp
                ? await channelManager.topUpBalance(
                      prepared.confirmation,
                      prepared.expectedSnapshotHash,
                      prepared.expectedForkId
                  )
                : await channelManager.joinChannel(
                      prepared.confirmation,
                      prepared.expectedSnapshotHash,
                      prepared.expectedForkId
                  );
            await tx.wait();
        }

        return { participant, previousLatestHash };
    }

    async prepareForceInboundJoinWait(
        options?: ForceInboundJoinOptions
    ): Promise<PreparedForceInboundJoin> {
        const deposit = options?.deposit ?? 250n;
        const submitter = await this.pickSubmitterWithLatestInbound();
        const peer = options?.participant
            ? this.harness.peers.find((candidate) =>
                  addressesEqual(candidate.address, options.participant!)
              )
            : undefined;
        const randomWallet = options?.participant
            ? undefined
            : ethers.Wallet.createRandom().connect(
                  this.harness.channelManager.runner!.provider!
              );
        if (options?.participant && !peer) {
            throw new Error(
                "forceInboundJoin: participant must be a harness peer so it can sign its join"
            );
        }
        const participant = peer?.address ?? randomWallet!.address;
        if (randomWallet) {
            this.retainedJoinWallets.set(randomWallet.address, randomWallet);
        }
        const participantUnion = await this.harness
            .control(submitter)
            .query.getOnChainParticipantUnion()
            .request();
        const isTopUp = participantUnion.some((address) =>
            addressesEqual(address, participant)
        );
        let participantSigner: Signer;
        let prepared: PreparedJoinChannelConfirmation;
        let submissionPeerIndex: number | undefined;
        if (
            peer &&
            this.harness
                .getActiveHonestPeers()
                .some((candidate) => candidate.index === peer.index)
        ) {
            const chainTime = await Clock.getBlockchainTime();
            participantSigner = peer.signer;
            submissionPeerIndex = peer.index;
            prepared =
                await peer.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                    {
                        participant,
                        channelId: this.harness.channelId,
                        balance: { amount: deposit, data: "0x00" },
                        deadlineTimestamp: BigInt(chainTime.timestamp + 120)
                    }
                );
        } else {
            if (randomWallet) {
                await (
                    await submitter.p2pInstance.chainSigner.sendTransaction({
                        to: participant,
                        value: ethers.parseEther("1")
                    })
                ).wait();
            }
            participantSigner = peer?.signer ?? randomWallet!;
            prepared = await this.buildJoinChannelConfirmation({
                joiner: { address: participant, signer: participantSigner },
                channelId: this.harness.channelId,
                jcOverrides: {
                    balance: { amount: deposit, data: "0x00" }
                }
            });
        }

        return {
            participant,
            participantSigner,
            prepared,
            isTopUp,
            submissionPeerIndex
        };
    }

    async submitPreparedForceInboundJoinWait(
        forceJoin: PreparedForceInboundJoin,
        options?: Pick<
            ForceInboundJoinOptions,
            "timeoutMs" | "waitForHonestPeersObserve" | "observePeerIndices"
        >
    ): Promise<{ participant: string }> {
        const timeoutMs =
            options?.timeoutMs ?? this.harness.event.protocolEventTimeoutMs();
        const waitForHonestPeersObserve =
            options?.waitForHonestPeersObserve ?? true;

        const { participant, previousLatestHash } =
            await this.submitPreparedForceInboundJoinTxWait(forceJoin);

        if (waitForHonestPeersObserve) {
            await this.harness.assert.storage.honestPeersObserveInboundMessageWait(
                {
                    previousLatestHash: previousLatestHash ?? undefined,
                    peerIndices: options?.observePeerIndices,
                    timeoutMs
                }
            );
        }

        return { participant };
    }

    async forceInboundJoinWait(options?: ForceInboundJoinOptions): Promise<{
        participant: string;
    }> {
        const forceJoin = await this.prepareForceInboundJoinWait(options);
        return this.submitPreparedForceInboundJoinWait(forceJoin, options);
    }
    async forceInboundJoinObserveDetached(
        options?: ForceInboundJoinOptions
    ): Promise<{ participant: string }> {
        const timeoutMs =
            options?.timeoutMs ?? this.harness.event.protocolEventTimeoutMs();
        const waitForHonestPeersObserve =
            options?.waitForHonestPeersObserve ?? true;

        const forceJoin = await this.prepareForceInboundJoinWait(options);
        const { participant, previousLatestHash } =
            await this.submitPreparedForceInboundJoinTxWait(forceJoin);

        if (waitForHonestPeersObserve) {
            const promise =
                this.harness.assert.storage.honestPeersObserveInboundMessageWait(
                    {
                        previousLatestHash: previousLatestHash ?? undefined,
                        timeoutMs
                    }
                );
            DetachedPromises.collect(promise);
        }

        return { participant };
    }
}
