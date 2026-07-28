import type { AbstractBatchOperation, AbstractLevel } from "abstract-level";

export type PersistenceKey = string;
export type EncodedPersistenceValue = string;

export type PersistenceDatabase = AbstractLevel<
    any,
    PersistenceKey,
    EncodedPersistenceValue
>;

export type PersistenceBatchOperation = AbstractBatchOperation<
    PersistenceDatabase,
    PersistenceKey,
    EncodedPersistenceValue
>;

export interface PersistenceDatabaseHandle {
    readonly database: PersistenceDatabase;
    readonly location: string;
    close(): Promise<void>;
    destroy(): Promise<void>;
}

export interface CreatePersistenceDatabaseOptions {
    location?: string;
    namespace: string;
}

export type CreatePersistenceDatabase = (
    options: CreatePersistenceDatabaseOptions
) => Promise<PersistenceDatabaseHandle>;
