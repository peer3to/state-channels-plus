import { QueueAdmissionFixture } from "../fixtures/QueueAdmissionFixture";
import Clock from "@/Clock";
import Storage from "@/storage";
import {
    BlockOrigin,
    QueueStorage,
    getSignatureSuppliers
} from "@/storage/QueueStorage";
import { expect } from "chai";
import { ethers } from "hardhat";
import { before, describe, it } from "mocha";

describe("QueueStorage", () => {
    before(async () => {
        await Clock.init(ethers.provider);
    });
    it("counts the author first with maximum one", () => {
        const f = new QueueAdmissionFixture(1);
        f.offer(0, [f.signature()]);
        expect([
            ...f.entry().sourcesToSignatures.get(f.wallets[0].address)!
        ]).to.deep.equal([f.block.originalSignature]);
        expect(f.entry().block.confirmationSignatures.size).to.equal(0);
    });

    it("keeps an empty-confirmation source with its author charge", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1);
        expect([...f.entry().sourcesToSignatures.keys()]).to.deep.equal([
            f.wallets[1].address
        ]);
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(1);
    });

    it("admits exact values below the source signature boundary", () => {
        const f = new QueueAdmissionFixture(3);
        const offered = Array.from({ length: 1 }, (_, i) => f.signature(1, i));
        f.offer(1, offered);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal(
            offered.slice(0, 2)
        );
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(2);
    });

    it("admits exact values at the source signature boundary", () => {
        const f = new QueueAdmissionFixture(3);
        const offered = Array.from({ length: 2 }, (_, i) => f.signature(1, i));
        f.offer(1, offered);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal(
            offered.slice(0, 2)
        );
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(3);
    });

    it("admits exact values above the source signature boundary", () => {
        const f = new QueueAdmissionFixture(3);
        const offered = Array.from({ length: 3 }, (_, i) => f.signature(1, i));
        f.offer(1, offered);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal(
            offered.slice(0, 2)
        );
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(3);
    });

    it("repeated copies do not refill the same source allowance", () => {
        const f = new QueueAdmissionFixture(2);
        const first = f.signature(1, 0),
            second = f.signature(1, 1);
        f.offer(1, [first]);
        f.offer(1, [second]);
        f.offer(1, [first]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            first
        ]);
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(2);
    });

    it("lowercase and checksummed sources share one signature allowance", () => {
        const f = new QueueAdmissionFixture(2);
        const first = f.signature(1, 0);
        f.queue.queueBlock(f.copy([first]), {
            origin: BlockOrigin.NETWORK,
            senderAddress: f.wallets[1].address.toLowerCase()
        });
        f.offer(1, [f.signature(1, 1)]);
        expect([...f.entry().sourcesToSignatures.keys()]).to.deep.equal([
            f.wallets[1].address
        ]);
        expect([
            ...f.entry().sourcesToSignatures.get(f.wallets[1].address)!
        ]).to.deep.equal([f.block.originalSignature, first]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            first
        ]);
    });

    it("another admitted source keeps its own allowance", () => {
        const f = new QueueAdmissionFixture(2);
        const a = f.signature(1),
            b = f.signature(2);
        f.offer(1, [a]);
        f.offer(1, [f.signature(1, 1)]);
        f.offer(2, [b]);
        expect([...f.entry().block.confirmationSignatures]).to.have.members([
            a,
            b
        ]);
        expect(
            [...f.entry().sourcesToSignatures.values()].map((x) => x.size)
        ).to.deep.equal([2, 2]);
    });

    it("distinct signatures from the same signer consume distinct slots", () => {
        const f = new QueueAdmissionFixture(3);
        const values = [
            f.signature(1, 0),
            f.signature(1, 1),
            f.signature(1, 2)
        ];
        expect(new Set(values).size).to.equal(3);
        expect(values.map((s) => f.block.signatureToAddress(s))).to.deep.equal(
            Array(3).fill(f.wallets[1].address)
        );
        f.offer(1, values);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal(
            values.slice(0, 2)
        );
    });

    it("shared signatures charge each actual supplier independently", () => {
        const f = new QueueAdmissionFixture(2);
        const signature = f.signature(1);
        f.offer(1, [signature]);
        f.offer(2, [signature]);
        expect(f.entry().block.confirmationSignatures.size).to.equal(1);
        expect([
            ...getSignatureSuppliers(f.entry(), new Set([signature]))
        ]).to.have.members([f.wallets[1].address, f.wallets[2].address]);
        expect(
            [...f.entry().sourcesToSignatures.values()].map((x) => x.size)
        ).to.deep.equal([2, 2]);
    });

    it("an author repeated in confirmations spends only one slot", () => {
        const f = new QueueAdmissionFixture(2);
        const signature = f.signature(1);
        f.offer(1, [f.block.originalSignature, signature]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            signature
        ]);
    });

    it("equivalent signature encodings deduplicate", () => {
        const f = new QueueAdmissionFixture(2);
        const signature = f.signature(1);
        f.offer(1, [signature]);
        f.queue.queueBlock(f.copy(["0x" + signature.slice(2).toUpperCase()]), {
            origin: BlockOrigin.NETWORK,
            senderAddress: f.wallets[1].address
        });
        expect(f.entry().sourcesToSignatures.size).to.equal(1);
        expect(f.entry().block.confirmationSignatures.size).to.equal(1);
    });

    it("source capacity rejects a new identity without timestamp mutation", () => {
        const f = new QueueAdmissionFixture(2);
        f.offer(0, [], 17);
        f.offer(1, []);
        const before = f.entry().firstSeenAt;
        expect(f.offer(2, [f.signature(2)], 0)).to.equal(undefined);
        expect(f.entry().sourcesToSignatures.size).to.equal(2);
        expect(f.entry().block.onChainTimestamp).to.equal(17);
        expect(f.entry().firstSeenAt).to.equal(before);
    });

    it("an existing source can fill remaining slots after source capacity", () => {
        const f = new QueueAdmissionFixture(2);
        f.offer(0);
        f.offer(1);
        const signature = f.signature(1);
        f.offer(1, [signature]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            signature
        ]);
    });

    it("short signature values consume only their source budget", () => {
        const f = new QueueAdmissionFixture(2);
        const valid = f.signature(1);
        f.offer(1, ["0x01", valid]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            "0x01"
        ]);
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(2);
    });

    it("empty signature values consume only their source budget", () => {
        const f = new QueueAdmissionFixture(2);
        const valid = f.signature(1);
        f.offer(1, ["0x", valid]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            "0x"
        ]);
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(2);
    });

    it("oversized signature values consume only their source budget", () => {
        const f = new QueueAdmissionFixture(2);
        const valid = f.signature(1);
        f.offer(1, ["0x" + "ab".repeat(4096), valid]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            "0x" + "ab".repeat(4096)
        ]);
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(2);
    });

    it("nonhex signature values consume only their source budget", () => {
        const f = new QueueAdmissionFixture(2);
        const valid = f.signature(1);
        f.offer(1, ["0x" + "zz".repeat(65), valid]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            "0x" + "zz".repeat(65)
        ]);
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(2);
    });

    it("retains fixed-size unrecoverable bytes within the supplier quota", () => {
        const f = new QueueAdmissionFixture(2);
        const invalid = "0x" + "00".repeat(64) + "1b";
        f.offer(1, [invalid, f.signature(1)]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            invalid
        ]);
        expect(() => f.entry().block.signatureToAddress(invalid)).to.throw();
    });

    it("removing invalid confirmations does not refund their charge", () => {
        const f = new QueueAdmissionFixture(2);
        const invalid = "0x" + "00".repeat(64) + "1b";
        f.offer(1, [invalid]);
        const work = f.take();
        work.block.removeConfirmationSignatures(new Set([invalid]));
        f.queue.restoreEntry(work);
        f.offer(1, [f.signature(1)]);
        expect(f.entry().block.confirmationSignatures.size).to.equal(0);
        expect(
            f.entry().sourcesToSignatures.get(f.wallets[1].address)!.size
        ).to.equal(2);
        const honest = f.signature(2);
        f.offer(2, [honest]);
        expect([...f.entry().block.confirmationSignatures]).to.deep.equal([
            honest
        ]);
    });

    it("restore merges concurrent copies within each source allowance", () => {
        const f = new QueueAdmissionFixture(2);
        const a = f.signature(1),
            b = f.signature(2);
        f.offer(1, [a]);
        const work = f.take();
        f.offer(1, [f.signature(1, 1)]);
        f.offer(2, [b]);
        expect(f.entry().sourcesToSignatures.size).to.equal(2);
        f.queue.restoreEntry(work);
        const restored = f.take();
        expect([...restored.block.confirmationSignatures]).to.have.members([
            f.signature(1, 1),
            b
        ]);
        expect(
            [...restored.sourcesToSignatures.values()].map(
                (values) => values.size
            )
        ).to.deep.equal([2, 2]);
        expect([
            ...restored.sourcesToSignatures.get(f.wallets[1].address)!
        ]).to.deep.equal([f.block.originalSignature, f.signature(1, 1)]);
        expect([
            ...restored.sourcesToSignatures.get(f.wallets[2].address)!
        ]).to.deep.equal([f.block.originalSignature, b]);
        expect(restored.block.confirmationSignatures.has(a)).to.equal(false);
    });

    it("copies after dequeue form an independent queued entry", () => {
        const f = new QueueAdmissionFixture(1);
        f.offer(0);
        const processing = f.take();
        f.offer(1);
        expect([...f.entry().sourcesToSignatures.keys()]).to.deep.equal([
            f.wallets[1].address
        ]);
        expect([...processing.sourcesToSignatures.keys()]).to.deep.equal([
            f.wallets[0].address
        ]);
    });

    it("dequeued entries restore attribution through the Storage proxy", () => {
        const f = new QueueAdmissionFixture(2);
        const storage = new Storage(2);
        storage.queues.queueBlock(f.copy([f.signature(1)]), {
            origin: BlockOrigin.NETWORK,
            senderAddress: f.wallets[1].address
        });
        const entry = storage.queues.tryDequeueAt(
            f.block.forkId,
            f.block.height
        )[0];
        expect(storage.queues.getQueuedEntry(f.block.hash)).to.equal(undefined);
        storage.queues.restoreEntry(entry);
        const restored = storage.queues.tryDequeueAt(
            f.block.forkId,
            f.block.height
        )[0];
        expect([
            ...restored.sourcesToSignatures.get(f.wallets[1].address)!
        ]).to.deep.equal([
            ...entry.sourcesToSignatures.get(f.wallets[1].address)!
        ]);
        expect(restored.firstSeenAt).to.equal(entry.firstSeenAt);
    });

    it("Storage isolates returned block and source maps", () => {
        const f = new QueueAdmissionFixture();
        const storage = new Storage(3);
        const signature = f.signature(1);
        storage.queues.queueBlock(f.copy([signature]), {
            origin: BlockOrigin.NETWORK,
            senderAddress: f.wallets[1].address
        });
        const copy = storage.queues.getQueuedEntry(f.block.hash)!;
        copy.block.removeConfirmationSignatures(new Set([signature]));
        copy.sourcesToSignatures.clear();
        const stored = storage.queues.getQueuedEntry(f.block.hash)!;
        expect([...stored.block.confirmationSignatures]).to.deep.equal([
            signature
        ]);
        expect(stored.sourcesToSignatures.size).to.equal(1);
    });

    it("merge preserves the existing rule for missing timestamp", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1, [], 17);
        f.offer(1, [], undefined);
        expect(f.entry().block.onChainTimestamp).to.equal(17);
    });

    it("merge preserves the existing rule for zero timestamp", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1, [], 17);
        f.offer(1, [], 0);
        expect(f.entry().block.onChainTimestamp).to.equal(0);
    });

    it("merge preserves the existing rule for defined timestamp", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1, [], 0);
        f.offer(1, [], 17);
        expect(f.entry().block.onChainTimestamp).to.equal(17);
    });

    it("restore with zero timestamp replaces a concurrently supplied timestamp", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1, [], 0);
        const work = f.take();
        f.offer(2, [], 17);
        f.queue.restoreEntry(work);
        expect(f.entry().block.onChainTimestamp).to.equal(0);
    });

    it("restore without timestamp preserves a concurrently supplied timestamp", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1);
        const work = f.take();
        f.offer(2, [], 17);
        f.queue.restoreEntry(work);
        expect(f.entry().block.onChainTimestamp).to.equal(17);
    });

    it("exact dequeue removes the entry and returns its attribution", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1, [f.signature(1)]);
        const entry = f.take();
        expect(f.queue.isBlockQueued(f.block)).to.equal(false);
        expect(f.take()).to.equal(undefined);
        expect([...entry.sourcesToSignatures.keys()]).to.deep.equal([
            f.wallets[1].address
        ]);
        expect([...entry.block.confirmationSignatures]).to.deep.equal([
            f.signature(1)
        ]);
    });

    it("priority dequeue chooses the lowest eligible height", () => {
        const low = new QueueAdmissionFixture(3, 1),
            high = new QueueAdmissionFixture(3, 3);
        const queue = low.queue;
        queue.queueBlock(high.copy(), {
            origin: BlockOrigin.NETWORK,
            senderAddress: high.wallets[1].address
        });
        low.offer(1);
        expect(
            queue
                .tryDequeuePriority(low.block.forkId, 2)
                .map((x) => x.block.height)
        ).to.deep.equal([1]);
        expect(queue.tryDequeuePriority(low.block.forkId, 2)).to.have.lengthOf(
            0
        );
        expect(
            queue
                .tryDequeuePriority(high.block.forkId, 3)
                .map((x) => x.block.height)
        ).to.deep.equal([3]);
    });

    it("two hashes at the same coordinates remain separate", () => {
        const first = new QueueAdmissionFixture(),
            second = new QueueAdmissionFixture();
        first.offer(1);
        first.queue.queueBlock(second.copy(), {
            origin: BlockOrigin.NETWORK,
            senderAddress: second.wallets[1].address
        });
        expect(
            first.queue
                .tryDequeueAt(first.block.forkId, 0)
                .map((x) => x.block.hash)
        ).to.have.members([first.block.hash, second.block.hash]);
    });

    it("standalone proof input preserves signatures without inventing a source", () => {
        const f = new QueueAdmissionFixture(1);
        f.offer(1);
        const signatures = [f.signature(1), f.signature(2), f.signature(3)];
        const proof = f.queue.createEntry(f.copy(signatures), {
            origin: BlockOrigin.PROOF
        });
        expect([...proof.block.confirmationSignatures]).to.have.members(
            signatures
        );
        expect(proof.sourcesToSignatures.size).to.equal(0);
        expect(f.entry().block.confirmationSignatures.size).to.equal(0);
    });

    it("calldata updates trusted time without inventing a supplier", () => {
        const f = new QueueAdmissionFixture(1);
        f.offer(1);
        f.queue.queueBlock(f.copy([], 0), { origin: BlockOrigin.CALLDATA });
        const network = f.entry();
        expect(network.block.onChainTimestamp).to.equal(0);
        expect([...network.sourcesToSignatures.keys()]).to.deep.equal([
            f.wallets[1].address
        ]);
    });

    it("clear removes queued entries and their coordinate index", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1);
        f.queue.clear();
        expect(f.queue.getQueuedEntry(f.block.hash)).to.equal(undefined);
        expect(
            f.queue.tryDequeueAt(f.block.forkId, f.block.height)
        ).to.deep.equal([]);
    });

    it("rejects a zero participant maximum", () => {
        expect(() => new QueueStorage(0)).to.throw("positive safe integer");
    });

    it("rejects a negative participant maximum", () => {
        expect(() => new QueueStorage(-1)).to.throw("positive safe integer");
    });

    it("rejects a fractional participant maximum", () => {
        expect(() => new QueueStorage(1.5)).to.throw("positive safe integer");
    });

    it("rejects a NaN participant maximum", () => {
        expect(() => new QueueStorage(NaN)).to.throw("positive safe integer");
    });

    it("rejects a infinite participant maximum", () => {
        expect(() => new QueueStorage(Infinity)).to.throw(
            "positive safe integer"
        );
    });

    it("rejects a unsafe integer participant maximum", () => {
        expect(() => new QueueStorage(Number.MAX_SAFE_INTEGER + 1)).to.throw(
            "positive safe integer"
        );
    });

    it("standalone default and explicit maxima are observable", () => {
        expect(new QueueStorage().maxChannelParticipants).to.equal(32);
        expect(new Storage(4).queues.maxChannelParticipants).to.equal(4);
    });
    it("keeps the first author envelope and attributes an alternative only to its supplier", () => {
        const f = new QueueAdmissionFixture(2);
        f.offer(0);
        const alternative = f.alternateEnvelope(1);
        f.queue.queueBlock(alternative, {
            origin: BlockOrigin.NETWORK,
            senderAddress: f.wallets[1].address
        });
        expect(f.entry().block.originalSignature).to.equal(
            f.block.originalSignature
        );
        expect([
            ...f.entry().sourcesToSignatures.get(f.wallets[1].address)!
        ]).to.deep.equal([alternative.originalSignature]);
        expect([
            ...getSignatureSuppliers(
                f.entry(),
                new Set([f.block.originalSignature])
            )
        ]).to.deep.equal([f.wallets[0].address]);
    });

    it("retains exactly N squared values when N sources supply disjoint envelopes and confirmations", () => {
        const f = new QueueAdmissionFixture(3);
        const supplied = [0, 1, 2].map((source) =>
            f.alternateEnvelope(source, [
                f.signature(source + 1, 10),
                f.signature(source + 1, 11)
            ])
        );
        supplied.forEach((copy, source) =>
            f.queue.queueBlock(copy, {
                origin: BlockOrigin.NETWORK,
                senderAddress: f.wallets[source].address
            })
        );
        const entry = f.entry();
        expect(entry.sourcesToSignatures.size).to.equal(3);
        expect(
            [...entry.sourcesToSignatures.values()].map((values) => values.size)
        ).to.deep.equal([3, 3, 3]);
        expect(
            new Set(
                [...entry.sourcesToSignatures.values()].flatMap((values) => [
                    ...values
                ])
            ).size
        ).to.equal(9);
        expect(entry.block.allSignatures.size).to.equal(9);
    });

    it("reversing below-limit copies preserves the union and exact supplier attribution", () => {
        const f = new QueueAdmissionFixture(3);
        const reverse = new QueueStorage(3);
        const first = f.signature(1),
            second = f.signature(2);
        f.offer(1, [first]);
        f.offer(2, [second]);
        reverse.queueBlock(f.copy([second]), {
            origin: BlockOrigin.NETWORK,
            senderAddress: f.wallets[2].address
        });
        reverse.queueBlock(f.copy([first]), {
            origin: BlockOrigin.NETWORK,
            senderAddress: f.wallets[1].address
        });
        const reversed = reverse.getQueuedEntry(f.block.hash)!;
        expect([...reversed.block.confirmationSignatures]).to.have.members([
            ...f.entry().block.confirmationSignatures
        ]);
        expect([
            ...getSignatureSuppliers(reversed, new Set([first]))
        ]).to.deep.equal([f.wallets[1].address]);
        expect([
            ...getSignatureSuppliers(reversed, new Set([second]))
        ]).to.deep.equal([f.wallets[2].address]);
        expect([
            ...f.entry().sourcesToSignatures.get(f.wallets[1].address)!
        ]).to.have.members([
            ...reversed.sourcesToSignatures.get(f.wallets[1].address)!
        ]);
        expect([
            ...f.entry().sourcesToSignatures.get(f.wallets[2].address)!
        ]).to.have.members([
            ...reversed.sourcesToSignatures.get(f.wallets[2].address)!
        ]);
    });
    it("fork cleanup removes only queued entries on the selected fork", () => {
        const first = new QueueAdmissionFixture();
        const other = new QueueAdmissionFixture(
            3,
            0,
            ethers.hexlify(ethers.randomBytes(32))
        );
        first.offer(1);
        first.queue.queueBlock(other.copy(), {
            origin: BlockOrigin.NETWORK,
            senderAddress: other.wallets[1].address
        });
        expect(first.queue.clearFork(first.block.forkId)).to.have.members([
            first.block.hash
        ]);
        expect(first.queue.getQueuedEntry(first.block.hash)).to.equal(
            undefined
        );
        expect(
            first.queue.tryDequeueAt(first.block.forkId, first.block.height)
        ).to.deep.equal([]);
        expect(
            first.queue.getQueuedEntry(other.block.hash)?.block.hash
        ).to.equal(other.block.hash);
    });

    it("restore preserves the earliest first seen time when concurrent copies arrive", () => {
        const f = new QueueAdmissionFixture();
        f.offer(1);
        const processing = f.take();
        processing.firstSeenAt -= 1;
        f.offer(2);
        f.queue.restoreEntry(processing);
        expect(f.entry().firstSeenAt).to.equal(processing.firstSeenAt);
        expect([...f.entry().sourcesToSignatures.keys()]).to.have.members([
            f.wallets[1].address,
            f.wallets[2].address
        ]);
    });
});
