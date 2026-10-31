// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import LocalDiamondArtifact from "../../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";
import type { AContractExecutor } from "@/evm/contractExecutor";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import type { SetupPayload } from "@/evm/p2pRuntime/types";
import type { RootStartContext } from "@/rpc/internal/createRoot";
import {
    P2pRuntimeHostRoot,
    type HostContext
} from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type { Bytes } from "@/types/types";
import { ethers } from "ethers";

/** Carries the held build's messages between the test and its host, in either placement. */
export const HELD_BUILD_CHANNEL = "held-build-host-root";

/**
 * Host to test: `held` once the build's last executor result is held,
 * `built` when the setup request settled, with whether the runtime it built
 * is cut and stopped. Test to host: `release` lets the held result through.
 */
export type HeldBuildMessage =
    | { type: "held" }
    | { type: "release" }
    | { type: "built"; isCut?: boolean; isStopped?: boolean };

/** Lets the held result through: the test's `release`, or a worker host's own cut. */
let releaseHeld: (() => void) | undefined;

function post(message: HeldBuildMessage): void {
    const channel = new BroadcastChannel(HELD_BUILD_CHANNEL);
    channel.postMessage(message);
    channel.close();
}

/** Resolves on {@link releaseHeld}. */
function released(): Promise<void> {
    const channel = new BroadcastChannel(HELD_BUILD_CHANNEL);
    return new Promise((resolve) => {
        releaseHeld = () => {
            channel.close();
            resolve();
        };
        channel.onmessage = (event: MessageEvent<HeldBuildMessage>) => {
            if (event.data.type === "release") releaseHeld?.();
        };
    });
}

/**
 * The real executor, whose deployment of the local diamond (the build's last
 * executor call before the runtime is constructed) returns only on release.
 */
async function holdDiamondDeploy(
    executor: AContractExecutor
): Promise<AContractExecutor> {
    const deploy = executor.deploy.bind(executor);
    executor.deploy = async (data: Bytes) => {
        const result = await deploy(data);
        if (ethers.hexlify(data).startsWith(LocalDiamondArtifact.bytecode)) {
            const release = released();
            post({ type: "held" });
            await release;
        }
        return result;
    };
    return executor;
}

/**
 * A host root whose runtime build holds before the runtime is constructed. A
 * worker host lets the build through at its own cut, since its thread ends
 * with its disposal; an inline host waits for the test's `release`.
 */
export class HeldBuildHostRoot extends P2pRuntimeHostRoot {
    private readonly releasesAtCut: boolean;

    constructor(
        payload: SetupPayload,
        local: HostContext = {},
        context: RootStartContext
    ) {
        super(
            payload,
            {
                ...local,
                createContractExecutor: async (options, owner) =>
                    holdDiamondDeploy(
                        await (
                            local.createContractExecutor ??
                            createContractExecutor
                        )(options, owner)
                    )
            },
            context
        );
        this.releasesAtCut = context.mode === "worker";
    }

    // Overrides P2pRuntimeHostRoot.start to report when the setup request settles.
    public override async start(): Promise<void> {
        await super.start();
        const deployComplete = this.sdkSetup.deployComplete.bind(this.sdkSetup);
        this.sdkSetup.deployComplete = async (...args) => {
            try {
                return await deployComplete(...args);
            } finally {
                let state = {};
                try {
                    const p2pManager = this.application.p2pManager;
                    state = {
                        isCut: p2pManager.isDisposed,
                        isStopped: p2pManager.stateManager.isDisposed
                    };
                } catch {
                    // no runtime was built
                }
                post({ type: "built", ...state });
            }
        };
    }

    // Overrides P2pRuntimeHostRoot.dispose to let a worker's held build through after the cut.
    public override dispose(): Promise<void> {
        const disposal = super.dispose();
        if (this.releasesAtCut) releaseHeld?.();
        return disposal;
    }
}
