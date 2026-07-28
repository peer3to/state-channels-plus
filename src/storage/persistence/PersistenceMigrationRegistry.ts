import type {
    PersistenceBatchOperation,
    PersistenceDatabase
} from "./PersistenceDatabase";

const MIGRATION_PROGRESS_KEY = "metadata!migrationProgress";
const SCHEMA_VERSION_KEY = "metadata!schemaVersion";
const DEFAULT_CHUNK_SIZE = 256;

type MigrationPhase = "copy" | "cleanup";

interface MigrationProgress {
    fromVersion: number;
    toVersion: number;
    phase: MigrationPhase;
    cursor?: string;
}

export interface PersistenceMigrationRecord {
    key: string;
    value: string;
}

export interface PersistenceMigration {
    fromVersion: number;
    toVersion: number;
    transformRecord(
        record: PersistenceMigrationRecord
    ): PersistenceMigrationRecord | undefined;
}

export class PersistenceMigrationRegistry {
    private readonly migrations = new Map<number, PersistenceMigration>();
    private readonly chunkSize: number;

    constructor(
        migrations: readonly PersistenceMigration[] = [],
        chunkSize = DEFAULT_CHUNK_SIZE
    ) {
        if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
            throw new Error(
                "Persistence migration chunk size must be positive"
            );
        }
        this.chunkSize = chunkSize;
        for (const migration of migrations) {
            if (migration.toVersion !== migration.fromVersion + 1) {
                throw new Error(
                    `Persistence migration ${migration.fromVersion} must target the next schema version`
                );
            }
            if (this.migrations.has(migration.fromVersion)) {
                throw new Error(
                    `Duplicate persistence migration from schema version ${migration.fromVersion}`
                );
            }
            this.migrations.set(migration.fromVersion, migration);
        }
    }

    public async migrate(
        database: PersistenceDatabase,
        storedVersion: number,
        targetVersion: number,
        partitionNamespace: string
    ): Promise<void> {
        let currentVersion = await this.resumePendingMigration(
            database,
            storedVersion,
            partitionNamespace
        );

        while (currentVersion < targetVersion) {
            const migration = this.migrations.get(currentVersion);
            if (!migration) {
                throw this.unsupportedVersion(
                    currentVersion,
                    partitionNamespace
                );
            }
            await this.runMigration(database, migration);
            currentVersion = migration.toVersion;
        }

        if (currentVersion !== targetVersion) {
            throw this.unsupportedVersion(currentVersion, partitionNamespace);
        }
    }

    private async resumePendingMigration(
        database: PersistenceDatabase,
        storedVersion: number,
        partitionNamespace: string
    ): Promise<number> {
        const encodedProgress = await getOptional(
            database,
            MIGRATION_PROGRESS_KEY
        );
        if (!encodedProgress) return storedVersion;

        const progress = decodeProgress(encodedProgress);
        const migration = this.migrations.get(progress.fromVersion);
        if (
            !migration ||
            migration.toVersion !== progress.toVersion ||
            (progress.phase === "copy" &&
                storedVersion !== progress.fromVersion) ||
            (progress.phase === "cleanup" &&
                storedVersion !== progress.toVersion)
        ) {
            throw new Error(
                `Invalid persistence migration progress for partition ${partitionNamespace}`
            );
        }

        await this.runMigration(database, migration, progress);
        return migration.toVersion;
    }

    private async runMigration(
        database: PersistenceDatabase,
        migration: PersistenceMigration,
        initialProgress: MigrationProgress = {
            fromVersion: migration.fromVersion,
            toVersion: migration.toVersion,
            phase: "copy"
        }
    ): Promise<void> {
        let progress = initialProgress;
        while (progress.phase === "copy") {
            progress = await this.copyChunk(database, migration, progress);
        }
        await this.cleanup(database, migration, progress);
    }

    private async copyChunk(
        database: PersistenceDatabase,
        migration: PersistenceMigration,
        progress: MigrationProgress
    ): Promise<MigrationProgress> {
        const sourcePrefix = recordPrefix(migration.fromVersion);
        const targetPrefix = recordPrefix(migration.toVersion);
        const records = await readChunk(
            database,
            sourcePrefix,
            progress.cursor,
            this.chunkSize
        );
        const operations: PersistenceBatchOperation[] = [];

        for (const record of records) {
            const transformed = migration.transformRecord({
                key: record.key.slice(sourcePrefix.length),
                value: record.value
            });
            if (transformed) {
                operations.push({
                    type: "put",
                    key: `${targetPrefix}${transformed.key}`,
                    value: transformed.value
                });
            }
        }

        const isFinalChunk = records.length < this.chunkSize;
        const nextProgress: MigrationProgress = isFinalChunk
            ? {
                  fromVersion: migration.fromVersion,
                  toVersion: migration.toVersion,
                  phase: "cleanup"
              }
            : {
                  ...progress,
                  cursor: records.at(-1)!.key
              };

        if (isFinalChunk) {
            operations.push({
                type: "put",
                key: SCHEMA_VERSION_KEY,
                value: String(migration.toVersion)
            });
        }
        operations.push({
            type: "put",
            key: MIGRATION_PROGRESS_KEY,
            value: JSON.stringify(nextProgress)
        });
        await database.batch(operations);
        return nextProgress;
    }

    private async cleanup(
        database: PersistenceDatabase,
        migration: PersistenceMigration,
        initialProgress: MigrationProgress
    ): Promise<void> {
        let progress = initialProgress;
        const sourcePrefix = recordPrefix(migration.fromVersion);

        while (true) {
            const records = await readChunk(
                database,
                sourcePrefix,
                progress.cursor,
                this.chunkSize
            );
            const isFinalChunk = records.length < this.chunkSize;
            const operations: PersistenceBatchOperation[] = records.map(
                (record) => ({
                    type: "del",
                    key: record.key
                })
            );

            if (isFinalChunk) {
                operations.push({
                    type: "del",
                    key: MIGRATION_PROGRESS_KEY
                });
            } else {
                progress = {
                    ...progress,
                    cursor: records.at(-1)!.key
                };
                operations.push({
                    type: "put",
                    key: MIGRATION_PROGRESS_KEY,
                    value: JSON.stringify(progress)
                });
            }
            await database.batch(operations);
            if (isFinalChunk) return;
        }
    }

    private unsupportedVersion(
        version: number,
        partitionNamespace: string
    ): Error {
        return new Error(
            `Unsupported persistence schema version ${version} for partition ${partitionNamespace}`
        );
    }
}

async function readChunk(
    database: PersistenceDatabase,
    prefix: string,
    cursor: string | undefined,
    limit: number
): Promise<PersistenceMigrationRecord[]> {
    const records: PersistenceMigrationRecord[] = [];
    for await (const [key, value] of database.iterator({
        ...(cursor ? { gt: cursor } : { gte: prefix }),
        lt: `${prefix}\uffff`,
        limit
    })) {
        records.push({ key, value });
    }
    return records;
}

function recordPrefix(version: number): string {
    return `records!v${version}!`;
}

function decodeProgress(encoded: string): MigrationProgress {
    const progress = JSON.parse(encoded) as Partial<MigrationProgress>;
    if (
        !Number.isInteger(progress.fromVersion) ||
        !Number.isInteger(progress.toVersion) ||
        (progress.phase !== "copy" && progress.phase !== "cleanup") ||
        (progress.cursor !== undefined && typeof progress.cursor !== "string")
    ) {
        throw new Error("Invalid persistence migration progress metadata");
    }
    return progress as MigrationProgress;
}

async function getOptional(
    database: PersistenceDatabase,
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
