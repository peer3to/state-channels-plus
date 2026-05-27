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
    private async pickSubmitterWithLatestInbound(): Promise<TestPeer> {
        const candidates = this.harness.getPeersExcludingMaliciousAndLeavers();
        if (candidates.length === 0) {
            throw new Error(
                "forceInboundJoin: no honest non-leaver peers to submit from (all peers are malicious or have left)"
            );
        }
        // step 1 - W1 - inbound height read via sub-handle so worker peers
        // answer over rpc. inline body matches the today loop.
        let best = candidates[0];
        let bestHeight =
            (await this.harness
                .getPeerHandle(best.index)
                .queryInboundLatestBlockHeight()) ?? 0;
        for (const peer of candidates.slice(1)) {
            const h =
                (await this.harness
                    .getPeerHandle(peer.index)
                    .queryInboundLatestBlockHeight()) ?? 0;
            if (h > bestHeight) {
                bestHeight = h;
                best = peer;
            }
        }
        return best;
    }

    private async submitForceInboundJoinTxWait(
        options?: ForceInboundJoinOptions
    ): Promise<{
        participant: string;
        previousLatestHash: Hash | undefined;
    }> {
        const deposit = options?.deposit ?? 250n;
        const submitter = await this.pickSubmitterWithLatestInbound();
        const participant =
            options?.participant ?? hre.ethers.Wallet.createRandom().address;
        // step 1 - W1 - inbound latest block hash via sub-handle.
        const previousLatestHash = (await this.harness
            .getPeerHandle(submitter.index)
            .queryInboundLatestBlockHash()) as Hash | undefined;

        const consumerFacet = MathConsumerFacet__factory.connect(
            await this.harness.channelManager.getAddress(),
            this.harness.getPeerHandle(submitter.index).signer
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
            await this.submitForceInboundJoinTxWait(options);

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
    async forceInboundJoinObserveDetached(
        options?: ForceInboundJoinOptions
    ): Promise<{ participant: string }> {
        const timeoutMs = options?.timeoutMs ?? 15000;
        const waitForHonestPeersObserve =
            options?.waitForHonestPeersObserve ?? true;

        const { participant, previousLatestHash } =
            await this.submitForceInboundJoinTxWait(options);

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
