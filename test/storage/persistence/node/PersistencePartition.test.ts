import { expect } from "chai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    openPersistencePartition,
    type PersistenceDatabaseHandle
} from "@/storage/persistence";
import Storage from "@/storage";
import * as factory from "../../../factory";

describe("Node persistence partition", function () {
    let root: string;
    const handles: PersistenceDatabaseHandle[] = [];

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

    it("recovers the channel signer instead of a new candidate", async () => {
        const identity = {
            chainId: "31337",
            stateChannelManagerAddress: String(factory.randomAddress()),
            stateMachineAddress: String(factory.randomAddress()),
            channelId: factory.hash()
        };
        const originalSigner = String(factory.hexString(32));
        const first = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret: originalSigner,
            existingPartition: "allow"
        });
        handles.push(first.databaseHandle);
        await first.databaseHandle.close();
        handles.splice(0);

        const second = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret: String(factory.hexString(32)),
            existingPartition: "allow"
        });
        handles.push(second.databaseHandle);

        expect(second.signerSecret).to.equal(originalSigner);
    });

    it("rejects a second live writer for one channel partition", async () => {
        const identity = {
            chainId: "31337",
            stateChannelManagerAddress: String(factory.randomAddress()),
            stateMachineAddress: String(factory.randomAddress()),
            channelId: factory.hash()
        };
        const first = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret: String(factory.hexString(32)),
            existingPartition: "allow"
        });
        handles.push(first.databaseHandle);

        let error: Error | undefined;
        try {
            await openPersistencePartition({
                identity,
                persistence: { location: root },
                signerSecret: String(factory.hexString(32)),
                existingPartition: "allow"
            });
        } catch (caught) {
            error = caught as Error;
        }
        expect(error).to.be.instanceOf(Error);
    });

    it("rejects an unsupported schema without replacing the partition", async () => {
        const identity = {
            chainId: "31337",
            stateChannelManagerAddress: String(factory.randomAddress()),
            stateMachineAddress: String(factory.randomAddress()),
            channelId: factory.hash()
        };
        const signerSecret = String(factory.hexString(32));
        const first = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret,
            existingPartition: "allow"
        });
        await first.databaseHandle.database.put("metadata!schemaVersion", "99");
        await first.databaseHandle.close();

        let error: Error | undefined;
        try {
            await openPersistencePartition({
                identity,
                persistence: { location: root },
                signerSecret: String(factory.hexString(32)),
                existingPartition: "allow"
            });
        } catch (caught) {
            error = caught as Error;
        }
        expect(error?.message).to.include(
            "Unsupported persistence schema version 99"
        );
    });

    it("resumes a chunked schema migration and removes the old prefix", async () => {
        const identity = {
            chainId: "31337",
            stateChannelManagerAddress: String(factory.randomAddress()),
            stateMachineAddress: String(factory.randomAddress()),
            channelId: factory.hash()
        };
        const signerSecret = String(factory.hexString(32));
        const first = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret,
            existingPartition: "allow"
        });
        await first.databaseHandle.database.batch([
            {
                type: "put",
                key: "metadata!schemaVersion",
                value: "0"
            },
            {
                type: "put",
                key: "records!v0!runtimeMetadata!active",
                value: "first"
            },
            {
                type: "put",
                key: "records!v0!runtimeMetadata!head",
                value: "second"
            },
            {
                type: "put",
                key: "records!v1!runtimeMetadata!active",
                value: "first"
            },
            {
                type: "put",
                key: "metadata!migrationProgress",
                value: JSON.stringify({
                    fromVersion: 0,
                    toVersion: 1,
                    phase: "copy",
                    cursor: "records!v0!runtimeMetadata!active"
                })
            }
        ]);
        await first.databaseHandle.close();

        const second = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret: String(factory.hexString(32)),
            existingPartition: "allow",
            migrations: [
                {
                    fromVersion: 0,
                    toVersion: 1,
                    transformRecord: (record) => record
                }
            ]
        });
        handles.push(second.databaseHandle);

        expect(
            await second.databaseHandle.database.get(
                "records!v1!runtimeMetadata!head"
            )
        ).to.equal("second");
        expect(
            await getOptional(
                second.databaseHandle.database,
                "records!v0!runtimeMetadata!active"
            )
        ).to.equal(undefined);
        expect(
            await getOptional(
                second.databaseHandle.database,
                "metadata!migrationProgress"
            )
        ).to.equal(undefined);
    });

    it("resets a partition only when explicitly requested", async () => {
        const identity = {
            chainId: "31337",
            stateChannelManagerAddress: String(factory.randomAddress()),
            stateMachineAddress: String(factory.randomAddress()),
            channelId: factory.hash()
        };
        const originalSigner = String(factory.hexString(32));
        const replacementSigner = String(factory.hexString(32));
        const first = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret: originalSigner,
            existingPartition: "allow"
        });
        await first.databaseHandle.database.put("test!stale", "value");
        await first.databaseHandle.close();

        const reset = await openPersistencePartition({
            identity,
            persistence: { location: root, reset: true },
            signerSecret: replacementSigner,
            existingPartition: "allow"
        });
        handles.push(reset.databaseHandle);

        expect(reset.signerSecret).to.equal(replacementSigner);
        expect(
            await getOptional(reset.databaseHandle.database, "test!stale")
        ).to.equal(undefined);
    });

    it("flushes many cache mutations to one ClassicLevel partition", async () => {
        const identity = {
            chainId: "31337",
            stateChannelManagerAddress: String(factory.randomAddress()),
            stateMachineAddress: String(factory.randomAddress()),
            channelId: factory.hash()
        };
        const firstPartition = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret: String(factory.hexString(32)),
            existingPartition: "allow"
        });
        const first = new Storage(undefined, {
            flushIntervalMs: 60_000
        });
        await first.bind(firstPartition.databaseHandle);
        const forkId = factory.transactionHeader().forkId;
        const blocks = Array.from({ length: 20 }, (_, height) =>
            factory.block({
                transaction: {
                    header: factory.transactionHeader({
                        forkId,
                        transactionCnt: height
                    }),
                    body: factory.transactionBody()
                }
            })
        );

        for (const block of blocks) first.blocks.storeBlock(block);
        await first.flush();
        await first.close();

        const secondPartition = await openPersistencePartition({
            identity,
            persistence: { location: root },
            signerSecret: String(factory.hexString(32)),
            existingPartition: "allow"
        });
        const second = new Storage();
        await second.bind(secondPartition.databaseHandle);
        for (const block of blocks) {
            expect(second.blocks.getBlock(block.hash)?.hash).to.equal(
                block.hash
            );
        }
        await second.close();
    });
});

async function getOptional(
    database: PersistenceDatabaseHandle["database"],
    key: string
): Promise<string | undefined> {
    try {
        return await database.get(key);
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "LEVEL_NOT_FOUND"
        ) {
            return undefined;
        }
        throw error;
    }
}
