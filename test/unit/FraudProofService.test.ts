import { Block } from "@/models";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import type { Address } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// FraudProofService builds each proof host-side from the peer's own storage.
describe("Unit: FraudProofService", function () {
    it("an invalid block whose predecessor is held only as retained proof evidence → the invalid-transition proof is built from that retained block", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);
        const { leader, observer, authored, startHeight, forkId } =
            await h.transition.authorNextBlockOffWireWait();
        const real = Block.fromBlockConfirmation(
            Codec.decode(
                authored.encodedBlockConfirmation,
                Type.BlockConfirmation
            )
        );
        // the predecessor leaves history and stays only as retained evidence,
        // as a sync's deferred start block does before its first tail block
        await h.execOnHost(
            observer,
            (sm, args) => {
                const predecessor = sm.storage.blocks.getBlock(args.hash)!;
                sm.storage.blocks.deleteBlock(args.hash);
                sm.storage.retainedEvidence.storeBlock(predecessor);
            },
            { hash: String(real.previousBlockHash) }
        );
        const invalid = Codec.decode(
            await factory.buildAndEncodeBlock(leader.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: startHeight,
                    participant: leader.address as Address
                },
                previousBlockHash: real.previousBlockHash
            }),
            Type.BlockConfirmation
        );

        const thrown = await h.execOnHost(
            observer,
            (sm, args) => {
                const block = sm.agreementManager.getLastBlockFromMilestone({
                    blockConfirmations: [args.confirmation]
                })!;
                try {
                    sm.fraudProofService.createInvalidStateTransitionProof(
                        block
                    );
                    return "";
                } catch (error) {
                    return String(error);
                }
            },
            { confirmation: invalid }
        );

        expect(thrown).to.equal("");
        expect(
            await h
                .control(observer)
                .query.getFraudProofType(leader.address as Address)
                .request()
        ).to.equal(
            String(
                toSolidityFraudProofType(
                    FraudProofType.BlockInvalidStateTransition
                )
            )
        );
    });
});
