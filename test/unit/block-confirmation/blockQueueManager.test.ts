import { expect } from "chai";
import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import * as factory from "@test/factory";
import { covers } from "./domain";
import type { Address } from "@/types/types";

/**
 * Unit-scope harness tests for BlockQueueManager's ingest guards and the
 * queue-timeout stored-merge branch. Real sessions, real blocks, real
 * signatures — the component is poked host-side through the control RPC.
 */

describe("block-confirmation / blockQueueManager", function () {
    it(
        "ingest rejects a block confirmation with a forged author signature",
        covers(
            {
                ingestOutcome: "not-authentic"
            },
            async function () {
                this.timeout(90000);

                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 1);

                const forkId = h.activeForkId;
                expect(forkId).to.not.be.undefined;

                const observer = h.getPeer(0);
                const bundle = await h
                    .control(observer)
                    .query.getLatestBlockBundle(forkId!)
                    .request();
                expect(bundle).to.not.be.null;

                // Same block bytes, but the author signature recovers to an outsider
                // instead of header.participant — authentication must fail.
                const signedBlock = Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                );
                const outsider = ethers.Wallet.createRandom();
                const forgedSignature = await outsider.signMessage(
                    ethers.getBytes(bundle!.hash)
                );

                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observer.index,
                    blockConfirmation: {
                        signedBlock: {
                            encodedBlock: signedBlock.encodedBlock,
                            signature: forgedSignature
                        },
                        signatures: []
                    },
                    keepConnection: false
                });
            }
        )
    );

    it(
        "ingest drops a wrong-channel block and cuts the transport when the sender is known",
        covers(
            {
                ingestOutcome: [
                    "wrong-channel-unknown-sender",
                    "wrong-channel-known-sender"
                ]
            },
            async function () {
                this.timeout(90000);

                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 0);

                const observer = h.getPeer(0);

                // An authentic block (author signature recovers to header.participant)
                // for a channel this peer is not in.
                const outsider = ethers.Wallet.createRandom();
                const foreignBlock = factory.block({
                    transaction: factory.transaction({
                        header: factory.transactionHeader({
                            channelId: ethers.hexlify(ethers.randomBytes(32)),
                            participant: outsider.address as Address
                        })
                    })
                });
                const blockConfirmation = {
                    signedBlock: {
                        encodedBlock: foreignBlock.encode(),
                        signature: await outsider.signMessage(
                            ethers.getBytes(foreignBlock.hash)
                        )
                    },
                    signatures: []
                };

                // Without a known sender the block is just ignored.
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observer.index,
                    blockConfirmation,
                    keepConnection: true,
                    waitForProcessed: false
                });

                // Sent over the real state-transition RPC, the observer rejects it
                // and cuts + blacklists the sending transport.
                const sender = h.getPeer(1);
                expect(
                    await h
                        .control(observer)
                        .query.isBlacklisted(sender.address)
                        .request()
                ).to.equal(false);
                await h
                    .control(sender)
                    .byzantine.sendBlockConfirmation(
                        Codec.encode(
                            blockConfirmation,
                            Type.BlockConfirmation
                        ) as string,
                        observer.address
                    )
                    .request();

                await waitFor(
                    async () =>
                        await h
                            .control(observer)
                            .query.isBlacklisted(sender.address)
                            .request(),
                    5000
                );
                expect(
                    await h
                        .control(observer)
                        .query.getBlockByHash(foreignBlock.hash)
                        .request()
                ).to.be.null;
            }
        )
    );

    it(
        "future block is evicted at queue timeout without punishing the supplier",
        covers(
            {
                ingestOutcome: "queued",
                queueTimeoutOutcome: "future-request-sync-evict",
                signedBlock: "future"
            },
            async function () {
                this.timeout(90000);

                const h = TestSession.getHarness();
                const timeConfig = {
                    p2pTime: 3,
                    agreementTime: 2,
                    chainFallbackTime: 30,
                    evidenceTime: 8
                };
                await h.lifecycle.start(4, 0, { timeConfig });

                const forkId = h.activeForkId;
                expect(forkId).to.not.be.undefined;

                const observerIndex = 3;
                const observer = h.getPeer(observerIndex);
                await h.network.disconnectPeer(observerIndex);

                await h.transition.advanceState({
                    count: 2,
                    waitForPeers: [0, 1, 2],
                    waitForFinalization: false
                });

                const source = await h.peerWithHighestBlock(forkId!);
                const block1 = await h
                    .control(source)
                    .query.getBlockByHeight(forkId!, 1)
                    .request();
                expect(block1).to.not.be.null;

                // Future block (height 1 > observer's nextHeight 0) queues.
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observerIndex,
                    blockConfirmation: Codec.decode(
                        block1!.encodedBlockConfirmation,
                        Type.BlockConfirmation
                    ),
                    ingestOptions: { senderAddress: h.getPeer(1).address },
                    keepConnection: true,
                    waitForProcessed: false
                });
                expect(
                    await h
                        .control(observer)
                        .query.isBlockQueued(block1!.hash)
                        .request()
                ).to.equal(true);

                // Once the agreement window lapses the entry is evicted - gossip is
                // free to forge, so unexecutable blocks must not accumulate.
                await waitFor(
                    async () =>
                        !(await h
                            .control(observer)
                            .query.isBlockQueued(block1!.hash)
                            .request()),
                    (timeConfig.agreementTime + 5) * 1000
                );
                expect(
                    await h
                        .control(observer)
                        .query.getBlockByHash(block1!.hash)
                        .request()
                ).to.be.null;
                // Eviction is hygiene, not punishment.
                expect(
                    await h
                        .control(observer)
                        .query.isBlacklisted(h.getPeer(1).address)
                        .request()
                ).to.equal(false);
            }
        )
    );

    it(
        "queued entry that becomes stored merges at queue timeout: strays stripped, supplier blacklisted",
        covers(
            {
                queueTimeoutOutcome: "now-stored-merge",
                signatureMerge: "non-participant-strip",
                attribution: "supplier-punished"
            },
            async function () {
                this.timeout(90000);

                const h = TestSession.getHarness();
                const timeConfig = {
                    p2pTime: 3,
                    agreementTime: 2,
                    chainFallbackTime: 30,
                    evidenceTime: 8
                };
                await h.lifecycle.start(4, 0, { timeConfig });

                const forkId = h.activeForkId;
                expect(forkId).to.not.be.undefined;

                // Keep the observer blind so the block stays queued as a future block.
                const observerIndex = 3;
                const observer = h.getPeer(observerIndex);
                await h.network.disconnectPeer(observerIndex);

                await h.transition.advanceState({
                    count: 2,
                    waitForPeers: [0, 1, 2],
                    waitForFinalization: false
                });

                const source = await h.peerWithHighestBlock(forkId!);
                const block1 = await h
                    .control(source)
                    .query.getBlockByHeight(forkId!, 1)
                    .request();
                expect(block1).to.not.be.null;

                // Tainted copy of h1 queues (height 1 > observer's nextHeight 0) with
                // the stray signature attributed to its supplier.
                const outsider = ethers.Wallet.createRandom();
                const badSignature = await outsider.signMessage(
                    ethers.getBytes(block1!.hash)
                );
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observerIndex,
                    blockConfirmation: {
                        signedBlock: Codec.decode(
                            block1!.encodedSignedBlock,
                            Type.SignedBlock
                        ),
                        signatures: [
                            ...block1!.confirmationSignatures,
                            badSignature
                        ]
                    },
                    ingestOptions: { senderAddress: h.getPeer(1).address },
                    keepConnection: true,
                    waitForProcessed: false
                });
                expect(
                    await h
                        .control(observer)
                        .query.getBlockByHash(block1!.hash)
                        .request()
                ).to.be.null;

                // The block becomes stored out-of-band (as state-proof persistence
                // does) while the entry still sits in the queue — the queue timeout
                // must merge it immediately with the entry's attribution intact.
                await h
                    .control(observer)
                    .transition.storeBlock(block1!.encodedBlockConfirmation)
                    .request();

                await waitFor(
                    async () =>
                        await h
                            .control(observer)
                            .query.isBlacklisted(h.getPeer(1).address)
                            .request(),
                    (timeConfig.agreementTime + 5) * 1000
                );
                const storedBlock = await h
                    .control(observer)
                    .query.getBlockByHash(block1!.hash)
                    .request();
                expect(storedBlock).to.not.be.null;
                expect(
                    storedBlock!.confirmationSignatures.includes(badSignature)
                ).to.equal(false);
            }
        )
    );
});
