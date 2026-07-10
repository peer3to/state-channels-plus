import { expect } from "chai";
import { ethers } from "ethers";
import Clock from "@/Clock";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession, sleep } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import type { BlockBundle } from "@test/fixtures/customRpc/harnessControl/services/query/QueryRpcMethods";
import { covers } from "./domain";

describe("block-confirmation / queueMerge", function () {
    it(
        "queued future block accepts later calldata event and executes after predecessor",
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
                // Suppress every peer posting its own block on-chain (forces the
                // calldata path).
                await Promise.all(
                    h.peers.map((peer) =>
                        h
                            .control(peer)
                            .stub.stubSuppressMaybePostBlockOnChain()
                            .request()
                    )
                );

                const observerIndex = 3;
                const observer = h.getPeer(observerIndex);
                await h.network.disconnectPeer(observerIndex);
                const observerInitialSum =
                    await observer.contractInstance.getSum();

                await h.transition.advanceState({
                    count: 2,
                    waitForPeers: [0, 1, 2],
                    waitForFinalization: false
                });

                const source = await h.peerWithHighestBlock(forkId!);
                const block1 = await h
                    .control(source)
                    .query.getBlockByHeight(forkId!, 0)
                    .request();
                const block2 = await h
                    .control(source)
                    .query.getBlockByHeight(forkId!, 1)
                    .request();
                expect(block1).to.not.be.null;
                expect(block2).to.not.be.null;
                expect(
                    Number(
                        await h
                            .control(observer)
                            .query.getNextBlockHeight(forkId!)
                            .request()
                    )
                ).to.equal(0);

                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observerIndex,
                    blockConfirmation: Codec.decode(
                        block2!.encodedBlockConfirmation,
                        Type.BlockConfirmation
                    ),
                    keepConnection: true,
                    waitForProcessed: false
                });
                expect(
                    await h
                        .control(observer)
                        .query.getBlockByHash(block2!.hash)
                        .request()
                ).to.be.null;

                // Posts the block's calldata on-chain via the author's signer (the SCM
                // contract + signer are client-side, so this needs no host round-trip)
                // and returns the mined block's timestamp — what an event (re)read
                // would deliver as onChainTimestamp.
                const postBlockCalldata = async (block: BlockBundle) => {
                    const author = h.peers.find(
                        (peer) =>
                            peer.address.toLowerCase() ===
                            block.author.toLowerCase()
                    );
                    expect(author).to.not.be.undefined;

                    const tx = await h.channelManager
                        .connect(author!.signer)
                        .postBlockCalldata(
                            Codec.decode(
                                block.encodedSignedBlock,
                                Type.SignedBlock
                            ),
                            Clock.getTimeInSeconds() + 1000
                        );
                    const receipt = await tx.wait();
                    const minedBlock = await author!.signer.provider!.getBlock(
                        receipt!.blockNumber
                    );
                    return Number(minedBlock!.timestamp);
                };

                h.event.resetEventSpies(observerIndex);
                const block2OnChainTimestamp = await postBlockCalldata(block2!);
                await h.event.waitUntilEventOccurs(
                    "onBlockCalldataPosted",
                    5000,
                    [observerIndex]
                );
                expect(
                    await h
                        .control(observer)
                        .query.getBlockByHash(block2!.hash)
                        .request()
                ).to.be.null;

                await sleep((timeConfig.agreementTime + 1) * 1000);

                // The future calldata copy was evicted at the queue timeout — the
                // chain still holds it, so nothing is lost.
                expect(
                    await h
                        .control(observer)
                        .query.isBlockQueued(block2!.hash)
                        .request()
                ).to.equal(false);

                // maybePostBlockOnChain is stubbed ()=>{} + after AgreementTime the subjective check each peer does would fail, so if the block is accepted -> calldata path
                await postBlockCalldata(block1!);

                await waitFor(
                    async () =>
                        (await h
                            .control(observer)
                            .query.getBlockByHash(block1!.hash)
                            .request()) !== null,
                    5000
                );

                // Re-deliver block2 from the chain (as an event re-read would) — it
                // is next now and applies through the calldata path.
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observerIndex,
                    blockConfirmation: Codec.decode(
                        block2!.encodedBlockConfirmation,
                        Type.BlockConfirmation
                    ),
                    ingestOptions: { onChainTimestamp: block2OnChainTimestamp },
                    keepConnection: true,
                    waitForProcessed: false
                });
                await waitFor(
                    async () =>
                        (await h
                            .control(observer)
                            .query.getBlockByHash(block2!.hash)
                            .request()) !== null,
                    5000
                );

                const storedBlock2 = await h
                    .control(observer)
                    .query.getBlockByHash(block2!.hash)
                    .request();
                expect(storedBlock2?.onChainTimestamp).to.not.be.null;
                expect(await observer.contractInstance.getSum()).to.equal(
                    observerInitialSum + 2n
                );
            }
        )
    );

    it(
        "queued duplicate block does not fall through to double sign",
        covers(
            {
                signedBlock: "duplicate"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 1);

                const observer = h.getPeer(0);
                const forkId = h.activeForkId;
                expect(forkId).to.not.be.undefined;

                const block = await h
                    .control(observer)
                    .query.getLatestBlockBundle(forkId!)
                    .request();
                expect(block).to.not.be.null;

                // One-off white-box mutation: queue the latest block host-side.
                await h.execOnHost(
                    observer,
                    (sm, args) => {
                        const latest = sm.storage.blocks.getLatestBlock(
                            args.forkId
                        );
                        if (!latest)
                            throw new Error("no latest block to queue");
                        sm.storage.queues.queueBlock(latest);
                    },
                    { forkId: forkId! }
                );

                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observer.index,
                    blockConfirmation: Codec.decode(
                        block!.encodedBlockConfirmation,
                        Type.BlockConfirmation
                    ),
                    keepConnection: true,
                    waitForProcessed: true
                });

                expect(
                    observer.eventSpies.onInitiatingDispute!.called
                ).to.equal(false);
            }
        )
    );

    it(
        "stored duplicate merges trusted timestamp without replaying transition",
        covers(
            {
                ingestOutcome: "already-stored-merge",
                signatureMerge: "merged-onchain-timestamp"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 1);

                const observer = h.getPeer(0);
                const forkId = h.activeForkId;
                expect(forkId).to.not.be.undefined;

                const block = await h
                    .control(observer)
                    .query.getLatestBlockBundle(forkId!)
                    .request();
                expect(block).to.not.be.null;

                const initialNextHeight = Number(
                    await h
                        .control(observer)
                        .query.getNextBlockHeight(forkId!)
                        .request()
                );
                const initialSum = await observer.contractInstance.getSum();

                const expectedTimestamp = block!.timestamp + 1000;
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observer.index,
                    blockConfirmation: {
                        signedBlock: Codec.decode(
                            block!.encodedSignedBlock,
                            Type.SignedBlock
                        ),
                        signatures: []
                    },
                    ingestOptions: { onChainTimestamp: expectedTimestamp },
                    keepConnection: true,
                    processedKeepConnection: true
                });

                await waitFor(
                    async () =>
                        (
                            await h
                                .control(observer)
                                .query.getBlockByHash(block!.hash)
                                .request()
                        )?.onChainTimestamp === expectedTimestamp,
                    5000
                );
                expect(
                    Number(
                        await h
                            .control(observer)
                            .query.getNextBlockHeight(forkId!)
                            .request()
                    )
                ).to.equal(initialNextHeight);
                expect(await observer.contractInstance.getSum()).to.equal(
                    initialSum
                );
                expect(
                    (
                        await h
                            .control(observer)
                            .query.getBlockByHash(block!.hash)
                            .request()
                    )?.onChainTimestamp
                ).to.equal(expectedTimestamp);
            }
        )
    );

    it(
        "stored duplicate drops a new signature from a non-participant without dropping the block",
        covers(
            {
                signatureMerge: "non-participant-strip",
                attribution: "supplier-punished"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 1);

                const observer = h.getPeer(0);
                const forkId = h.activeForkId;
                expect(forkId).to.not.be.undefined;

                const block = await h
                    .control(observer)
                    .query.getLatestBlockBundle(forkId!)
                    .request();
                expect(block).to.not.be.null;

                const outsider = ethers.Wallet.createRandom();
                const badSignature = await outsider.signMessage(
                    ethers.getBytes(block!.hash)
                );
                await h.transition.ingestBlockConfirmationWait({
                    peerIndex: observer.index,
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
                    // The merge is a scheduled task and setup echoes of this block
                    // fire matching processed events, so waiting on the event races —
                    // poll for the strategy's outcome (sender blacklisted) instead.
                    waitForProcessed: false
                });

                await waitFor(
                    async () =>
                        await h
                            .control(observer)
                            .query.isBlacklisted(h.getPeer(1).address)
                            .request(),
                    5000
                );
                const storedBlock = await h
                    .control(observer)
                    .query.getBlockByHash(block!.hash)
                    .request();
                expect(
                    storedBlock?.confirmationSignatures.includes(badSignature)
                ).to.equal(false);
            }
        )
    );
});
