import * as factory from "../../../factory";
import Storage from "@/storage";
import {
    getPersistenceNamespace,
    openPersistencePartition,
    type PersistenceDatabaseHandle,
    type PersistencePartitionIdentity
} from "@/storage/persistence";
import type { ForkId } from "@/types/types";
import { expect } from "chai";
import { ClassicLevel } from "classic-level";
import { ethers } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const noFailure = () => undefined;

function identity(): PersistencePartitionIdentity {
    return {
        chainId: "31337",
        stateChannelManagerAddress: String(factory.randomAddress()),
        stateMachineAddress: String(factory.randomAddress()),
        channelId: factory.hash()
    };
}

describe("Node persistence partition", function () {
    let root: string;
    const handles: PersistenceDatabaseHandle[] = [];

    const open = async (
        partitionIdentity: PersistencePartitionIdentity,
        signerSecret = String(factory.hexString(32)),
        reset?: boolean
    ) => {
        const partition = await openPersistencePartition({
            identity: partitionIdentity,
            persistence: { location: root, reset },
            signerSecret
        });
        handles.push(partition.databaseHandle);
        return partition;
    };

    /** writes `records` straight to a closed partition */
    const putRaw = async (
        partitionIdentity: PersistencePartitionIdentity,
        records: Record<string, string | undefined>
    ) => {
        const database = new ClassicLevel<string, string>(
            path.join(root, getPersistenceNamespace(partitionIdentity)),
            { keyEncoding: "utf8", valueEncoding: "utf8" }
        );
        await database.open();
        for (const [key, value] of Object.entries(records)) {
            if (value === undefined) await database.del(key);
            else await database.put(key, value);
        }
        await database.close();
    };

    const openError = async (
        partitionIdentity: PersistencePartitionIdentity
    ): Promise<Error> => {
        try {
            await open(partitionIdentity);
        } catch (error) {
            return error as Error;
        }
        throw new Error("expected the partition to be refused");
    };

    beforeEach(async () => {
        root = await mkdtemp(
            path.join(tmpdir(), "state-channels-plus-persistence-")
        );
    });

    afterEach(async () => {
        for (const handle of handles.splice(0)) {
            await handle.close();
        }
        await rm(root, { recursive: true, force: true });
    });

    it("records a new partition's identity, encoding version and signer secret together", async () => {
        const channel = identity();
        const signerSecret = String(factory.hexString(32));
        const { databaseHandle } = await open(channel, signerSecret);

        const database = databaseHandle.database;
        expect(await database.get("metadata!signerSecret")).to.equal(
            signerSecret
        );
        expect(await database.get("metadata!schemaVersion")).to.equal("1");
        expect(
            JSON.parse((await database.get("metadata!identity"))!).channelId
        ).to.equal(channel.channelId.toLowerCase());
    });

    it("writes a new partition's records in one synced batch", async () => {
        // record-only: the real classic-level batch still runs
        const prototype = ClassicLevel.prototype as unknown as {
            _batch: (...args: unknown[]) => unknown;
        };
        const batch = prototype._batch;
        const syncs: unknown[] = [];
        prototype._batch = function (this: unknown, ...args: unknown[]) {
            syncs.push((args[1] as { sync?: boolean }).sync);
            return batch.apply(this, args);
        };
        try {
            await open(identity());
        } finally {
            prototype._batch = batch;
        }

        expect(syncs).to.deep.equal([true]);
    });

    it("maps checksummed and lowercase addresses, and decimal and hex chain ids, to one partition", async () => {
        const spelled = identity();
        const respelled: PersistencePartitionIdentity = {
            chainId: "0x7a69",
            stateChannelManagerAddress:
                spelled.stateChannelManagerAddress.toLowerCase(),
            stateMachineAddress: ethers.getAddress(spelled.stateMachineAddress),
            channelId: spelled.channelId.toUpperCase().replace("0X", "0x")
        };
        expect(getPersistenceNamespace(respelled)).to.equal(
            getPersistenceNamespace(spelled)
        );

        const secret = String(factory.hexString(32));
        const first = await open(spelled, secret);
        await first.databaseHandle.close();
        const resumed = await open(respelled, String(factory.hexString(32)));

        expect(resumed.signerSecret).to.equal(secret);
    });

    it("resumes an existing partition with its stored signer secret", async () => {
        const channel = identity();
        const signerSecret = String(factory.hexString(32));
        await (await open(channel, signerSecret)).databaseHandle.close();

        const resumed = await open(channel, String(factory.hexString(32)));

        expect(resumed.signerSecret).to.equal(signerSecret);
    });

    it("refuses a second open of a held partition", async () => {
        const channel = identity();
        await open(channel);

        const error = await openError(channel);

        expect(error).to.be.instanceOf(Error);
    });

    it("keeps one channel's records apart from another channel's", async () => {
        const first = identity();
        const second = { ...first, channelId: factory.hash() };
        const firstStorage = new Storage();
        await firstStorage.open((await open(first)).databaseHandle, noFailure);
        firstStorage.forceExit.setForceExit(true);
        await firstStorage.close();

        const secondStorage = new Storage();
        await secondStorage.open(
            (await open(second)).databaseHandle,
            noFailure
        );

        expect(getPersistenceNamespace(first)).to.not.equal(
            getPersistenceNamespace(second)
        );
        expect(secondStorage.forceExit.getForceExit()).to.equal(false);
        await secondStorage.close();
    });

    it("refuses a newer encoding version, naming both versions", async () => {
        const channel = identity();
        await (await open(channel)).databaseHandle.close();
        await putRaw(channel, { "metadata!schemaVersion": "2" });

        const error = await openError(channel);

        expect(error.message).to.include("schema version 2");
        expect(error.message).to.include("reads version 1");
    });

    it("refuses an older encoding version, naming both versions", async () => {
        const channel = identity();
        await (await open(channel)).databaseHandle.close();
        await putRaw(channel, { "metadata!schemaVersion": "0" });

        const error = await openError(channel);

        expect(error.message).to.include("schema version 0");
        expect(error.message).to.include("reads version 1");
    });

    it("refuses a partition missing its signer-secret record", async () => {
        const channel = identity();
        await (await open(channel)).databaseHandle.close();
        await putRaw(channel, { "metadata!signerSecret": undefined });

        const error = await openError(channel);

        expect(error.message).to.include("Incomplete persistence metadata");
    });

    it("refuses a partition whose identity names another channel", async () => {
        const channel = identity();
        await (await open(channel)).databaseHandle.close();
        await putRaw(channel, {
            "metadata!identity": JSON.stringify({
                ...channel,
                channelId: factory.hash()
            })
        });

        const error = await openError(channel);

        expect(error.message).to.include("identity mismatch");
    });

    it("releases the partition when the bind is refused for bad disk state", async () => {
        const channel = identity();
        await (await open(channel)).databaseHandle.close();
        await putRaw(channel, { "records!v1!blocks!broken": "0x00" });

        const refused = new Storage();
        let error: Error | undefined;
        try {
            await refused.open((await open(channel)).databaseHandle, noFailure);
        } catch (caught) {
            error = caught as Error;
        }
        const reopened = await open(channel);

        expect(error?.message).to.include("blocks record broken");
        expect(error?.message).to.include(reopened.databaseHandle.location);
        expect(reopened.namespace).to.equal(getPersistenceNamespace(channel));
    });

    it("starts a fresh partition with the new signer secret only on an explicit reset", async () => {
        const channel = identity();
        const first = await open(channel, String(factory.hexString(32)));
        const storage = new Storage();
        await storage.open(first.databaseHandle, noFailure);
        storage.forceExit.setForceExit(true);
        await storage.close();

        const newSecret = String(factory.hexString(32));
        const reset = await open(channel, newSecret, true);
        const fresh = new Storage();
        await fresh.open(reset.databaseHandle, noFailure);

        expect(reset.signerSecret).to.equal(newSecret);
        expect(fresh.forceExit.getForceExit()).to.equal(false);
        await fresh.close();
    });

    it("restores blocks written through classic-level after a reopen", async () => {
        const channel = identity();
        const storage = new Storage();
        await storage.open((await open(channel)).databaseHandle, noFailure);
        const forkId = factory.hash() as ForkId;
        const blocks = [0, 1, 2].map((height) =>
            factory.blockAt(forkId, height)
        );
        for (const block of blocks) storage.blocks.storeBlock(block);
        await storage.flush();
        await storage.close();

        const restored = new Storage();
        await restored.open((await open(channel)).databaseHandle, noFailure);

        expect(restored.blocks.getLatestBlock(forkId)?.hash).to.equal(
            blocks[2].hash
        );
        await restored.close();
    });
});
