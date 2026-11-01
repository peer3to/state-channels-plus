import { StorageDiffClient } from "../../fixtures/node/StorageDiffClient";
import {
    deploySlotWriter,
    dumpedAccount,
    slotKey,
    nonZero,
    storageWord,
    writeSlot
} from "../../fixtures/node/StorageDiffContracts";
import { withStorageDiffUpstream } from "../../fixtures/node/StorageDiffSession";
import { expect } from "chai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("StorageDiffService persisted cache", function () {
    it("resumes a complete contract from disk without reading its history again", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(
                async ({ signer, start, backfills }) => {
                    const writer = await deploySlotWriter(signer);
                    await writeSlot(signer, writer, 1, 5n);
                    const first = await start({ cacheDir });
                    const client = await StorageDiffClient.connect(first.url);
                    const subscription = await client.subscribe([writer]);
                    await client.nextSnapshot(subscription);
                    client.close();
                    await first.close();

                    const second = await start({ cacheDir });
                    const again = await StorageDiffClient.connect(second.url);
                    const resumed = await again.subscribe([writer]);
                    const snapshot = await again.nextSnapshot(resumed);
                    again.close();

                    expect(snapshot.accounts[writer].storage).to.deep.equal({
                        [slotKey(1)]: storageWord(5n)
                    });
                    // Mutation: not restoring the saved cache -> the second service backfills.
                    expect(backfills).to.have.length(1);
                }
            );
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });

    it("rolls the saved cache back when the saved head is no longer on the chain, then catches up", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(
                async ({ provider, signer, start, backfills }) => {
                    const writer = await deploySlotWriter(signer);
                    await writeSlot(signer, writer, 1, 5n);
                    const checkpoint = await provider.send("evm_snapshot", []);
                    const first = await start({ cacheDir });
                    const client = await StorageDiffClient.connect(first.url);
                    const subscription = await client.subscribe([writer]);
                    await client.nextSnapshot(subscription);
                    const orphan = await writeSlot(signer, writer, 1, 6n);
                    await client.recordAt(subscription, orphan.blockNumber);
                    client.close();
                    await first.close();

                    await provider.send("evm_revert", [checkpoint]);
                    await writeSlot(signer, writer, 2, 7n);
                    const second = await start({ cacheDir });
                    const again = await StorageDiffClient.connect(second.url);
                    const resumed = await again.subscribe([writer]);
                    const snapshot = await again.nextSnapshot(resumed);
                    again.close();

                    expect(
                        nonZero(snapshot.accounts[writer].storage)
                    ).to.deep.equal(
                        nonZero((await dumpedAccount(provider, writer)).storage)
                    );
                    expect(
                        nonZero(snapshot.accounts[writer].storage)
                    ).to.deep.equal({
                        [slotKey(1)]: storageWord(5n),
                        [slotKey(2)]: storageWord(7n)
                    });
                    // only the first service's backfill
                    expect(backfills).to.have.length(1);
                }
            );
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });

    it("applies the blocks mined while the service was down", async function () {
        const cacheDir = mkdtempSync(path.join(tmpdir(), "storage-diff-"));
        try {
            await withStorageDiffUpstream(
                async ({ provider, signer, start, backfills }) => {
                    const writer = await deploySlotWriter(signer);
                    await writeSlot(signer, writer, 1, 5n);
                    const first = await start({ cacheDir });
                    const client = await StorageDiffClient.connect(first.url);
                    await client.nextSnapshot(await client.subscribe([writer]));
                    client.close();
                    await first.close();
                    await writeSlot(signer, writer, 1, 6n);
                    for (let i = 0; i < 4; i++)
                        await provider.send("evm_mine", []);
                    await writeSlot(signer, writer, 3, 8n);

                    const second = await start({ cacheDir, retention: 2 });
                    const again = await StorageDiffClient.connect(second.url);
                    const snapshot = await again.nextSnapshot(
                        await again.subscribe([writer])
                    );
                    again.close();

                    expect(
                        nonZero(snapshot.accounts[writer].storage)
                    ).to.deep.equal({
                        [slotKey(1)]: storageWord(6n),
                        [slotKey(3)]: storageWord(8n)
                    });
                    expect(backfills).to.have.length(1);
                }
            );
        } finally {
            rmSync(cacheDir, { recursive: true, force: true });
        }
    });
});
