// @spec-test-coverage-ignore: Runtime transport fixture exercised by owning E2E declarations.
import { expect } from "chai";
import { ethers, NonceManager } from "ethers";

import { EvmStateMachine } from "@/evm";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import { createContractExecutorWorkerFromPath } from "@/evm/contractExecutor/node/ContractExecutorWorkerRuntime";
import { createP2pRuntimeWorkerFromPath } from "@/evm/p2pRuntime/node/P2pRuntimeWorkerRuntime";
import {
    setupP2pRuntime,
    type P2pSetupDependencies,
    type P2pSetupOptions
} from "@/evm/p2pRuntime/setupP2pRuntime";
import type { WatchdogWorkerData } from "@test/evm/workers/node/watchdogContractExecutorWorkerEntry";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { deployFullStack } from "../../scripts/V1/deploy";
import {
    slotAccountIndex,
    slotDeployerIndex
} from "@test/harness/core/slotAccounts";
import { MathStateMachine, MathStateMachine__factory } from "@typechain-types";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import { ContractFactory } from "ethers";
import {
    startHardhatNode,
    waitForHardhatNode,
    type NodeHandle
} from "@test/utils/nodeInfra";
import path from "node:path";
import type { ReadyLifecycleRpc } from "@test/fixtures/customRpc/ReadyLifecycleRpcManifest";
import type P2pInstance from "@/evm/P2pInstance";

let hardhatNodeUrl = process.env.HARDHAT_NODE_URL;
const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

/**
 * Deploy the manager stack for one runtime instance and return what
 * `setupP2pRuntime` needs. The signer is the slot's first account unless the
 * caller wants a generated one.
 */
async function prepareRuntimeSetup(options: {
    runSdkInThread: boolean;
    vmDedicatedThread: boolean;
    generateSigner?: boolean;
    readyOptions?: { delayMs?: number; reject?: boolean };
}) {
    const { runSdkInThread, vmDedicatedThread, generateSigner, readyOptions } =
        options;
    if (!hardhatNodeUrl) throw new Error("Hardhat node URL is not initialized");
    const provider = new ethers.JsonRpcProvider(hardhatNodeUrl);
    const deployerWallet = ethers.HDNodeWallet.fromPhrase(
        DEFAULT_HARDHAT_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${slotDeployerIndex()}`
    );
    const runtimeWallet = ethers.HDNodeWallet.fromPhrase(
        DEFAULT_HARDHAT_MNEMONIC,
        undefined,
        `m/44'/60'/0'/0/${slotAccountIndex(0)}`
    );
    const deployerSigner = new NonceManager(deployerWallet.connect(provider));
    const runtimeSigner = runtimeWallet.connect(provider);

    const scmDeployment = await deployFullStack(deployerSigner, {
        stateMachineArtifact: MathStateMachineArtifact as any,
        consumerFacetArtifact: MathConsumerFacetArtifact as any,
        stateMachineArgs: [5_000_000],
        consumerFacetArgs: [],
        timeConfig: {
            p2pTime: 1,
            agreementTime: 1,
            chainFallbackTime: 1,
            evidenceTime: 1
        },
        disputeExecutionGasLimit: 1_000_000
    });

    const deployedStateMachine = MathStateMachine__factory.connect(
        ethers.ZeroAddress,
        runtimeSigner
    );

    const deployStateMachine = async (stateMachineSigner: ethers.Signer) => {
        const stateMachineFactory = new ContractFactory(
            MathStateMachineArtifact.abi,
            MathStateMachineArtifact.bytecode,
            stateMachineSigner
        );
        const tx = await stateMachineSigner.sendTransaction(
            await stateMachineFactory.getDeployTransaction(5_000_000)
        );
        const receipt = await tx.wait();
        if (!receipt?.contractAddress) {
            throw new Error(
                "No local MathStateMachine contract address created"
            );
        }

        return receipt.contractAddress;
    };

    const setupOptions: P2pSetupOptions = {
        config: {
            PROVIDER_URL: hardhatNodeUrl,
            RUN_SDK_IN_THREAD: runSdkInThread,
            VM_DEDICATED_THREAD: vmDedicatedThread
        },
        signerSecret: generateSigner ? undefined : runtimeWallet.privateKey,
        customRpcManifest: readyOptions
            ? {
                  module: path.resolve(
                      __dirname,
                      "customRpc/ReadyLifecycleRpcManifest.ts"
                  ),
                  exportName: "ReadyLifecycleRpc",
                  options: readyOptions
              }
            : undefined
    };
    return {
        scm: connectStateChannelManager(scmDeployment.address, runtimeSigner),
        deployedStateMachine,
        deployStateMachine,
        setupOptions
    };
}

async function setupP2pInstance(options: {
    runSdkInThread: boolean;
    vmDedicatedThread: boolean;
    generateSigner?: boolean;
    readyOptions?: { delayMs?: number; reject?: boolean };
}) {
    const { scm, deployedStateMachine, deployStateMachine, setupOptions } =
        await prepareRuntimeSetup(options);
    return EvmStateMachine.p2pSetup(
        scm,
        deployedStateMachine,
        deployStateMachine,
        setupOptions
    );
}

const WATCHDOG_VM_WORKER_ENTRY = path.resolve(
    __dirname,
    "../evm/workers/node/watchdogContractExecutorWorkerEntry.ts"
);
const WATCHDOG_SDK_WORKER_ENTRY = path.resolve(
    __dirname,
    "../evm/workers/node/watchdogP2pRuntimeWorkerEntry.ts"
);

/**
 * A real runtime whose dedicated contract-executor worker is the scripted
 * watchdog entry. Inline mode injects the executor factory through the host
 * context; sdk-worker mode spawns the outer test entry, which does the same
 * injection inside its own thread. `mode` and `armChannel` select what the
 * VM worker does once armed.
 */
export async function setupWatchdogP2pInstance(options: {
    runSdkInThread: boolean;
    mode: WatchdogWorkerData["mode"];
    armChannel: string;
}) {
    const { scm, deployedStateMachine, deployStateMachine, setupOptions } =
        await prepareRuntimeSetup({
            runSdkInThread: options.runSdkInThread,
            vmDedicatedThread: true
        });
    // Synthetic runs are silent by config: the host-side executor and client
    // log every report, and the watchdog message in the runner log would trip
    // its starvation classifier; the real monitors of this instance are off so
    // the only threshold in play is the scripted one.
    setupOptions.config = {
        ...setupOptions.config,
        LOG_SKIP_WRITING: true,
        EVENT_LOOP_DELAY_ERROR_THRESHOLD_SECONDS: 0
    };
    const workerData: WatchdogWorkerData = {
        mode: options.mode,
        armChannel: options.armChannel
    };
    const dependencies: P2pSetupDependencies = options.runSdkInThread
        ? {
              createP2pRuntimeWorker: () =>
                  createP2pRuntimeWorkerFromPath(
                      WATCHDOG_SDK_WORKER_ENTRY,
                      workerData
                  )
          }
        : {
              hostContext: {
                  createContractExecutor: (factoryOptions, deps) =>
                      createContractExecutor(factoryOptions, {
                          ...deps,
                          createWorkerRuntime: (onMessage, onError) =>
                              createContractExecutorWorkerFromPath(
                                  WATCHDOG_VM_WORKER_ENTRY,
                                  onMessage,
                                  onError,
                                  workerData
                              )
                      })
              }
          };
    return setupP2pRuntime(
        scm,
        deployedStateMachine,
        deployStateMachine,
        setupOptions,
        dependencies
    );
}

let nodeHandle: NodeHandle | undefined;

export async function startRuntimeTransportModesFixture(): Promise<void> {
    if (hardhatNodeUrl) {
        await waitForHardhatNode(hardhatNodeUrl);
    } else {
        nodeHandle = await startHardhatNode();
        hardhatNodeUrl = nodeHandle.url;
    }
}

export function stopRuntimeTransportModesFixture(): void {
    nodeHandle?.stop();
}

export async function assertContractRoundTrip(
    runSdkInThread: boolean,
    vmDedicatedThread: boolean
): Promise<void> {
    const p2pInstance = await setupP2pInstance({
        runSdkInThread,
        vmDedicatedThread
    });

    try {
        const signerAddress = await p2pInstance.chainSigner.getAddress();
        expect(signerAddress).to.match(/^0x[0-9a-fA-F]{40}$/);
        expect(await p2pInstance.p2pSigner.getAddress()).to.equal(
            signerAddress
        );

        const times =
            await p2pInstance.stateChannelManagerContract.getAllTimes();
        expect(times.length).to.equal(4);

        const initialState = await p2pInstance.p2pContractInstance.getState();
        expect(initialState).to.match(/^0x[0-9a-fA-F]*$/);

        const participants =
            await p2pInstance.p2pContractInstance.getParticipants();
        expect(participants).to.be.an("array");

        let resolveError: unknown;
        try {
            await p2pInstance.chainSigner.resolveName("runtime.peer3.eth");
        } catch (error) {
            resolveError = error;
        }
        expect(resolveError).to.be.instanceOf(Error);
        expect((resolveError as Error & { code?: string }).code).to.equal(
            "UNSUPPORTED_OPERATION"
        );
        expect(
            await p2pInstance.chainSigner.call({ to: signerAddress })
        ).to.equal("0x");
        expect(
            await p2pInstance.chainSigner.estimateGas({
                to: signerAddress,
                value: 1n
            })
        ).to.be.greaterThanOrEqual(21_000n);

        const populatedCall = await p2pInstance.chainSigner.populateCall({
            to: signerAddress,
            value: 1n
        });
        expect(populatedCall.to).to.equal(signerAddress);
        expect(populatedCall.value).to.equal(1n);

        const populatedTransaction =
            await p2pInstance.chainSigner.populateTransaction({
                to: signerAddress,
                value: 1n
            });
        const signedTransaction =
            await p2pInstance.chainSigner.signTransaction(populatedTransaction);
        expect(ethers.Transaction.from(signedTransaction).from).to.equal(
            signerAddress
        );
        const message = "host-owned-chain-signer";
        expect(
            ethers.verifyMessage(
                message,
                await p2pInstance.chainSigner.signMessage(message)
            )
        ).to.equal(signerAddress);
        const messageBytes = ethers.getBytes("0x1234");
        expect(
            ethers.verifyMessage(
                messageBytes,
                await p2pInstance.chainSigner.signMessage(messageBytes)
            )
        ).to.equal(signerAddress);

        const domain = {
            name: "Peer3 runtime signer",
            version: "1"
        };
        const types = {
            RuntimeMessage: [{ name: "value", type: "uint256" }]
        };
        const value = { value: 7n };
        expect(
            ethers.verifyTypedData(
                domain,
                types,
                value,
                await p2pInstance.chainSigner.signTypedData(
                    domain,
                    types,
                    value
                )
            )
        ).to.equal(signerAddress);

        let signerError: unknown;
        try {
            await p2pInstance.chainSigner.sendTransaction({
                from: ethers.ZeroAddress,
                to: signerAddress,
                value: 1n
            });
        } catch (error) {
            signerError = error;
        }
        expect(signerError).to.be.instanceOf(Error);
        expect((signerError as Error & { code?: string }).code).to.equal(
            "INVALID_ARGUMENT"
        );
        expect(
            (signerError as Error & { shortMessage?: string }).shortMessage
        ).to.include("transaction from mismatch");

        const beforeNonce = await p2pInstance.chainSigner.getNonce("pending");
        const responses = await Promise.all([
            p2pInstance.chainSigner.sendTransaction({
                to: signerAddress,
                value: 1n
            }),
            p2pInstance.chainSigner.sendTransaction({
                to: signerAddress,
                value: 2n
            })
        ]);
        const receipts = await Promise.all(
            responses.map((response) => response.wait())
        );
        expect(responses.map((response) => response.nonce)).to.deep.equal([
            beforeNonce,
            beforeNonce + 1
        ]);
        expect(responses.map((response) => response.value)).to.deep.equal([
            1n,
            2n
        ]);
        expect(receipts.every((receipt) => receipt?.status === 1)).to.equal(
            true
        );
    } finally {
        await p2pInstance.dispose();
    }
}

export async function assertCustomRootReadiness(
    runSdkInThread: boolean
): Promise<void> {
    const startedAt = Date.now();
    const p2pInstance = await setupP2pInstance({
        runSdkInThread,
        vmDedicatedThread: false,
        readyOptions: { delayMs: 100 }
    });
    try {
        expect(Date.now() - startedAt).to.be.greaterThanOrEqual(100);
    } finally {
        await p2pInstance.dispose();
    }
}

export async function assertRpcHandlerEntersWithoutMutex(
    runSdkInThread: boolean
): Promise<void> {
    const p2pInstance = (await setupP2pInstance({
        runSdkInThread,
        vmDedicatedThread: false,
        readyOptions: {}
    })) as unknown as P2pInstance<MathStateMachine, ReadyLifecycleRpc>;
    try {
        expect(
            await p2pInstance.hostRpc.mutexProbe
                .isLockedAtHandlerEntry()
                .request()
        ).to.equal(false);
    } finally {
        await p2pInstance.dispose();
    }
}

export async function assertRejectedCustomRootReadiness(
    runSdkInThread: boolean
): Promise<void> {
    let message = "";
    try {
        await setupP2pInstance({
            runSdkInThread,
            vmDedicatedThread: false,
            readyOptions: { reject: true }
        });
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    expect(message).to.equal("root ready boom");
}

export async function assertGeneratedHostSigner(): Promise<void> {
    const p2pInstance = await setupP2pInstance({
        runSdkInThread: false,
        vmDedicatedThread: false,
        generateSigner: true
    });
    try {
        expect(await p2pInstance.chainSigner.getAddress()).to.match(
            /^0x[0-9a-fA-F]{40}$/
        );
        expect(
            await p2pInstance.stateChannelManagerContract.getAllTimes()
        ).to.have.length(4);
    } finally {
        await p2pInstance.dispose();
    }
}
