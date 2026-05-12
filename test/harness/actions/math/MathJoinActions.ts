import hre from "hardhat";

import { JoinActions } from "@test/harness/actions/JoinActions";
import { MathConsumerFacet__factory } from "@typechain-types";
import type { Hash } from "@/types/types";
import { DetachedPromises } from "@/utils";

export type ForceInboundJoinOptions = {
    deposit?: bigint;
    timeoutMs?: number;
    waitForHonestPeersObserve?: boolean;
    participant?: string;
};

export class MathJoinActions extends JoinActions {
    private async submitForceInboundJoinTx(
        options?: ForceInboundJoinOptions
    ): Promise<{
        participant: string;
        previousLatestHash: Hash | undefined;
    }> {
        const deposit = options?.deposit ?? 250n;
        const submitter = this.harness.peers[0];
        if (!submitter) {
            throw new Error("forceInboundJoin: harness has no peers");
        }
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
