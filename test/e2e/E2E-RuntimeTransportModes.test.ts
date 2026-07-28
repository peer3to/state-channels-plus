import { expect } from "chai";
import { ClassicLevel } from "classic-level";
import { ethers, NonceManager } from "ethers";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
import type { PersistenceOptions } from "@/storage/persistence";

let hardhatNodeUrl = process.env.HARDHAT_NODE_URL;
const DEFAULT_HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

interface RuntimeModeOptions {
    runSdkInThread: boolean;
    vmDedicatedThread: boolean;
    generateSigner?: boolean;
    signerSecret?: string;
    persistence?: false | PersistenceOptions;
    channelId?: string;
}

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

async function createP2pInstanceFactory() {
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

    return (options: RuntimeModeOptions) =>
        EvmStateMachine.p2pSetup(
            StateChannelManagerProxy__factory.connect(
                scmDeployment.address,
                runtimeSigner
            ),
            deployedStateMachine,
            deployStateMachine,
            {
                config: {
                    PROVIDER_URL: hardhatNodeUrl,
                    RUN_SDK_IN_THREAD: options.runSdkInThread,
                    VM_DEDICATED_THREAD: options.vmDedicatedThread
                },
                persistence: options.persistence ?? false,
                channelId: options.channelId,
                signerSecret:
                    options.signerSecret ??
                    (options.generateSigner
                        ? undefined
                        : runtimeWallet.privateKey)
            }
        );
}

async function setupP2pInstance(options: RuntimeModeOptions) {
    const createP2pInstance = await createP2pInstanceFactory();
    return createP2pInstance(options);
}

describe("E2E: p2pSetup runtime modes", function () {
    let nodeHandle: NodeHandle | undefined;

    before(async function () {
        this.timeout(60_000);
        if (hardhatNodeUrl) {
            await waitForNode(hardhatNodeUrl);
        } else {
            nodeHandle = await startHardhatNode();
            hardhatNodeUrl = nodeHandle.url;
        }
    });

    after(function () {
        nodeHandle?.stop();
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
                const signerAddress =
                    await p2pInstance.chainSigner.getAddress();
                expect(signerAddress).to.match(/^0x[0-9a-fA-F]{40}$/);
                expect(await p2pInstance.p2pSigner.getAddress()).to.equal(
                    signerAddress
                );

                const times =
                    await p2pInstance.stateChannelManagerContract.getAllTimes();
                expect(times.length).to.equal(4);

                const initialState =
                    await p2pInstance.p2pContractInstance.getState();
                expect(initialState).to.match(/^0x[0-9a-fA-F]*$/);

                const participants =
                    await p2pInstance.p2pContractInstance.getParticipants();
                expect(participants).to.be.an("array");

                let resolveError: unknown;
                try {
                    await p2pInstance.chainSigner.resolveName(
                        "runtime.peer3.eth"
                    );
                } catch (error) {
                    resolveError = error;
                }
                expect(resolveError).to.be.instanceOf(Error);
                expect(
                    (resolveError as Error & { code?: string }).code
                ).to.equal("UNSUPPORTED_OPERATION");
                expect(
                    await p2pInstance.chainSigner.call({ to: signerAddress })
                ).to.equal("0x");
                expect(
                    await p2pInstance.chainSigner.estimateGas({
                        to: signerAddress,
                        value: 1n
                    })
                ).to.be.greaterThanOrEqual(21_000n);

                const populatedCall =
                    await p2pInstance.chainSigner.populateCall({
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
                    await p2pInstance.chainSigner.signTransaction(
                        populatedTransaction
                    );
                expect(
                    ethers.Transaction.from(signedTransaction).from
                ).to.equal(signerAddress);
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
                expect(
                    (signerError as Error & { code?: string }).code
                ).to.equal("INVALID_ARGUMENT");
                expect(
                    (signerError as Error & { shortMessage?: string })
                        .shortMessage
                ).to.include("transaction from mismatch");

                const beforeNonce =
                    await p2pInstance.chainSigner.getNonce("pending");
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
                expect(
                    responses.map((response) => response.nonce)
                ).to.deep.equal([beforeNonce, beforeNonce + 1]);
                expect(
                    responses.map((response) => response.value)
                ).to.deep.equal([1n, 2n]);
                expect(
                    receipts.every((receipt) => receipt?.status === 1)
                ).to.equal(true);
            } finally {
                await p2pInstance.dispose();
            }
        });
    }

    it("generates a host-owned signer when no secret is supplied", async function () {
        this.timeout(90_000);
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
    });

    it("recovers the channel signer after a persisted runtime restart", async function () {
        this.timeout(90_000);
        const location = await mkdtemp(
            path.join(tmpdir(), "state-channels-plus-runtime-persistence-")
        );
        const createP2pInstance = await createP2pInstanceFactory();
        const channelId = ethers.hexlify(ethers.randomBytes(32));

        try {
            const first = await createP2pInstance({
                runSdkInThread: false,
                vmDedicatedThread: false,
                persistence: { location },
                channelId,
                signerSecret: ethers.Wallet.createRandom().privateKey
            });
            let persistedSignerAddress: string;
            try {
                persistedSignerAddress = await first.p2pSigner.getAddress();
            } finally {
                await first.dispose();
            }

            const second = await createP2pInstance({
                runSdkInThread: false,
                vmDedicatedThread: false,
                persistence: { location },
                channelId,
                signerSecret: ethers.Wallet.createRandom().privateKey
            });
            try {
                expect(await second.p2pSigner.getAddress()).to.equal(
                    persistedSignerAddress
                );
            } finally {
                await second.dispose();
            }
        } finally {
            await rm(location, { recursive: true, force: true });
        }
    });

    it("reports a corrupt partition location and resets only on request", async function () {
        this.timeout(90_000);
        const location = await mkdtemp(
            path.join(tmpdir(), "state-channels-plus-runtime-reset-")
        );
        const createP2pInstance = await createP2pInstanceFactory();
        const channelId = ethers.hexlify(ethers.randomBytes(32));
        const options = {
            runSdkInThread: false,
            vmDedicatedThread: false,
            channelId,
            signerSecret: ethers.Wallet.createRandom().privateKey
        };

        try {
            const first = await createP2pInstance({
                ...options,
                persistence: { location }
            });
            await first.dispose();

            const [namespace] = await readdir(location);
            const partitionLocation = path.join(location, namespace);
            const database = new ClassicLevel<string, string>(
                partitionLocation,
                {
                    keyEncoding: "utf8",
                    valueEncoding: "utf8"
                }
            );
            await database.open();
            await database.put("records!v1!unknown!record", "corrupt");
            await database.close();

            let recoveryError: Error | undefined;
            try {
                const unexpected = await createP2pInstance({
                    ...options,
                    persistence: { location }
                });
                await unexpected.dispose();
            } catch (error) {
                recoveryError = error as Error;
            }
            expect(recoveryError?.message).to.include(partitionLocation);

            const reset = await createP2pInstance({
                ...options,
                persistence: { location, reset: true }
            });
            await reset.dispose();
        } finally {
            await rm(location, { recursive: true, force: true });
        }
    });
});
