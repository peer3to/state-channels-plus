import { expect } from "chai";
import { ethers, NonceManager } from "ethers";

import { EvmStateMachine } from "@/evm";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import MathConsumerFacetArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathConsumerFacet.sol/MathConsumerFacet.json";
import { deployFullStack } from "../../scripts/V1/deploy";
import { waitFor } from "@test/utils/waitFor";
import {
    slotAccountIndex,
    slotDeployerIndex
} from "@test/harness/core/slotAccounts";
import {
    MathStateMachine__factory,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import { ContractFactory } from "ethers";
import { startHardhatNode, type NodeHandle } from "@test/utils/nodeInfra";
import path from "node:path";

let hardhatNodeUrl = process.env.HARDHAT_NODE_URL;
const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

async function waitForNode(url: string): Promise<void> {
    const provider = new ethers.JsonRpcProvider(url);

    await waitFor(async () => {
        try {
            await provider.getBlockNumber();
            return true;
        } catch {
            return false;
        }
    }, 30_000);
}

async function setupP2pInstance(options: {
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

    return EvmStateMachine.p2pSetup(
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
        }
    );
}

let nodeHandle: NodeHandle | undefined;

export async function startRuntimeTransportModesFixture(): Promise<void> {
    if (hardhatNodeUrl) {
        await waitForNode(hardhatNodeUrl);
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
