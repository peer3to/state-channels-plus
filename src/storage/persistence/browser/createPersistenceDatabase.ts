import { BrowserLevel } from "browser-level";

import type {
    CreatePersistenceDatabaseOptions,
    PersistenceDatabaseHandle
} from "../PersistenceDatabase";

type LockRelease = () => void;

async function acquireLease(name: string): Promise<{
    release: LockRelease;
    completion: Promise<void>;
}> {
    if (!navigator.locks) {
        throw new Error("Browser persistence requires the Web Locks API");
    }

    let settleAcquired!: (acquired: boolean) => void;
    let release!: LockRelease;
    const acquired = new Promise<boolean>((resolve) => {
        settleAcquired = resolve;
    });
    const completion = navigator.locks.request(
        name,
        { ifAvailable: true },
        async (lock) => {
            settleAcquired(lock !== null);
            if (!lock) return;
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        }
    );

    if (!(await acquired)) {
        await completion;
        throw new Error(`Persistence partition is already open: ${name}`);
    }
    return { release, completion };
}

export async function createPersistenceDatabase(
    options: CreatePersistenceDatabaseOptions
): Promise<PersistenceDatabaseHandle> {
    const namePrefix = options.location ?? "peer3-state-channels-plus-";
    const location = `${namePrefix}${options.namespace}`;
    const lease = await acquireLease(
        `${namePrefix}${options.namespace}:writer`
    );
    const database = new BrowserLevel<string, string>(options.namespace, {
        prefix: namePrefix,
        keyEncoding: "utf8",
        valueEncoding: "utf8"
    });

    try {
        await database.open();
    } catch (error) {
        lease.release();
        await lease.completion;
        throw error;
    }

    let closed = false;
    return {
        database,
        location,
        close: async () => {
            if (closed) return;
            closed = true;
            try {
                await database.close();
            } finally {
                lease.release();
                await lease.completion;
            }
        },
        destroy: async () => {
            if (!closed) {
                closed = true;
                try {
                    await database.close();
                } finally {
                    lease.release();
                    await lease.completion;
                }
            }
            await BrowserLevel.destroy(options.namespace, namePrefix);
        }
    };
}
