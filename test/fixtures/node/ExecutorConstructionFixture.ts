// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import {
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures
} from "./SdkExecutorFixture";
import { createUploaderFixture } from "../logging/LogUploader.fixture";
import { RuntimeRpcControl } from "../runtimeRpc/RuntimeRpcControl";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";
import { expect } from "chai";

export async function assertExecutorInitializationOrder(
    dedicatedThread: boolean
): Promise<void> {
    let connected!: () => void;
    const connectionReady = new Promise<void>((resolve) => {
        connected = resolve;
    });
    let control!: RuntimeRpcControl;
    let received!: Promise<void>;
    let resolved = false;
    const creating = createSdkOwnedExecutor(
        { dedicatedThread },
        {},
        undefined,
        false,
        (root) => {
            if (!(root instanceof P2pRuntimeHostRoot)) return;
            RootCreationControl.connections(root, (connection) => {
                if (connection.remoteRelation !== "child") return;
                control = RuntimeRpcControl.attachTo(connection);
                received = control.holdNextMessage("ready");
                connected();
            });
        }
    ).then((executor) => {
        resolved = true;
        return executor;
    });
    try {
        await connectionReady;
        await received;
        expect(resolved).to.equal(false);
        const readyIndex = control.events.findIndex(
            (event) => event.direction === "receive" && event.method === "ready"
        );
        const initIndex = control.events.findIndex(
            (event) => event.direction === "send" && event.method === "init"
        );
        expect(readyIndex).to.be.greaterThan(-1);
        expect(initIndex).to.equal(-1);
        expect(control.pendingTimers()).to.equal(0);
        control.release();
        await creating;
        expect(resolved).to.equal(true);
    } finally {
        control?.release();
        await creating;
        await disposeSdkExecutorFixtures();
    }
}

export async function assertInlineLoggerOwnership(): Promise<void> {
    const { logger, logStore } = createUploaderFixture({ uploadEndpoint: "" });
    const dispose = logger.dispose.bind(logger);
    let monitors = 0;
    let disposals = 0;
    await new Promise<void>((resolve) =>
        logger.startPerformanceMonitoring({
            delayErrorThresholdMs: 0,
            onStarted: () => {
                monitors++;
                resolve();
            }
        })
    );
    logger.dispose = () => {
        disposals++;
        return dispose();
    };
    try {
        const executor = await createSdkOwnedExecutor({
            dedicatedThread: false,
            logger: logger.child({ component: "ContractExecutor" })
        });
        await executor.dispose();
        await disposeSdkExecutorFixtures();
        expect(monitors).to.equal(1);
        expect(disposals).to.equal(0);
        logger.info("caller logger remains usable after final SDK disposal");
        expect(JSON.stringify(logStore.getAllLogs())).to.include(
            "caller logger remains usable after final SDK disposal"
        );
    } finally {
        await disposeSdkExecutorFixtures();
        logger.dispose = dispose;
        logger.dispose();
    }
}
