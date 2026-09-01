// @spec-test-coverage-ignore: developer diagnostics tooling; not protocol behavior, no specification or implementation IDs apply
import {
    MessageChannel,
    type MessagePort as NodeMessagePort
} from "node:worker_threads";
import { ethers } from "ethers";

import { LogFlushBus } from "@/utils/logging/LogFlushBus";
import { LogControlService } from "@/utils/logging/rpc/logControl/LogControlService";
import type { LogThreadName } from "@/utils/logging/Logger";
import type { NodeLogUploader } from "@/utils/logging/node/NodeLogUploader";
import type { NodeLogger } from "@/utils/logging/node/NodeLogger";
import type { LogStore } from "@/utils/logging/logStore";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import { WorkerLinks } from "@/rpc/WorkerLinks";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import type { RuntimePort } from "@/transport/RuntimePort";
import { adaptPort } from "@/evm/p2pRuntime/node/P2pRuntimeChannel";

import { applyCrashLogConfig, crashLogUploadOverrides } from "./crashLogConfig";
import { createUploaderFixture, type LogReceiver } from "./LogUploader.fixture";

/** what a realm serves over its links: the log tree only */
class TestRealmRoot {
    readonly logControl: LogControlService;

    constructor(router: PortRpcRouter<TestRealmRoot>, bus: LogFlushBus) {
        this.logControl = new LogControlService(router, router.logger, bus);
    }
}

/** one realm's logging state: its own bus and link registry, its router, its
 *  logger, store and uploader */
export type TestRealm = {
    bus: LogFlushBus;
    links: WorkerLinks;
    router: PortRpcRouter<TestRealmRoot>;
    logger: NodeLogger;
    logStore: LogStore;
    logUploader: NodeLogUploader;
    threadName: LogThreadName;
};

/** a frame as it crossed a link, either way */
export type LinkFrame = Rpc | RpcResponse;

export type RealmConnection = {
    /** everything the parent sent down, in order */
    toChild: LinkFrame[];
    /** everything the child sent up, in order */
    toParent: LinkFrame[];
    removeFromParent: () => void;
    removeFromChild: () => void;
    close: () => void;
};

/** a realm as a thread has it: one bus over one link registry, one registered
 *  root, a real uploader on a real endpoint. `uploadEndpoint` of "" means
 *  uploads are off. */
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
    const links = new WorkerLinks();
    const bus = new LogFlushBus(links);
    bus.registerLogger(logger);
    const router = new PortRpcRouter<TestRealmRoot>(
        (self) => new TestRealmRoot(self, bus),
        logger
    );
    return {
        bus,
        links,
        router,
        logger,
        logStore,
        logUploader,
        threadName: opts.threadName
    };
}

/** an sdk realm on a real receiver, with the config a worker rebuilds from its
 *  init payload pointed at the same receiver. `dispose` puts the config back. */
export function hostRealmOn(receiver: LogReceiver): {
    realm: TestRealm;
    dispose: () => void;
} {
    const restoreConfig = applyCrashLogConfig(
        crashLogUploadOverrides(receiver.url)
    );
    const realm = createTestRealm({
        threadName: "sdk",
        uploadEndpoint: receiver.url
    });
    return {
        realm,
        dispose: () => {
            realm.logger.dispose();
            restoreConfig();
        }
    };
}

/** a port that records every frame posted through it before it crosses */
function recordingPort(port: NodeMessagePort, sent: LinkFrame[]): RuntimePort {
    const adapted = adaptPort(port);
    return {
        ...adapted,
        post: (message, transfer) => {
            sent.push(message as LinkFrame);
            adapted.post(message, transfer);
        }
    };
}

/** join two realms over a real MessageChannel pair, the shape the runtime and
 *  executor ports have, recording what crosses each way */
export function connectRealms(
    parent: TestRealm,
    child: TestRealm
): RealmConnection {
    const channel = new MessageChannel();
    const toChild: LinkFrame[] = [];
    const toParent: LinkFrame[] = [];

    const parentTransport: MessagePortTransport = parent.router.attach(
        recordingPort(channel.port1, toChild)
    );
    const childTransport: MessagePortTransport = child.router.attach(
        recordingPort(channel.port2, toParent)
    );

    // through the registries, like the real transports -> each link lands on
    // the bus of the realm that holds it
    const removeFromParent = parent.links.add({
        id: child.threadName,
        transport: parentTransport,
        router: parent.router,
        remoteRealm: "child",
        ownerLogger: parent.logger
    });
    const removeFromChild = child.links.add({
        id: parent.threadName,
        transport: childTransport,
        router: child.router,
        remoteRealm: "parent",
        ownerLogger: child.logger
    });

    return {
        toChild,
        toParent,
        removeFromParent,
        removeFromChild,
        close: () => {
            removeFromParent();
            removeFromChild();
            parentTransport.close(true);
            childTransport.close(true);
        }
    };
}

/** a link whose far end never answers - the "thread died" case. nothing
 *  listens on port2, so no reply comes back. */
export function addDeadPort(realm: TestRealm): {
    posted: LinkFrame[];
    remove: () => void;
} {
    const channel = new MessageChannel();
    const posted: LinkFrame[] = [];
    const transport = realm.router.attach(recordingPort(channel.port1, posted));
    const removeLink = realm.links.add({
        id: "dead",
        transport,
        router: realm.router,
        remoteRealm: "child",
        ownerLogger: realm.logger
    });
    return {
        posted,
        remove: () => {
            removeLink();
            transport.close(true);
            channel.port2.close();
        }
    };
}

/** the log-control calls in a recorded stream, by their old names */
export function countMessages(
    messages: LinkFrame[],
    type: "flushRequest" | "contextUpdate"
): number {
    const method = type === "flushRequest" ? "flush" : "contextUpdate";
    return messages.filter(
        (frame) =>
            "service" in frame &&
            frame.service === "logControl" &&
            frame.method === method
    ).length;
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
