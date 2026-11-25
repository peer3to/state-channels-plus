// @spec-test-coverage-ignore: browser page script for the persistence restart gate; evidence is mapped from run-persistence-restart.mjs
import { openPersistencePartition } from "../../src/storage/persistence/PersistencePartition.ts";
import { Storage } from "../../src/storage/Storage.ts";

const identity = {
    chainId: "31337",
    stateChannelManagerAddress: "0x1000000000000000000000000000000000000001",
    stateMachineAddress: "0x2000000000000000000000000000000000000002",
    channelId:
        "0x3000000000000000000000000000000000000000000000000000000000000003"
};

function signer(digit) {
    return `0x${String(digit).repeat(64)}`;
}

function deleteDatabase(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () =>
            reject(request.error ?? new Error(`Failed to delete ${name}`));
        request.onblocked = () =>
            reject(new Error(`Deletion blocked for ${name}`));
    });
}

function openPartition(location, signerSecret) {
    return openPersistencePartition({
        identity,
        persistence: { location },
        signerSecret
    });
}

globalThis.runPersistenceRestartBrowserSmoke = async () => {
    const location = `peer3-persistence-test-${crypto.randomUUID()}-`;
    let openHandle;
    let databaseName;

    try {
        const first = await openPartition(location, signer(4));
        openHandle = first.databaseHandle;
        databaseName = `${location}${first.namespace}`;

        // one live writer per partition: the Web Lock refuses a second
        let leaseRejected = false;
        try {
            await openPartition(location, signer(5));
        } catch {
            leaseRejected = true;
        }
        await openHandle.close();

        const second = await openPartition(location, signer(6));
        openHandle = second.databaseHandle;
        const firstStorage = new Storage(undefined, undefined, {
            flushIntervalMs: 60_000
        });
        await firstStorage.open(openHandle, () => undefined);
        for (let height = 1; height <= 10; height++) {
            firstStorage.forceJoin.startJoin(height, 100);
        }
        await firstStorage.flush();
        await firstStorage.close();

        const third = await openPartition(location, signer(7));
        openHandle = third.databaseHandle;
        const secondStorage = new Storage(undefined, undefined, {
            flushIntervalMs: 20
        });
        await secondStorage.open(openHandle, () => undefined);
        const explicitFlushRecovered =
            secondStorage.forceJoin.getJoin()?.submissionHeight === 10;
        secondStorage.forceExit.setForceExit(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const timedFlushPersisted =
            (await openHandle.database.get("records!v1!forceExit!value")) !==
            undefined;
        await secondStorage.close();

        const fourth = await openPartition(location, signer(8));
        openHandle = fourth.databaseHandle;
        const recoveredStorage = new Storage();
        await recoveredStorage.open(openHandle, () => undefined);
        const forceExitRecovered = recoveredStorage.forceExit.getForceExit();
        await recoveredStorage.close();

        return {
            leaseRejected,
            signerRecovered: third.signerSecret === signer(4),
            explicitFlushRecovered,
            timedFlushPersisted,
            forceExitRecovered
        };
    } finally {
        await openHandle?.close();
        if (databaseName) await deleteDatabase(databaseName);
    }
};

globalThis.persistenceRestartReady = true;
