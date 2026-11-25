import { BytesLike, ContractFactory, Signer, ethers } from "ethers";

import StateChannelManagerProxyArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol/StateChannelManagerProxy.json";
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";

import { StateChannelManagerInterface } from "@typechain-types/index";
import { Artifact } from "hardhat/types";
import { config } from "@/utils/config";
import type { Address } from "@/types/types";
import { routedFacetArtifacts } from "@/utils/routedFacets";
import { connectStateChannelManager } from "@/utils/stateChannelManager";
import {
    assertArtifactRuntimeSize,
    assertDeploymentInitcodeSize
} from "@/utils/contractSize";

const DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT = 3_000_000;
// Mirrors DEFAULT_MAX_CHANNEL_PARTICIPANTS in StateChannelManagerProxy: the
// deployer picks the value, the chain stores it, and clients read it back.
export const DEFAULT_MAX_CHANNEL_PARTICIPANTS = 32;
const FACET_DEPLOY_GAS_LIMIT = 12_000_000;

export type DeploymentResult = {
    address: Address;
    signer: Signer;
};

export type LocalStateMachineDeployer = (signer: Signer) => Promise<Address>;

function logDeployed(
    address: string,
    params: {
        contractName?: string;
        gasUsed?: bigint;
    }
): void {
    const name = params.contractName ?? "<unknown-contract>";
    if (params.gasUsed != null) {
        if (!config.DEBUG_LOCAL_TRANSPORT)
            console.log(
                `Deployed ${name} at ${address} gasUsed=${params.gasUsed.toString()}`
            );
        return;
    }
    if (!config.DEBUG_LOCAL_TRANSPORT)
        console.log(`Deployed ${name} at ${address}`);
}

export async function deployArtifact<T>(
    artifact: Artifact,
    signer: Signer,
    options?: {
        libs?: Record<string, string>;
        args?: any[];
        txOverrides?: ethers.TransactionRequest;
    }
): Promise<{ address: string; contract: T }> {
    const sentTx = await broadcastArtifact(artifact, signer, options);
    const address = await deployedAddress(artifact, sentTx);
    const contract = new ethers.Contract(address, artifact.abi, signer as any);
    return { address, contract: contract as unknown as T };
}

/** Sends `artifact`'s deployment; resolves once the node accepted it. */
async function broadcastArtifact(
    artifact: Artifact,
    signer: Signer,
    options?: {
        libs?: Record<string, string>;
        args?: any[];
        txOverrides?: ethers.TransactionRequest;
    }
): Promise<ethers.TransactionResponse> {
    assertArtifactRuntimeSize(artifact);
    const linkedArtifact = linkLibraries(artifact, options?.libs || {});

    const factory = new ContractFactory(artifact.abi, linkedArtifact.bytecode);
    const deployTx = await factory.getDeployTransaction(
        ...(options?.args || [])
    );
    if (deployTx.data === null || deployTx.data === undefined) {
        throw new Error(
            `Deployment failed: missing transaction data for ${artifact.contractName}`
        );
    }
    assertDeploymentInitcodeSize(
        artifact.contractName,
        ethers.hexlify(deployTx.data)
    );
    const gasLimit =
        options?.txOverrides?.gasLimit ??
        ((await signer.estimateGas(deployTx)) * 12n) / 10n;

    const sentTx = await signer.sendTransaction({
        ...deployTx,
        gasLimit,
        ...options?.txOverrides
    });
    return sentTx;
}

/** The address `sentTx` deployed `artifact` at, once it is mined. */
async function deployedAddress(
    artifact: Artifact,
    sentTx: ethers.TransactionResponse
): Promise<string> {
    const receipt = await sentTx.wait();

    const address = receipt?.contractAddress;
    if (!address) {
        throw new Error(
            `Deployment failed: missing contractAddress in receipt for ${artifact.contractName}`
        );
    }
    logDeployed(address, {
        contractName: artifact.contractName,
        gasUsed: receipt.gasUsed
    });
    return address;
}

async function deployArtifactLocal(
    artifact: Artifact,
    signer: Signer,
    options?: {
        libs?: Record<string, string>;
        args?: any[];
    }
): Promise<Address> {
    const linkedArtifact = linkLibraries(artifact, options?.libs || {});
    const factory = new ContractFactory(
        artifact.abi,
        linkedArtifact.bytecode,
        signer
    );
    const response = await signer.sendTransaction(
        await factory.getDeployTransaction(...(options?.args || []))
    );
    const receipt = await response.wait();
    const address = receipt?.contractAddress;
    if (!address) {
        throw new Error(
            `Local deployment failed: missing contractAddress in receipt for ${artifact.contractName}`
        );
    }
    return address as Address;
}

export async function deployFacets(
    signer: Signer,
    libs: Record<string, string> = {}
): Promise<string[]> {
    // Broadcast one at a time in nonce order, then wait for every receipt
    // together: a concurrent broadcast that stalls or is lost leaves a nonce
    // gap, and every later facet queues behind it forever.
    const sent: ethers.TransactionResponse[] = [];
    for (const artifact of routedFacetArtifacts)
        sent.push(
            await broadcastArtifact(artifact, signer, {
                libs,
                txOverrides: { gasLimit: FACET_DEPLOY_GAS_LIMIT }
            })
        );
    return Promise.all(
        routedFacetArtifacts.map((artifact, index) =>
            deployedAddress(artifact, sent[index])
        )
    );
}

export async function deployFacetsLocal(
    signer: Signer,
    libs: Record<string, string> = {}
): Promise<string[]> {
    return Promise.all(
        routedFacetArtifacts.map((artifact) =>
            deployArtifactLocal(artifact, signer, { libs }).then((address) =>
                address.toString()
            )
        )
    );
}

export type TimeConfig = {
    p2pTime?: number;
    agreementTime?: number;
    chainFallbackTime?: number;
    evidenceTime?: number;
};

export function getTimeConfig(overrides?: TimeConfig): TimeConfig {
    return {
        p2pTime: overrides?.p2pTime ?? 0,
        agreementTime: overrides?.agreementTime ?? 0,
        chainFallbackTime: overrides?.chainFallbackTime ?? 0,
        evidenceTime: overrides?.evidenceTime ?? 0
    };
}

export type DeployFullStackParams = {
    stateMachineArtifact: Artifact;
    consumerFacetArtifact: Artifact;
    stateMachineArgs?: any[];
    consumerFacetArgs?: any[];
    timeConfig?: TimeConfig;
    disputeExecutionGasLimit?: number;
    maxChannelParticipants?: number;
    /** Reuse already-deployed config-independent facets (see `deploy`). */
    facetAddresses?: string[];
};

export async function deploy(
    stateMachineAddress: string,
    consumerFacetAddress: string,
    signer: Signer,
    timeConfigOverrides?: TimeConfig,
    disputeExecutionGasLimit: number = DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT,
    maxChannelParticipants: number = DEFAULT_MAX_CHANNEL_PARTICIPANTS,
    // The dispute/verification facets are stateless and config-independent:
    // a caller that already deployed them (or found them cached on the node)
    // passes their addresses to skip the redeploy — only the proxy carries
    // timeConfig/gas-limit state.
    existingFacetAddresses?: string[]
): Promise<{ address: string; contract: StateChannelManagerInterface }> {
    const facetAddresses =
        existingFacetAddresses ?? (await deployFacets(signer));
    const timeConfig = getTimeConfig(timeConfigOverrides);
    const { address } = await deployArtifact(
        StateChannelManagerProxyArtifact,
        signer,
        {
            args: [
                stateMachineAddress,
                ...facetAddresses,
                consumerFacetAddress,
                timeConfig.p2pTime,
                timeConfig.agreementTime,
                timeConfig.chainFallbackTime,
                timeConfig.evidenceTime,
                disputeExecutionGasLimit,
                maxChannelParticipants
            ]
        }
    );
    // The proxy artifact only carries the selectors the proxy implements itself;
    // the rest are routed to facets, so bind the diamond's full surface here.
    return {
        address,
        contract: connectStateChannelManager(address, signer)
    };
}

export async function deployFullStack(
    signer: Signer,
    params: DeployFullStackParams
): Promise<{ address: string; contract: StateChannelManagerInterface }> {
    const {
        stateMachineArtifact,
        consumerFacetArtifact,
        stateMachineArgs,
        consumerFacetArgs,
        timeConfig,
        disputeExecutionGasLimit,
        maxChannelParticipants,
        facetAddresses
    } = params;

    // in nonce order, as deployFacets: a concurrent send can reach the node
    // before the one below its nonce
    const stateMachineSent = await broadcastArtifact(
        stateMachineArtifact,
        signer,
        { args: stateMachineArgs }
    );
    const consumerFacetSent = await broadcastArtifact(
        consumerFacetArtifact,
        signer,
        { args: consumerFacetArgs }
    );
    const [stateMachineAddress, consumerFacetAddress] = await Promise.all([
        deployedAddress(stateMachineArtifact, stateMachineSent),
        deployedAddress(consumerFacetArtifact, consumerFacetSent)
    ]);

    return deploy(
        stateMachineAddress,
        consumerFacetAddress,
        signer,
        timeConfig,
        disputeExecutionGasLimit,
        maxChannelParticipants,
        facetAddresses
    );
}

export async function deployLocalDiamond(
    deployStateMachine: LocalStateMachineDeployer,
    signer: Signer,
    timeConfigOverrides?: TimeConfig,
    disputeExecutionGasLimit: number = DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT,
    maxChannelParticipants: number = DEFAULT_MAX_CHANNEL_PARTICIPANTS
): Promise<DeploymentResult> {
    const facetAddresses = await deployFacetsLocal(signer);

    const stateMachineAddress = (await deployStateMachine(signer)).toString();

    const timeConfig = getTimeConfig(timeConfigOverrides);

    const diamondAddress = await deployArtifactLocal(
        LocalDiamondArtifact,
        signer,
        {
            args: [
                stateMachineAddress,
                ...facetAddresses,
                ethers.ZeroAddress,
                timeConfig.p2pTime,
                timeConfig.agreementTime,
                timeConfig.chainFallbackTime,
                timeConfig.evidenceTime,
                disputeExecutionGasLimit,
                maxChannelParticipants
            ]
        }
    );

    return { address: diamondAddress, signer };
}

/**
 * Puts `runtimeCode` (the deployed consumer facet's code) at a new local
 * address: an initcode that returns the code verbatim. Code that calls
 * linked libraries would need them too, so only self-contained code works.
 */
async function installRuntimeCodeLocal(
    signer: Signer,
    runtimeCode: BytesLike
): Promise<string> {
    const code = ethers.getBytes(runtimeCode);
    // PUSH2 len, DUP1, PUSH1 12, PUSH1 0, CODECOPY, PUSH1 0, RETURN
    const initcode = ethers.concat([
        "0x61",
        ethers.toBeHex(code.length, 2),
        "0x80600c6000396000f3",
        code
    ]);
    const receipt = await (
        await signer.sendTransaction({ data: initcode })
    ).wait();
    if (!receipt?.contractAddress)
        throw new Error("Local consumer facet code install failed");
    return receipt.contractAddress;
}

export async function deployLocalDiamondWithStateMachineAddress(
    stateMachineAddress: Address,
    signer: Signer,
    consumerFacetCode: BytesLike,
    timeConfigOverrides?: TimeConfig,
    disputeExecutionGasLimit: number = DEFAULT_DISPUTE_EXECUTION_GAS_LIMIT,
    maxChannelParticipants: number = DEFAULT_MAX_CHANNEL_PARTICIPANTS
): Promise<DeploymentResult> {
    const facetAddresses = await deployFacetsLocal(signer);
    const consumerFacetAddress = await installRuntimeCodeLocal(
        signer,
        consumerFacetCode
    );
    const timeConfig = getTimeConfig(timeConfigOverrides);

    const diamondAddress = await deployArtifactLocal(
        LocalDiamondArtifact,
        signer,
        {
            args: [
                stateMachineAddress.toString(),
                ...facetAddresses,
                consumerFacetAddress,
                timeConfig.p2pTime,
                timeConfig.agreementTime,
                timeConfig.chainFallbackTime,
                timeConfig.evidenceTime,
                disputeExecutionGasLimit,
                maxChannelParticipants
            ]
        }
    );

    return { address: diamondAddress, signer };
}

export function linkLibraries(
    artifact: Artifact,
    libs: Record<string, string>
): Artifact {
    let linkedBytecode = artifact.bytecode;

    // Iterate over each source path in linkReferences
    for (const sourcePath in artifact.linkReferences) {
        const libraries = artifact.linkReferences[sourcePath];

        // Iterate over each library name under the source path
        for (const libName in libraries) {
            const deployedAddress = libs[libName];
            if (!deployedAddress) {
                throw new Error(
                    `Missing deployed address for library '${libName}'`
                );
            }

            // Replace each occurrence using the exact byte positions
            for (const { start, length } of libraries[libName]) {
                const addressWithoutPrefix = deployedAddress
                    .toLowerCase()
                    .replace(/^0x/, "");
                linkedBytecode =
                    linkedBytecode.substring(0, 2 + start * 2) +
                    addressWithoutPrefix +
                    linkedBytecode.substring(2 + (start + length) * 2);
            }
        }
    }

    return { ...artifact, bytecode: linkedBytecode };
}
