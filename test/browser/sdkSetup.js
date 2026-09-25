// @spec-test-coverage-ignore: real browser SDK setup shared by the browser gates
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import {
    deployFullStack,
    DEFAULT_MAX_CHANNEL_PARTICIPANTS
} from "../../scripts/V1/deploy";
import { RootCreationControl } from "../fixtures/runtimeRpc/RootCreationControl.ts";
import { RuntimeRpcControl } from "../fixtures/runtimeRpc/RuntimeRpcControl.ts";
import { TestClockProvider } from "../fixtures/TestClockProvider.ts";
import Clock from "@/Clock";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import { setupP2pRuntime } from "@/evm/p2pRuntime/setupP2pRuntime";
import { P2pRuntimeClientRoot } from "@/rpc/internal/roots/P2pRuntimeClientRoot";
import { Codec, SignatureUtils, Type } from "@/utils";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import executorWorkerUrl from "@platform/contractExecutorRootUrl";
import { MathStateMachine__factory } from "@typechain-types";
import { ethers, NonceManager, ContractFactory } from "ethers";

export const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";
const timeConfig = {
    p2pTime: 5,
    agreementTime: 30,
    chainFallbackTime: 30,
    evidenceTime: 60
};

/**
 * Deploy the full stack against the external hardhat node (reached through the
 * same-origin RPC proxy) and derive a shared channel id for discovery. The
 * existing-channel case opens that ID on-chain after the genesis runtime has
 * selected it, so the observer exercises the real sync boundary over WebRTC.
 */
export async function deployStack(providerUrl, openExistingChannel) {
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallets = [0, 1, 2, 3].map((index) =>
        ethers.HDNodeWallet.fromPhrase(
            DEFAULT_HARDHAT_MNEMONIC,
            undefined,
            `m/44'/60'/0'/0/${index}`
        )
    );
    const [deployerWallet, peerAWallet, peerBWallet, genesisPeerWallet] =
        wallets;
    const deployerSigner = new NonceManager(deployerWallet.connect(provider));

    const scmDeployment = await deployFullStack(deployerSigner, {
        stateMachineArtifact: MathStateMachineArtifact,
        consumerFacetArtifact: MathConsumerFacetArtifact,
        stateMachineArgs: [5_000_000, DEFAULT_MAX_CHANNEL_PARTICIPANTS],
        consumerFacetArgs: [],
        timeConfig,
        disputeExecutionGasLimit: 1_000_000
    });

    await Clock.init(provider);

    const channelId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["string"],
            ["browser-webrtc-e2e"]
        )
    );

    const openConfirmedChannel = async () => {
        const latestBlock = await provider.getBlock("latest");
        const openChannel = {
            channelId,
            participants: [deployerWallet.address, genesisPeerWallet.address],
            balances: [
                { amount: 500n, data: "0x1234" },
                { amount: 500n, data: "0x5678" }
            ],
            deadlineTimestamp: BigInt(latestBlock.timestamp + 120),
            isAtomic: true,
            data: "0x"
        };
        const signatures = await Promise.all(
            [deployerWallet, genesisPeerWallet].map((wallet) =>
                SignatureUtils.signOpenChannel(openChannel, wallet)
            )
        );
        const manager = connectStateChannelManager(
            scmDeployment.address,
            deployerSigner
        );
        await (
            await manager.open({
                encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
                signatures: signatures.map(({ signature }) => signature)
            })
        ).wait();
    };

    return {
        provider,
        scmAddress: scmDeployment.address,
        channelId,
        peerWallets: openExistingChannel
            ? [deployerWallet, peerAWallet]
            : [peerAWallet, peerBWallet],
        openConfirmedChannel
    };
}

export async function deployLocalStateMachine(
    stateMachineSigner,
    maxChannelParticipants
) {
    const stateMachineFactory = new ContractFactory(
        MathStateMachineArtifact.abi,
        MathStateMachineArtifact.bytecode,
        stateMachineSigner
    );
    const deployTx = await stateMachineFactory.getDeployTransaction(
        5_000_000,
        maxChannelParticipants
    );
    const sent = await stateMachineSigner.sendTransaction(deployTx);
    const receipt = await sent.wait();
    if (!receipt?.contractAddress) {
        throw new Error("No local MathStateMachine address created");
    }
    return receipt.contractAddress;
}

export async function setupBrowserPeer(
    peerWallet,
    providerUrl,
    scmAddress,
    options = {},
    dependencies = {}
) {
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const runtimeSigner = peerWallet.connect(provider);
    const manager = connectStateChannelManager(scmAddress, runtimeSigner);
    const maxChannelParticipants = await manager.getMaxChannelParticipants();
    let control;
    let instance;
    try {
        instance = await RootCreationControl.observe(
            () =>
                setupP2pRuntime(
                    connectStateChannelManager(scmAddress, runtimeSigner),
                    MathStateMachine__factory.connect(
                        ethers.ZeroAddress,
                        runtimeSigner
                    ),
                    (signer) =>
                        deployLocalStateMachine(signer, maxChannelParticipants),
                    {
                        ...options,
                        config: {
                            ...options.config,
                            PROVIDER_URL: providerUrl
                        },
                        signerSecret: peerWallet.privateKey
                    },
                    { hostContext: dependencies.hostContext }
                ),
            (root) => {
                dependencies.onRuntimeRoot?.(root);
                if (
                    root instanceof P2pRuntimeClientRoot &&
                    Reflect.get(root, "signerAddress") === peerWallet.address
                )
                    control = RuntimeRpcControl.attach(
                        [...root.connections.keys()][0]
                    );
            }
        );
        const events = control.events;
        const deployment = events.find(
            (event) =>
                event.direction === "send" && event.method === "deployComplete"
        );
        const ready = events.findIndex(
            (event) => event.direction === "receive" && event.method === "ready"
        );
        const response = events.findIndex(
            (event) =>
                event.direction === "receive" &&
                event.response &&
                event.requestId === deployment?.requestId
        );
        if (ready < 0 || response <= ready)
            throw new Error(
                "SDK ready must arrive before deployment completion resolves"
            );
        if (options.config?.RUN_SDK_IN_THREAD) {
            const bridge = events.findIndex(
                (event) =>
                    event.direction === "receive" &&
                    event.method === "webRTCBridgePort"
            );
            if (bridge < 0 || bridge >= ready)
                throw new Error("SDK bridge port must arrive before ready");
        }
        const dispose = instance.dispose.bind(instance);
        instance.dispose = async () => {
            try {
                await dispose();
            } finally {
                provider.destroy();
            }
        };
        return instance;
    } catch (error) {
        try {
            await instance?.dispose();
        } catch {
            /* Preserve the setup assertion error. */
        }
        provider.destroy();
        throw error;
    }
}

export async function createBrowserSdkExecutor(options = {}) {
    const providerUrl = globalThis.__SDK_RUNTIME__?.providerUrl;
    if (!providerUrl)
        throw new Error("Browser SDK runtime provider was not configured");
    const stack = await deployStack(providerUrl, false);
    let executor;
    let shiftedClock;
    try {
        const instance = await setupBrowserPeer(
            stack.peerWallets[0],
            providerUrl,
            stack.scmAddress,
            {
                peerLogger: options.logger,
                customPrecompiles: options.customPrecompiles,
                config: {
                    RUN_SDK_IN_THREAD: false,
                    VM_DEDICATED_THREAD: true,
                    HOLEPUNCH_RELAYER_URLS: [],
                    CRASH_LOG_UPLOAD_ENDPOINT: "",
                    ...options.config
                }
            },
            {
                onRuntimeRoot: options.onRuntimeRoot,
                hostContext: {
                    createContractExecutor: async (factoryOptions, owner) => {
                        if (options.clockAdjustmentSeconds !== undefined) {
                            shiftedClock = new TestClockProvider(
                                stack.provider,
                                options.clockAdjustmentSeconds -
                                    Clock.getClockAdjustmentSeconds()
                            );
                            await Clock.init(shiftedClock);
                        }
                        const NativeWorker = globalThis.Worker;
                        if (options.dependencies?.workerUrl) {
                            globalThis.Worker = class extends NativeWorker {
                                constructor(url, workerOptions) {
                                    const isExecutor =
                                        String(url) ===
                                        String(executorWorkerUrl);
                                    super(
                                        isExecutor
                                            ? options.dependencies.workerUrl
                                            : url,
                                        isExecutor &&
                                            options.dependencies.workerName
                                            ? {
                                                  ...workerOptions,
                                                  name: options.dependencies
                                                      .workerName
                                              }
                                            : workerOptions
                                    );
                                }
                            };
                        }
                        try {
                            executor = await createContractExecutor(
                                factoryOptions,
                                owner
                            );
                            if (options.dependencies?.onDetachedError)
                                [...owner.children]
                                    .at(-1)
                                    .onError(
                                        options.dependencies.onDetachedError
                                    );
                        } finally {
                            globalThis.Worker = NativeWorker;
                        }
                        return executor;
                    }
                }
            }
        );
        return {
            executor,
            instance,
            async dispose() {
                try {
                    await instance.dispose();
                } finally {
                    shiftedClock?.destroy();
                    stack.provider.destroy();
                }
            }
        };
    } catch (error) {
        shiftedClock?.destroy();
        stack.provider.destroy();
        throw error;
    }
}
