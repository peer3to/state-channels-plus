import hre from "hardhat";

import { JoinActions } from "@test/harness/actions/JoinActions";
import { MathConsumerFacet__factory } from "@typechain-types";

export type ForceInboundJoinOptions = {
    deposit?: bigint;
    timeoutMs?: number;
    waitForHonestPeersObserve?: boolean;
    participant?: string;
};

export class MathJoinActions extends JoinActions {
    async forceInboundJoinWait(options?: ForceInboundJoinOptions): Promise<{
        participant: string;
    }> {
        const deposit = options?.deposit ?? 250n;
        const timeoutMs = options?.timeoutMs ?? 15000;
        const waitForHonestPeersObserve =
            options?.waitForHonestPeersObserve ?? true;

        const submitter = this.harness.peers[0];
        if (!submitter) {
            throw new Error("forceInboundJoinWait: harness has no peers");
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
}
