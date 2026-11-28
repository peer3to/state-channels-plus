import { StateSnapshot } from "@/models";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("Unit: EventHandler snapshot event membership publish", function () {
    // the channel's first snapshot (block of ChannelOpened) and a later one
    // posted on the same fork; the handler answers an event carrying the
    // snapshot the chain held at `snapshotBlock`
    const stageSnapshots = async (
        h: ReturnType<typeof TestSession.getHarness>
    ) => {
        await h.lifecycle.start(3, 0);
        const [opened] = await h.channelManager.queryFilter(
            h.channelManager.filters.ChannelOpened(h.channelId)
        );
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        const posted = await h.transition.postSnapshotWait();
        expect(posted, "the same-fork snapshot post must land").to.not.equal(
            undefined
        );
        const updates = await h.channelManager.queryFilter(
            h.channelManager.filters.StateSnapshotUpdated(h.channelId)
        );
        const latest = updates.at(-1)!;
        return {
            openedBlock: opened.blockNumber,
            openedLogIndex: opened.index,
            latestBlock: latest.blockNumber,
            latestLogIndex: latest.index
        };
    };

    const handleSnapshotEvent = async (
        h: ReturnType<typeof TestSession.getHarness>,
        staged: Awaited<ReturnType<typeof stageSnapshots>>,
        snapshotBlock: number,
        event: { blockNumber: number; logIndex: number },
        closing = false,
        // the read node's head stays at this block until it is released
        lagAtBlock?: number
    ) => {
        const peer = h.getPeer(1);
        const stub = h.control(peer).stub;
        // the peer's own handling of the posted snapshot's live event must
        // not publish while the handler under test is recorded
        await h.event.settleContractEvents(peer.index);
        await stub.recordPublishedSnapshots().request();
        const chainView =
            lagAtBlock === undefined
                ? undefined
                : await h.rpcStub.lagChainView(peer.index, {
                      holdLogs: false,
                      atBlock: lagAtBlock
                  });
        try {
            const handling = h.execOnHost(
                peer,
                async (sm, args) => {
                    const contract = sm.stateChannelManagerContract;
                    // the event carries the snapshot the chain held at
                    // `snapshotBlock`, announced at the latest update's block
                    const held = await contract.getStateSnapshot(sm.channelId, {
                        blockTag: args.snapshotBlock
                    });
                    // a closing snapshot has no participants
                    const snapshot = !args.closing
                        ? held
                        : {
                              forkId: held.forkId,
                              blockHeight: held.blockHeight,
                              timestamp: held.timestamp,
                              snapshotData: {
                                  originForkId: held.snapshotData.originForkId,
                                  stateMachineStateHash:
                                      held.snapshotData.stateMachineStateHash,
                                  participants: [],
                                  latestInboundMessageBlockHash:
                                      held.snapshotData
                                          .latestInboundMessageBlockHash,
                                  latestInboundMessageBlockHeight:
                                      held.snapshotData
                                          .latestInboundMessageBlockHeight,
                                  latestOutboundMessageBlockHash:
                                      held.snapshotData
                                          .latestOutboundMessageBlockHash,
                                  latestOutboundMessageBlockHeight:
                                      held.snapshotData
                                          .latestOutboundMessageBlockHeight,
                                  totalDeposits:
                                      held.snapshotData.totalDeposits,
                                  totalWithdrawals:
                                      held.snapshotData.totalWithdrawals
                              }
                          };
                    await sm.eventHandler.onStateSnapshotUpdated(
                        sm.channelId,
                        snapshot,
                        args.event
                    );
                },
                { snapshotBlock, event, closing }
            );
            if (chainView) {
                // the handler waits for the read node to reach the event's block
                await waitFor(
                    async () => (await chainView.chainHeadWaitsEntered()) > 0
                );
                expect(
                    await stub.getLastPublishedSnapshotHash().request()
                ).to.equal(null);
                await chainView.release();
                await h.rpcStub.mineTransferBlock();
            }
            await handling;
            return await stub.getLastPublishedSnapshotHash().request();
        } finally {
            await chainView?.release();
            await stub.restorePublishedSnapshots().request();
        }
    };

    it("a snapshot event whose snapshot the chain still holds is published to membership", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSnapshots(h);
        const published = await handleSnapshotEvent(
            h,
            staged,
            staged.latestBlock,
            {
                blockNumber: staged.latestBlock,
                logIndex: staged.latestLogIndex
            }
        );
        expect(published).to.equal(await h.query.getOnChainSnapshotHash());
    });

    it("a snapshot event announced after a newer snapshot landed is not published to membership", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSnapshots(h);
        const published = await handleSnapshotEvent(
            h,
            staged,
            staged.openedBlock,
            {
                blockNumber: staged.latestBlock,
                logIndex: staged.latestLogIndex
            }
        );
        expect(published).to.equal(null);
    });

    it("an older snapshot event handled after a newer one is not published to membership", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSnapshots(h);
        expect(staged.openedBlock).to.be.lessThan(staged.latestBlock);
        const published = await handleSnapshotEvent(
            h,
            staged,
            staged.openedBlock,
            {
                blockNumber: staged.openedBlock,
                logIndex: staged.openedLogIndex
            }
        );
        expect(published).to.equal(null);
    });

    it("a closing snapshot, which has no participants, is published to membership although the chain holds a different snapshot", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSnapshots(h);
        const held = StateSnapshot.from(
            await h.channelManager.getStateSnapshot(h.channelId)
        );
        const closing = StateSnapshot.from({
            forkId: held.toStruct().forkId,
            blockHeight: held.toStruct().blockHeight,
            timestamp: held.toStruct().timestamp,
            snapshotData: { ...held.snapshotData, participants: [] }
        });
        const published = await handleSnapshotEvent(
            h,
            staged,
            staged.latestBlock,
            {
                blockNumber: staged.latestBlock,
                logIndex: staged.latestLogIndex
            },
            true
        );
        expect(closing.hash).to.not.equal(held.hash);
        expect(published).to.equal(closing.hash);
    });

    it("a snapshot event of a block the read node has not reached waits for the node, then publishes the snapshot the chain holds", async function () {
        const h = TestSession.getHarness();
        const staged = await stageSnapshots(h);
        const published = await handleSnapshotEvent(
            h,
            staged,
            staged.latestBlock,
            {
                blockNumber: staged.latestBlock,
                logIndex: staged.latestLogIndex
            },
            false,
            staged.latestBlock - 1
        );
        expect(published).to.equal(await h.query.getOnChainSnapshotHash());
    });
});
