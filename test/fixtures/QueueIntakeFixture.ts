// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import * as factory from "../factory";
import { Block } from "@/models";
import type { IngestBlockConfirmationOptions } from "@/stateManager/ingest/BlockQueueManager";
import { BlockOrigin } from "@/storage/QueueStorage";
import { BlockConfirmationEthersType } from "@/types/ethers";
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { ethers } from "ethers";

/** Real intake with a future signed block, so retention is directly observable. */
export class QueueIntakeFixture {
    public readonly h = MathTestSession.getHarness();
    public readonly strangers = Array.from(
        { length: 3 },
        () => ethers.Wallet.createRandom().address
    );
    public encodedBlockConfirmation = "";
    public block!: Block;

    async start(
        options: {
            transitionCount?: number;
            wrongChannel?: boolean;
            forgedAuthor?: boolean;
            holdMembership?: boolean;
            failMembership?: boolean;
        } = {}
    ) {
        await this.h.lifecycle.start(2, options.transitionCount ?? 0, {
            maxChannelParticipants: 2
        });
        this.encodedBlockConfirmation = await factory.buildAndEncodeBlock(
            this.h.getPeer(1).signer,
            {
                header: {
                    channelId: options.wrongChannel
                        ? factory.hash()
                        : this.h.channelId,
                    forkId: this.h.activeForkId!,
                    transactionCnt: 20,
                    participant: this.h.getPeer(options.forgedAuthor ? 0 : 1)
                        .address
                }
            }
        );
        this.block = Block.fromBlockConfirmation(
            Codec.decode(this.encodedBlockConfirmation, Type.BlockConfirmation)
        );
        await this.control.stub.observeAdmission(options).request();
    }

    get control() {
        return this.h.control(this.h.getPeer(0));
    }

    receive(
        source = this.h.getPeer(1).address,
        options?: IngestBlockConfirmationOptions
    ) {
        return this.control.transition
            .ingestBlockConfirmation(
                this.encodedBlockConfirmation,
                options ?? {
                    origin: BlockOrigin.NETWORK,
                    senderAddress: source
                }
            )
            .request({ timeoutMs: this.h.event.protocolEventTimeoutMs() });
    }

    retention() {
        return this.control.query.getQueuedRetention(this.block.hash).request();
    }
    observation() {
        return this.control.stub.getAdmissionObservation().request();
    }

    async waitForRead() {
        await waitFor(async () => (await this.observation()).chainReads > 0);
    }

    async close() {
        await this.h.execOnHost(this.h.getPeer(0), (sm) => {
            sm.blockQueueManager.clearFork(sm.forkId);
        });
        await this.control.stub.restoreAdmissionObservation().request();
    }
}

export async function receiveWithExplicitStrategy(stored: boolean) {
    const f = new QueueIntakeFixture();
    await f.start({ transitionCount: stored ? 1 : 0 });
    try {
        const result = await f.h.execOnHost(
            f.h.getPeer(0),
            async (sm, args, { ethers }) => {
                const block = args.stored
                    ? sm.storage.blocks.getLatestBlock(sm.forkId)!
                          .blockConfirmationStruct
                    : ethers.AbiCoder.defaultAbiCoder().decode(
                          [args.blockType],
                          args.encodedBlockConfirmation
                      )[0];
                const accepted =
                    await sm.blockQueueManager.ingestBlockConfirmation(block, {
                        origin: args.origin,
                        senderAddress: args.source,
                        validationStrategy: sm.spectatingValidationStrategy
                    });
                return {
                    accepted,
                    storedHeight: sm.storage.blocks.getNextBlockHeight(
                        sm.forkId
                    )
                };
            },
            {
                origin: BlockOrigin.NETWORK as const,
                stored,
                source: f.h.getPeer(1).address,
                encodedBlockConfirmation: f.encodedBlockConfirmation,
                blockType: BlockConfirmationEthersType
            }
        );
        return { ...result, queued: await f.retention() };
    } finally {
        await f.close();
    }
}
