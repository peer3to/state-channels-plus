import { ethers } from "ethers";

import { createPersistenceDatabase } from "@platform/persistenceDatabase";

import type {
    PersistenceDatabase,
    PersistenceDatabaseHandle
} from "./PersistenceDatabase";
import {
    PersistenceMigrationRegistry,
    type PersistenceMigration
} from "./PersistenceMigrationRegistry";

const CURRENT_SCHEMA_VERSION = 1;
const IDENTITY_KEY = "metadata!identity";
const SCHEMA_VERSION_KEY = "metadata!schemaVersion";
const SIGNER_SECRET_KEY = "metadata!signerSecret";

export interface PersistenceOptions {
    /**
     * Backend root/name prefix. One persistent runtime owns each channel
     * partition. Same-machine multi-peer setups must use distinct locations or
     * disable persistence.
     */
    location?: string;
    flushIntervalMs?: number;
    maxBatchOperations?: number;
    reset?: boolean;
}

export interface PersistencePartitionIdentity {
    chainId: string;
    stateChannelManagerAddress: string;
    stateMachineAddress: string;
    channelId: string;
}

export interface OpenPersistencePartitionOptions {
    identity: PersistencePartitionIdentity;
    persistence: PersistenceOptions;
    signerSecret: string;
    existingPartition: "allow" | "reject";
    migrations?: readonly PersistenceMigration[];
}

export interface OpenPersistencePartitionResult {
    databaseHandle: PersistenceDatabaseHandle;
    signerSecret: string;
    namespace: string;
}

export function getPersistenceNamespace(
    identity: PersistencePartitionIdentity
): string {
    const normalized = normalizeIdentity(identity);
    return ethers.keccak256(
        ethers.toUtf8Bytes(
            [
                normalized.chainId,
                normalized.stateChannelManagerAddress,
                normalized.stateMachineAddress,
                normalized.channelId
            ].join(":")
        )
    );
}

export async function openPersistencePartition(
    options: OpenPersistencePartitionOptions
): Promise<OpenPersistencePartitionResult> {
    const identity = normalizeIdentity(options.identity);
    const namespace = getPersistenceNamespace(identity);
    let databaseHandle = await createPersistenceDatabase({
        location: options.persistence.location,
        namespace
    });

    try {
        await databaseHandle.database.open();
        if (options.persistence.reset) {
            await databaseHandle.destroy();
            databaseHandle = await createPersistenceDatabase({
                location: options.persistence.location,
                namespace
            });
            await databaseHandle.database.open();
        }
        const storedIdentity = await getOptional(
            databaseHandle.database,
            IDENTITY_KEY
        );
        const storedVersion = await getOptional(
            databaseHandle.database,
            SCHEMA_VERSION_KEY
        );
        const storedSignerSecret = await getOptional(
            databaseHandle.database,
            SIGNER_SECRET_KEY
        );
        const exists =
            storedIdentity !== undefined ||
            storedVersion !== undefined ||
            storedSignerSecret !== undefined;

        if (exists && options.existingPartition === "reject") {
            throw new Error(
                `Persistence partition already exists: ${namespace}`
            );
        }

        if (!exists) {
            // TODO(persistence): encrypt signer secrets with a caller-supplied
            // key before writing them to backend metadata.
            await databaseHandle.database.batch([
                {
                    type: "put",
                    key: IDENTITY_KEY,
                    value: JSON.stringify(identity)
                },
                {
                    type: "put",
                    key: SCHEMA_VERSION_KEY,
                    value: String(CURRENT_SCHEMA_VERSION)
                },
                {
                    type: "put",
                    key: SIGNER_SECRET_KEY,
                    value: options.signerSecret
                }
            ]);
            return {
                databaseHandle,
                signerSecret: options.signerSecret,
                namespace
            };
        }

        if (
            storedIdentity === undefined ||
            storedVersion === undefined ||
            storedSignerSecret === undefined
        ) {
            throw new Error(
                `Incomplete persistence metadata for partition ${namespace}`
            );
        }
        if (storedIdentity !== JSON.stringify(identity)) {
            throw new Error(
                `Persistence identity mismatch for partition ${namespace}`
            );
        }

        const schemaVersion = Number(storedVersion);
        if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
            await new PersistenceMigrationRegistry(options.migrations).migrate(
                databaseHandle.database,
                schemaVersion,
                CURRENT_SCHEMA_VERSION,
                namespace
            );
        }

        return {
            databaseHandle,
            signerSecret: storedSignerSecret,
            namespace
        };
    } catch (error) {
        await databaseHandle.close();
        throw error;
    }
}

function normalizeIdentity(
    identity: PersistencePartitionIdentity
): PersistencePartitionIdentity {
    return {
        chainId: BigInt(identity.chainId).toString(),
        stateChannelManagerAddress: ethers
            .getAddress(identity.stateChannelManagerAddress)
            .toLowerCase(),
        stateMachineAddress: ethers
            .getAddress(identity.stateMachineAddress)
            .toLowerCase(),
        channelId: ethers.hexlify(identity.channelId).toLowerCase()
    };
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
