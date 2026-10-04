import { Block } from "@/models";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import type { Address, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// the builders run host-side on the live strategy's FraudProofService
// (validation.probeInvalidStateTransitionProof / probeInvalidTimestampProof).
// Live gossip reads the predecessor from storage by hash; dispute replay
// passes the predecessor it judged the block from.
describe("Unit: FraudProofService", function () {
    describe("createInvalidStateTransitionProof", function () {
        it("live: a non-leader block linked to a stored block → proof against its author from that block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const [nextWriter, previous] = await Promise.all([
                h.control(observer).query.getNextToWrite().request(),
                h.control(observer).query.getBlockByHeight(forkId, 1).request()
            ]);
            const nonLeader = h.peers.find((p) => p.address !== nextWriter)!;
            const encoded = await factory.buildAndEncodeBlock(
                nonLeader.signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId,
                        transactionCnt: 2,
                        participant: nonLeader.address as Address
                    },
                    previousBlockHash: previous!.hash
                }
            );

            const proof = await h
                .control(observer)
                .validation.probeInvalidStateTransitionProof(encoded)
                .request();

            expect(proof?.proofType).to.equal(
                toSolidityFraudProofType(
                    FraudProofType.BlockInvalidStateTransition
                )
            );
            const decoded = Codec.decode(
                proof!.encodedProof,
                FraudProofType.BlockInvalidStateTransition
            );
            expect(Block.fromSignedBlock(decoded.previousBlock).hash).to.equal(
                previous!.hash
            );
            expect(proof!.participant).to.equal(nonLeader.address);
        });

        it("live: a block whose predecessor is not stored → abstains, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const encoded = await factory.buildAndEncodeBlock(
                h.getPeer(1).signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId: h.activeForkId!,
                        transactionCnt: 2
                    },
                    previousBlockHash: factory.hash()
                }
            );

            expect(
                await h
                    .control(observer)
                    .validation.probeInvalidStateTransitionProof(encoded)
                    .request()
            ).to.equal(null);
        });

        it("dispute replay: the passed predecessor is the proof's base, also for a block the stored history does not link", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const previous = await h
                .control(observer)
                .query.getBlockByHeight(forkId, 1)
                .request();
            const encoded = await factory.buildAndEncodeBlock(
                h.getPeer(1).signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId,
                        transactionCnt: 2
                    },
                    previousBlockHash: factory.hash()
                }
            );

            const proof = await h
                .control(observer)
                .validation.probeInvalidStateTransitionProof(encoded, {
                    predecessorHeight: 1
                })
                .request();

            const decoded = Codec.decode(
                proof!.encodedProof,
                FraudProofType.BlockInvalidStateTransition
            );
            expect(Block.fromSignedBlock(decoded.previousBlock).hash).to.equal(
                previous!.hash
            );
            expect(decoded.previousBlockStateSnapshot.blockHeight).to.equal(1n);
            expect(
                await h
                    .control(observer)
                    .query.getStateMachineState(
                        decoded.previousBlockStateSnapshot.snapshotData
                            .stateMachineStateHash as Hash
                    )
                    .request()
            ).to.equal(decoded.previousStateStateMachineState);
        });

        it("dispute replay from the fork genesis → an empty previous block and the genesis snapshot", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const encoded = await factory.buildAndEncodeBlock(
                h.getPeer(1).signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId,
                        transactionCnt: 0
                    }
                }
            );

            const proof = await h
                .control(observer)
                .validation.probeInvalidStateTransitionProof(encoded, {
                    predecessorHeight: -1
                })
                .request();

            const decoded = Codec.decode(
                proof!.encodedProof,
                FraudProofType.BlockInvalidStateTransition
            );
            expect(decoded.previousBlock.encodedBlock).to.equal("0x");
            expect(
                Codec.encode(
                    decoded.previousBlockStateSnapshot,
                    Type.StateSnapshot
                )
            ).to.equal(
                (await h
                    .control(observer)
                    .dispute.getGenesisSnapshotStruct(forkId)
                    .request())!.encodedSnapshot
            );
        });
    });

    describe("buildInvalidTimestampProof", function () {
        it("a passed predecessor → its block and snapshot, not the stored block below the block's height", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const [zero, two] = await Promise.all(
                [0, 2].map((height) =>
                    h
                        .control(observer)
                        .query.getBlockByHeight(forkId, height)
                        .request()
                )
            );
            // a block at height 3 judged from block 0, as replay would
            const encoded = await factory.buildAndEncodeBlock(
                h.getPeer(1).signer,
                {
                    header: {
                        channelId: h.channelId,
                        forkId,
                        transactionCnt: 3
                    },
                    previousBlockHash: zero!.hash
                }
            );

            const passed = await h
                .control(observer)
                .validation.probeInvalidTimestampProof(encoded, {
                    predecessorHeight: 0
                })
                .request();
            const stored = await h
                .control(observer)
                .validation.probeInvalidTimestampProof(encoded)
                .request();

            const fromPassed = Codec.decode(
                passed.encodedProof,
                FraudProofType.InvalidTimestamp
            );
            const fromStorage = Codec.decode(
                stored.encodedProof,
                FraudProofType.InvalidTimestamp
            );
            expect(
                Block.fromSignedBlock(fromPassed.previousBlock).hash
            ).to.equal(zero!.hash);
            expect(fromPassed.previousStateSnapshot.blockHeight).to.equal(0n);
            // storage answers with the block stored below height 3
            expect(
                Block.fromSignedBlock(fromStorage.previousBlock).hash
            ).to.equal(two!.hash);
            expect(fromStorage.previousStateSnapshot.blockHeight).to.equal(2n);
        });
    });
});
