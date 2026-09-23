import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { BlockConfirmationEthersType } from "@/types/ethers";
import { assertDeployedMaximum } from "@test/fixtures/QueueDeploymentFixture";
import {
    QueueIntakeFixture,
    receiveWithExplicitStrategy
} from "@test/fixtures/QueueIntakeFixture";
import { assertOutsiderProofDoesNotAdmitCopy } from "@test/fixtures/QueueNetworkRetentionFixture";
import { MathTestSession } from "@test/harness";
import { expect } from "chai";

describe("Unit: BlockQueueManager", () => {
    it("stopping the manager clears a future queued block and cancels its timeout", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        const result = await f.h.execOnHost(
            f.h.getPeer(0),
            async (sm, args, { ethers }) => {
                const schedule = sm.timeoutManager.scheduleTask.bind(
                    sm.timeoutManager
                );
                const cancel = sm.timeoutManager.cancelTask.bind(
                    sm.timeoutManager
                );
                const handles = new Set<ReturnType<typeof setTimeout>>();
                let cancelled = 0;
                sm.timeoutManager.scheduleTask = (task, delay, name) => {
                    const handle = schedule(task, delay, name);
                    if (name?.startsWith("BlockQueueManager.queueTimeout -"))
                        handles.add(handle);
                    return handle;
                };
                sm.timeoutManager.cancelTask = (handle) => {
                    if (handles.delete(handle)) cancelled++;
                    cancel(handle);
                };
                try {
                    const block = ethers.AbiCoder.defaultAbiCoder().decode(
                        [args.blockType],
                        args.encodedBlockConfirmation
                    )[0];
                    await sm.blockQueueManager.ingestBlockConfirmation(block, {
                        origin: args.origin,
                        senderAddress: args.source
                    });
                    const queuedBefore = !!sm.storage.queues.getQueuedEntry(
                        args.hash
                    );
                    const armedBefore = handles.size;
                    await sm.stop();
                    return {
                        queuedBefore,
                        armedBefore,
                        queuedAfter: !!sm.storage.queues.getQueuedEntry(
                            args.hash
                        ),
                        armedAfter: handles.size,
                        cancelled
                    };
                } finally {
                    sm.timeoutManager.scheduleTask = schedule;
                    sm.timeoutManager.cancelTask = cancel;
                }
            },
            {
                blockType: BlockConfirmationEthersType,
                encodedBlockConfirmation: f.encodedBlockConfirmation,
                origin: BlockOrigin.NETWORK as const,
                source: f.h.getPeer(1).address,
                hash: f.block.hash
            }
        );
        expect(result).to.deep.equal({
            queuedBefore: true,
            armedBefore: 1,
            queuedAfter: false,
            armedAfter: 0,
            cancelled: 1
        });
    });

    it("sync succeeds but the sender is still absent: blacklisted with no queue entry", async () => {
        await assertOutsiderProofDoesNotAdmitCopy("success");
    });

    it("an oversized verified eligibility cache does not expand the N-source allowance", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        try {
            const eligible = await f.h.execOnHost(
                f.h.getPeer(0),
                (sm, { sources }) => {
                    sm.membershipService.publishOffChainEligibility(sources);
                    return sources.map((source) =>
                        sm.membershipService.getCachedSourceEligibility(source)
                    );
                },
                { sources: f.strangers }
            );
            expect(eligible).to.deep.equal([
                SourceEligibility.ELIGIBLE,
                SourceEligibility.ELIGIBLE,
                SourceEligibility.ELIGIBLE
            ]);
            await f.receive(f.strangers[0]);
            await f.receive(f.strangers[1]);
            const before = await f.retention();
            await f.receive(f.strangers[2]);
            expect(before?.sourceCount).to.equal(2);
            expect(await f.retention()).to.deep.equal(before);
            expect((await f.observation()).chainReads).to.equal(0);
            expect((await f.observation()).syncRequests).to.equal(0);
            expect(
                await f.control.query.isBlacklisted(f.strangers[2]).request()
            ).to.equal(false);
        } finally {
            await f.close();
        }
    });

    it("an explicit validation strategy stays outside the queued storage clone boundary", async () => {
        const result = await receiveWithExplicitStrategy(false);
        expect(result.accepted).to.equal(true);
        expect(result.queued).not.to.equal(null);
    });
    it("an explicit validation strategy stays outside the stored-copy storage clone boundary", async () => {
        const result = await receiveWithExplicitStrategy(true);
        expect(result.accepted).to.equal(true);
        expect(result.storedHeight).to.equal(1);
    });

    it("deployment cache separates a small maximum from default and reuses the small deployment", async () => {
        const first = await assertDeployedMaximum(7);
        await MathTestSession.reset();
        const defaultManager = await assertDeployedMaximum();
        expect(defaultManager).not.to.equal(first);
        await MathTestSession.reset();
        expect(await assertDeployedMaximum(7)).to.equal(first);
    });

    it("eligible source bypasses refresh and sync before queue retention", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        try {
            expect(await f.receive()).to.equal(true);
            const entry = await f.retention();
            expect(entry?.perSource).to.deep.equal([
                { source: f.h.getPeer(1).address, count: 1 }
            ]);
            expect((await f.observation()).chainReads).to.equal(0);
            expect((await f.observation()).syncRequests).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("wrong channel is rejected before sender refresh or retention", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ wrongChannel: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(false);
            expect(await f.retention()).to.equal(null);
            expect((await f.observation()).chainReads).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("forged author is rejected before sender refresh or retention", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ forgedAuthor: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(false);
            expect(await f.retention()).to.equal(null);
            expect((await f.observation()).chainReads).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("a source absent after a failed refresh follows ordinary sync", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ failMembership: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect(await f.retention()).to.equal(null);
            expect((await f.observation()).chainReads).to.equal(1);
            expect((await f.observation()).completedSyncs).to.equal(1);
            expect((await f.observation()).syncRequests).to.equal(0);
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(true);
        } finally {
            await f.close();
        }
    });

    it("an intake the channel reset overtakes neither syncs nor blacklists its source", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ holdMembership: true });
        const pending = f.receive(f.strangers[0]);
        try {
            await f.waitForRead();
            // The sender's refresh is parked on its chain read; the runtime
            // leaves the channel before it resumes.
            await f.h.execOnHost(f.h.getPeer(0), async (sm) => {
                await sm.resetChannel();
            });
            await f.control.stub.releaseAdmissionMembership().request();
            expect(await pending).to.equal(true);
            expect((await f.observation()).membershipSyncs).to.equal(0);
            expect((await f.observation()).completedSyncs).to.equal(0);
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(false);
        } finally {
            await f.control.stub.releaseAdmissionMembership().request();
            await pending;
            await f.close();
        }
    });

    it("a failed unknown copy preserves the existing honest contribution", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ failMembership: true });
        try {
            await f.receive();
            const before = await f.retention();
            await f.receive(f.strangers[0]);
            expect(await f.retention()).to.deep.equal(before);
            expect((await f.observation()).syncRequests).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("a failed membership read can retry on the next request", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ failMembership: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect((await f.observation()).chainReads).to.equal(2);
            expect((await f.observation()).completedSyncs).to.equal(2);
            expect(await f.retention()).to.equal(null);
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(true);
        } finally {
            await f.close();
        }
    });

    it("sync with no sender transport ends intake without queueing the block", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        try {
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect((await f.observation()).syncRequests).to.equal(0);
            expect((await f.observation()).completedSyncs).to.equal(1);
            expect(await f.retention()).to.equal(null);
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(true);
        } finally {
            await f.close();
        }
    });
});
