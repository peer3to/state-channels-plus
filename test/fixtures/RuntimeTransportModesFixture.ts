// @spec-test-coverage-ignore: Runtime transport fixture exercised by owning E2E declarations.
import { expect } from "chai";
import { ethers, NonceManager } from "ethers";

import { EvmStateMachine } from "@/evm";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { deployFullStack } from "../../scripts/V1/deploy";
import {
    slotAccountIndex,
    slotDeployerIndex
} from "@test/harness/core/slotAccounts";
import {
    MathStateMachine,
    MathStateMachine__factory,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import { ContractFactory } from "ethers";
import {
    startHardhatNode,
    waitForHardhatNode,
    type NodeHandle
} from "@test/utils/nodeInfra";
import path from "node:path";
import type { ReadyLifecycleRpc } from "@test/fixtures/customRpc/ReadyLifecycleRpcManifest";
import { waitFor } from "@test/utils/waitFor";
import { createLogger } from "@/utils/logging";
import {
    startLogReceiver,
    uploadsInclude,
    threadStream
} from "@test/fixtures/logging/LogUploader.fixture";
import { crashLogUploadOverrides } from "@test/fixtures/logging/crashLogConfig";

// a port hop plus one POST per realm -> above the fixture's 2s default
const UPLOAD_WAIT_MS = 20_000;

let hardhatNodeUrl = process.env.HARDHAT_NODE_URL;
const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

async function setupP2pInstance(options: {
    runSdkInThread: boolean;
    vmDedicatedThread: boolean;
    generateSigner?: boolean;
    readyOptions?: { delayMs?: number; reject?: boolean };
    /** crash-log uploads on for every realm, jitter pinned */
    crashLogUploadEndpoint?: string;
}) {
    const {
        runSdkInThread,
        vmDedicatedThread,
        generateSigner,
        readyOptions,
        crashLogUploadEndpoint
    } = options;
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

    return EvmStateMachine.p2pSetup<MathStateMachine, ReadyLifecycleRpc>(
        StateChannelManagerProxy__factory.connect(
            scmDeployment.address,
            runtimeSigner
        ),
        deployedStateMachine,
        deployStateMachine,
        {
            config: {
                PROVIDER_URL: hardhatNodeUrl,
                RUN_SDK_IN_THREAD: runSdkInThread,
                VM_DEDICATED_THREAD: vmDedicatedThread,
                ...(crashLogUploadEndpoint
                    ? crashLogUploadOverrides(crashLogUploadEndpoint)
                    : {})
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
        }
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
    const p2pInstance = await setupP2pInstance({
        runSdkInThread,
        vmDedicatedThread: false,
        readyOptions: {}
    });
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

/** no harness: a bare p2pSetup app with a threaded SDK host, crashing on its own.
 *  only the production attachErrorListener wiring spreads that to other realms. */
export async function assertSdkThreadCrashUploadsEveryThread(): Promise<void> {
    const receiver = await startLogReceiver();
    const p2pInstance = await setupP2pInstance({
        runSdkInThread: true,
        vmDedicatedThread: true,
        readyOptions: {},
        crashLogUploadEndpoint: receiver.url
    });

    try {
        // the host error still comes over the port -> take it, or it lands as a
        // stray rejection
        const hostErrors: Error[] = [];
        p2pInstance.onHostError((error) => hostErrors.push(error));
        p2pInstance.logger.warn("main realm entry before the crash");

        const marker = `bare-sdk-crash-${Date.now()}`;
        await p2pInstance.hostRpc.scenario
            .exec(
                "(sm, args) => { void Promise.reject(new Error(args.marker)); return true; }",
                { marker }
            )
            .request();

        await waitFor(
            () => uploadsInclude(threadStream(receiver, "sdk"), marker),
            UPLOAD_WAIT_MS
        );
        // the crashed thread's round reached main too
        await waitFor(
            () => threadStream(receiver, "main").length > 0,
            UPLOAD_WAIT_MS
        );
        expect(hostErrors.map((error) => error.message)).to.include(marker);
    } finally {
        await p2pInstance.dispose();
        await receiver.close();
    }
}

/**
 * a closed session has to leave the realm's bus. the logger p2pSetup makes owns
 * a bounded store and the process crash hooks, so one left registered is a leak
 * that also re-uploads a dead session on every later round.
 */
export async function assertDisposedSessionLeavesTheFlushTree(): Promise<void> {
    const receiver = await startLogReceiver();
    const probe = createLogger(
        { threadName: "main" },
        { component: "DisposedSessionProbe" },
        {
            skipWriting: true,
            logUploaderConfig: { uploadEndpoint: receiver.url }
        }
    );

    try {
        const baseline = await probe.uploadLogs("baseline");

        const p2pInstance = await setupP2pInstance({
            runSdkInThread: false,
            vmDedicatedThread: false,
            readyOptions: {},
            crashLogUploadEndpoint: receiver.url
        });
        p2pInstance.logger.warn("written by the session");
        await p2pInstance.dispose();

        probe.warn("written after the session closed");
        const afterDispose = await probe.uploadLogs("after dispose");

        // the session's root left as it closed -> the same store count as before
        expect(afterDispose.ok).to.equal(baseline.ok);
    } finally {
        probe.dispose();
        await receiver.close();
    }
}

/**
 * a setup that throws hands nobody the logger it made. left on the bus it keeps a
 * bounded store and the process crash hooks alive, and every later round uploads
 * a session that never opened.
 */
export async function assertFailedSetupLeavesNoRootOnTheFlushBus(): Promise<void> {
    const receiver = await startLogReceiver();
    const probe = createLogger(
        { threadName: "main" },
        { component: "FailedSetupProbe" },
        {
            skipWriting: true,
            logUploaderConfig: { uploadEndpoint: receiver.url }
        }
    );

    try {
        const baseline = await probe.uploadLogs("baseline");

        let message = "";
        try {
            await setupP2pInstance({
                runSdkInThread: false,
                vmDedicatedThread: false,
                readyOptions: { reject: true },
                crashLogUploadEndpoint: receiver.url
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.equal("root ready boom");

        probe.warn("written after the failed setup");
        const afterFailure = await probe.uploadLogs("after the failed setup");

        // the failed setup left nothing behind -> the same store count as before
        expect(afterFailure.ok).to.equal(baseline.ok);
    } finally {
        probe.dispose();
        await receiver.close();
    }
}

/** report-a-bug: an app calls uploadLogs and gets an outcome it can show a user,
 *  including when the server refuses. */
export async function assertReportABugReportsItsThreads(): Promise<void> {
    let failUploads = false;
    const receiver = await startLogReceiver({
        respond: () => (failUploads ? 500 : 200)
    });
    const p2pInstance = await setupP2pInstance({
        runSdkInThread: true,
        vmDedicatedThread: true,
        readyOptions: {},
        crashLogUploadEndpoint: receiver.url
    });

    try {
        p2pInstance.logger.warn("something the user wants reported");
        const sent = await p2pInstance.logger.uploadLogs("user report");

        expect(sent.timedOut).to.equal(0);
        expect(sent.failed).to.equal(0);
        // all three took part. vm has nothing to send but still answers.
        expect(sent.ok).to.be.greaterThanOrEqual(3);
        expect(threadStream(receiver, "main").length).to.be.greaterThan(0);
        expect(threadStream(receiver, "sdk").length).to.be.greaterThan(0);

        failUploads = true;
        p2pInstance.logger.warn("a second thing to report");
        const refused = await p2pInstance.logger.uploadLogs("user report");

        // the button can report a refusal instead of always claiming success
        expect(refused.failed).to.be.greaterThan(0);
    } finally {
        await p2pInstance.dispose();
        await receiver.close();
    }
}
