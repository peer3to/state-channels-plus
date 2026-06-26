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

const HARDHAT_NODE_URL =
    process.env.HARDHAT_NODE_URL ?? "http://127.0.0.1:18545";
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
}) {
    const { runSdkInThread, vmDedicatedThread } = options;
    const provider = new ethers.JsonRpcProvider(HARDHAT_NODE_URL);
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
        runtimeSigner,
        StateChannelManagerProxy__factory.connect(
            scmDeployment.address,
            runtimeSigner
        ),
        deployedStateMachine,
        deployStateMachine,
        {
            config: {
                PROVIDER_URL: HARDHAT_NODE_URL,
                RUN_SDK_IN_THREAD: runSdkInThread,
                VM_DEDICATED_THREAD: vmDedicatedThread
            },
            signerSecret: runSdkInThread ? runtimeWallet.privateKey : undefined
        }
    );
}

describe("E2E: p2pSetup runtime modes", function () {
    before(async function () {
        this.timeout(60_000);
        await waitForNode(HARDHAT_NODE_URL);
    });

    const threadCombinations = [
        { runSdkInThread: false, vmDedicatedThread: false },
        { runSdkInThread: false, vmDedicatedThread: true },
        { runSdkInThread: true, vmDedicatedThread: false },
        { runSdkInThread: true, vmDedicatedThread: true }
    ] as const;

    for (const combo of threadCombinations) {
        const modeLabel = combo.runSdkInThread ? "worker" : "inline";
        const vmLabel = combo.vmDedicatedThread ? "dedicated-vm" : "inline-vm";

        it(`connects and round-trips contract calls in ${modeLabel}/${vmLabel} mode`, async function () {
            this.timeout(90_000);

            const p2pInstance = await setupP2pInstance(combo);

            try {
                const signerAddress = await p2pInstance.p2pSigner.getAddress();
                expect(signerAddress).to.match(/^0x[0-9a-fA-F]{40}$/);

                const initialState =
                    await p2pInstance.p2pContractInstance.getState();
                expect(initialState).to.match(/^0x[0-9a-fA-F]*$/);

                const participants =
                    await p2pInstance.p2pContractInstance.getParticipants();
                expect(participants).to.be.an("array");
            } finally {
                await p2pInstance.dispose();
            }
        });
    }
});
