import hre from "hardhat";

import { JoinActions } from "@test/harness/actions/JoinActions";
import { MathConsumerFacet__factory } from "@typechain-types";
import type { Hash } from "@/types/types";
import { DetachedPromises } from "@/utils";
import { TestPeer } from "@test/harness/core/types";

export type ForceInboundJoinOptions = {
    deposit?: bigint;
    timeoutMs?: number;
    waitForHonestPeersObserve?: boolean;
    participant?: string;
};

export class MathJoinActions extends JoinActions {
    private pickSubmitterWithLatestInbound(): TestPeer {
        const candidates = this.harness.getPeersExcludingMaliciousAndLeavers();
        if (candidates.length === 0) {
            throw new Error(
                "forceInboundJoin: no honest non-leaver peers to submit from (all peers are malicious or have left)"
            );
        }
        let best = candidates[0];
        let bestHeight =
            best.stateManager.storage.inboundMessages.getLatestBlockHeight() ??
            0;
        for (const peer of candidates.slice(1)) {
            const h =
                peer.stateManager.storage.inboundMessages.getLatestBlockHeight() ??
                0;
            if (h > bestHeight) {
                bestHeight = h;
                best = peer;
            }
        }
        return best;
    }

    private async submitForceInboundJoinTx(
        options?: ForceInboundJoinOptions
    ): Promise<{
        participant: string;
        previousLatestHash: Hash | undefined;
    }> {
        const deposit = options?.deposit ?? 250n;
        const submitter = this.pickSubmitterWithLatestInbound();
        const participant =
            options?.participant ?? hre.ethers.Wallet.createRandom().address;
        const previousLatestHash =
            submitter.stateManager.storage.inboundMessages.getLatestBlockHash();

        const consumerFacet = MathConsumerFacet__factory.connect(
            await this.harness.channelManager.getAddress(),
            submitter.signer
        );
        const tx = await consumerFacet.forceInboundJoin(
            this.harness.channelId,
            participant,
            deposit
        );
        await tx.wait();

        return { participant, previousLatestHash };
    }

    async forceInboundJoinWait(options?: ForceInboundJoinOptions): Promise<{
        participant: string;
    }> {
        const timeoutMs = options?.timeoutMs ?? 15000;
        const waitForHonestPeersObserve =
            options?.waitForHonestPeersObserve ?? true;

        const { participant, previousLatestHash } =
            await this.submitForceInboundJoinTx(options);

        if (waitForHonestPeersObserve) {
            await this.harness.assert.storage.honestPeersObserveInboundMessageWait(
                {
                    previousLatestHash: previousLatestHash ?? undefined,
                    timeoutMs
                }
            );
        }

        return { participant };
    }
    async forceInboundJoinDetached(
        options?: ForceInboundJoinOptions
    ): Promise<{ participant: string }> {
        const timeoutMs = options?.timeoutMs ?? 15000;
        const waitForHonestPeersObserve =
            options?.waitForHonestPeersObserve ?? true;

        const { participant, previousLatestHash } =
            await this.submitForceInboundJoinTx(options);

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
