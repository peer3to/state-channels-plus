// @spec-test-coverage-ignore: developer diagnostics tooling; not protocol behavior, no specification or implementation IDs apply
import { MessageChannel } from "node:worker_threads";
import { ethers } from "ethers";

import { LogFlushBus } from "@/utils/logging/LogFlushBus";
import type {
    LogControlMessage,
    LogControlPort,
    LogPortHandle
} from "@/utils/logging/logControl";
import type { LogThreadName } from "@/utils/logging/Logger";
import type { NodeLogUploader } from "@/utils/logging/node/NodeLogUploader";
import type { NodeLogger } from "@/utils/logging/node/NodeLogger";
import type { LogStore } from "@/utils/logging/logStore";

import { createUploaderFixture } from "./LogUploader.fixture";

/** one realm's logging state: its own bus, logger, store, uploader */
export type TestRealm = {
    bus: LogFlushBus;
    logger: NodeLogger;
    logStore: LogStore;
    logUploader: NodeLogUploader;
    threadName: LogThreadName;
};

export type RealmConnection = {
    /** everything the parent sent down, in order */
    toChild: LogControlMessage[];
    /** everything the child sent up, in order */
    toParent: LogControlMessage[];
    removeFromParent: () => void;
    removeFromChild: () => void;
    close: () => void;
};

/** a realm as a thread has it: one bus, one registered root, a real uploader on a
 *  real endpoint. `uploadEndpoint` of "" means uploads are off. */
export function createTestRealm(opts: {
    threadName: LogThreadName;
    uploadEndpoint: string;
    peerAddress?: string;
    channelId?: string;
    maxStoreBytes?: number;
}): TestRealm {
    const { logger, logStore, logUploader } = createUploaderFixture({
        uploadEndpoint: opts.uploadEndpoint,
        jitterMaxMs: 0,
        maxStoreBytes: opts.maxStoreBytes,
        sharedContext: {
            threadName: opts.threadName,
            peerAddress:
                opts.peerAddress ?? ethers.Wallet.createRandom().address,
            ...(opts.channelId ? { channelId: opts.channelId } : {})
        }
    });
    const bus = new LogFlushBus();
    bus.registerLogger(logger);
    return { bus, logger, logStore, logUploader, threadName: opts.threadName };
}

/** fixture realms always register, so a port always attaches */
function attachPort(logger: NodeLogger, port: LogControlPort): LogPortHandle {
    const handle = logger.addLogPort(port);
    if (!handle) throw new Error("fixture logger is not on a flush bus");
    return handle;
}

/** join two realms over a real MessageChannel pair, the shape the runtime and
 *  executor ports have, recording what crosses each way */
export function connectRealms(
    parent: TestRealm,
    child: TestRealm
): RealmConnection {
    const channel = new MessageChannel();
    const toChild: LogControlMessage[] = [];
    const toParent: LogControlMessage[] = [];

    const portToChild: LogControlPort = {
        post: (message) => {
            toChild.push(message);
            channel.port1.postMessage(message);
        },
        remoteRealm: "child"
    };
    const portToParent: LogControlPort = {
        post: (message) => {
            toParent.push(message);
            channel.port2.postMessage(message);
        },
        remoteRealm: "parent"
    };

    // through the loggers, like the real transports -> ports land on the bus this
    // fixture built
    let parentHandle: LogPortHandle | undefined;
    let childHandle: LogPortHandle | undefined;

    // port1 is the parent's end -> what it posts arrives at port2
    channel.port2.on("message", (message) =>
        childHandle?.receive(message as LogControlMessage)
    );
    channel.port1.on("message", (message) =>
        parentHandle?.receive(message as LogControlMessage)
    );

    parentHandle = attachPort(parent.logger, portToChild);
    childHandle = attachPort(child.logger, portToParent);

    return {
        toChild,
        toParent,
        removeFromParent: parentHandle.remove,
        removeFromChild: childHandle.remove,
        close: () => {
            parentHandle?.remove();
            childHandle?.remove();
            channel.port1.close();
            channel.port2.close();
        }
    };
}

/** a port whose far end never answers - the "thread died" case. nothing listens
 *  on port2, so no ack comes back. */
export function addDeadPort(realm: TestRealm): {
    posted: LogControlMessage[];
    remove: () => void;
} {
    const channel = new MessageChannel();
    const posted: LogControlMessage[] = [];
    const deadPort: LogControlPort = {
        post: (message) => {
            posted.push(message);
            channel.port1.postMessage(message);
        },
        remoteRealm: "child"
    };
    const handle = attachPort(realm.logger, deadPort);
    return {
        posted,
        remove: () => {
            handle.remove();
            channel.port1.close();
            channel.port2.close();
        }
    };
}

export function countMessages(
    messages: LogControlMessage[],
    type: LogControlMessage["type"]
): number {
    return messages.filter((message) => message.type === type).length;
}

/** a promise a test resolves by hand, e.g. to hold a response open */
export function deferred(): {
    promise: Promise<void>;
    resolve: () => void;
} {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
