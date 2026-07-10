import { expect } from "chai";
import { ethers } from "ethers";
import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

describe("block-confirmation / reactions", function () {
    // what: a non-genesis block whose previousBlockHash doesn't chain to the stored predecessor.
    it(
        "broken chain (non-genesis previousBlockHash) → honest peers disconnect the sender, no fraud proof",
        covers(
            {
                strategy: "block-validation",
                hook: "blockIsNotLinkedAndIsNotFirstBlock",
                previousBlockHash: "broken-chain"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);
                await h.assert.sync.peersInSyncWait();
                h.event.resetEventSpies();

                const maliciousPeerIndex = 2;
                const submitted =
                    await h.byzantine.submitBrokenChainBlock(
                        maliciousPeerIndex
                    );

                // peer 0 processes the broken-chain block and the validation result is keepConnection=false
                await h.event.waitForBlockConfirmationProcessed({
                    peerIndex: 0,
                    blockHash: submitted.hash as Hash,
                    keepConnection: false
                });
                // the rejected block never enters honest state -> peer 0 stays at its pre-attack tip.
                await h.assert.sync.blockHeight({
                    expectedHeight: 1,
                    peerIndices: [0]
                });
            }
        )
    );

    it(
        "fresh block with a non-participant signature applies after dropping it",
        covers(
            {
                strategy: "block-validation",
                hook: "notAllSingersAreParticipants",
                signatures: "non-participant"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(4, 0);

                const forkId = h.activeForkId;
                expect(forkId).to.not.be.undefined;

                // Keep the observer blind to the next block so it can be hand-fed a
                // tainted copy of it.
                const observerIndex = 3;
                const observer = h.getPeer(observerIndex);
                await h.network.disconnectPeer(observerIndex);
                const observerInitialSum =
                    await observer.contractInstance.getSum();

                await h.transition.advanceState({
                    count: 1,
                    waitForPeers: [0, 1, 2],
                    waitForFinalization: false
                });

                const source = await h.peerWithHighestBlock(forkId!);
                const block = await h
                    .control(source)
                    .query.getBlockByHeight(forkId!, 0)
                    .request();
                expect(block).to.not.be.null;

                const outsider = ethers.Wallet.createRandom();
                const badSignature = await outsider.signMessage(
                    ethers.getBytes(block!.hash)
                );
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observerIndex,
                    blockConfirmation: {
                        signedBlock: Codec.decode(
                            block!.encodedSignedBlock,
                            Type.SignedBlock
                        ),
                        signatures: [
                            ...block!.confirmationSignatures,
                            badSignature
                        ]
                    },
                    ingestOptions: { senderAddress: h.getPeer(1).address },
                    keepConnection: true,
                    // The block applies; the byzantine signature suppliers are
                    // disconnected+blacklisted by the strategy directly.
                    processedKeepConnection: true
                });

                // The block applied normally — stray signature dropped, not the block.
                const storedBlock = await h
                    .control(observer)
                    .query.getBlockByHash(block!.hash)
                    .request();
                expect(storedBlock).to.not.be.null;
                expect(
                    storedBlock!.confirmationSignatures.includes(badSignature)
                ).to.equal(false);
                expect(await observer.contractInstance.getSum()).to.equal(
                    observerInitialSum + 1n
                );
                // The peer that supplied the stray signature is cut.
                expect(
                    await h
                        .control(observer)
                        .query.isBlacklisted(h.getPeer(1).address)
                        .request()
                ).to.equal(true);
            }
        )
    );
});
