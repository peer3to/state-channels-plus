import { ethers, ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import { AStateChannelManagerProxy } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy";
import { AStateMachine } from "../../typechain-types/contracts/V1/AStateMachine";

// Load artifacts manually for pure ethers
import StateChannelUtilLibraryArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateChannelUtilLibrary.sol/StateChannelUtilLibrary.json";
import DisputeManagerFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol/DisputeManagerFacet.json";
import FraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol/FraudProofFacet.json";
import DisputeFraudProofFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol/DisputeFraudProofFacet.json";
import StateSnapshotFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol/StateSnapshotFacet.json";
import JoinChannelFacetArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol/JoinChannelFacet.json";
import MathStateMachineArtifact from "../../artifacts/contracts/V1/examples/MathStateMachine/MathStateMachine.sol/MathStateMachine.json";
import AStateChannelManagerProxyArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy.sol/AStateChannelManagerProxy.json";

export interface DeploymentResult {
    diamond: AStateChannelManagerProxy;
    stateMachine: AStateMachine;
}

export interface DeploymentConfig {
    provider: JsonRpcProvider;
    signer: Wallet;
    rpcUrl?: string;
}

/**
 * Deploy the StateChannelUtilLibrary first since other contracts depend on it
 */
async function deployStateChannelUtilLibrary(config: DeploymentConfig) {
    const StateChannelUtilLibraryFactory = new ContractFactory(
        StateChannelUtilLibraryArtifact.abi,
        StateChannelUtilLibraryArtifact.bytecode,
        config.signer
    );
    const stateChannelUtilLibrary =
        await StateChannelUtilLibraryFactory.deploy();
    await stateChannelUtilLibrary.waitForDeployment();

    return stateChannelUtilLibrary;
}

/**
 * UNIVERSAL deployment function that deploys all facets and the diamond proxy
 * This is the ONLY universal function - works for ANY consumer facet implementation
 * For local testing, pass ethers.ZeroAddress as consumerFacetAddress
 * @param consumerFacetAddress The address of the consumer facet implementation (or 0x00 for local)
 * @param config Deployment configuration with provider and signer
 * @returns DeploymentResult containing diamond and state machine
 */
export async function deployUniversal(
    consumerFacetAddress: string,
    config: DeploymentConfig
): Promise<DeploymentResult> {
    const stateChannelUtilLibrary = await deployStateChannelUtilLibrary(config);

    const DisputeManagerFacetFactory = new ContractFactory(
        DisputeManagerFacetArtifact.abi,
        DisputeManagerFacetArtifact.bytecode,
        config.signer
    );
    const disputeManagerFacet = await DisputeManagerFacetFactory.deploy();
    await disputeManagerFacet.waitForDeployment();
    console.log(
        `DisputeManagerFacet deployed at: ${await disputeManagerFacet.getAddress()}`
    );

    const FraudProofFacetFactory = new ContractFactory(
        FraudProofFacetArtifact.abi,
        FraudProofFacetArtifact.bytecode,
        config.signer
    );
    const fraudProofFacet = await FraudProofFacetFactory.deploy();
    await fraudProofFacet.waitForDeployment();
    console.log(
        `FraudProofFacet deployed at: ${await fraudProofFacet.getAddress()}`
    );

    const DisputeFraudProofFacetFactory = new ContractFactory(
        DisputeFraudProofFacetArtifact.abi,
        DisputeFraudProofFacetArtifact.bytecode,
        config.signer
    );
    const disputeFraudProofFacet = await DisputeFraudProofFacetFactory.deploy();
    await disputeFraudProofFacet.waitForDeployment();
    console.log(
        `DisputeFraudProofFacet deployed at: ${await disputeFraudProofFacet.getAddress()}`
    );

    const StateSnapshotFacetFactory = new ContractFactory(
        StateSnapshotFacetArtifact.abi,
        StateSnapshotFacetArtifact.bytecode,
        config.signer
    );
    const stateSnapshotFacet = await StateSnapshotFacetFactory.deploy();
    await stateSnapshotFacet.waitForDeployment();
    console.log(
        `StateSnapshotFacet deployed at: ${await stateSnapshotFacet.getAddress()}`
    );

    const JoinChannelFacetFactory = new ContractFactory(
        JoinChannelFacetArtifact.abi,
        JoinChannelFacetArtifact.bytecode,
        config.signer
    );
    const joinChannelFacet = await JoinChannelFacetFactory.deploy();
    await joinChannelFacet.waitForDeployment();

    // Deploy state machine
    console.log("Deploying state machine...");
    const MathStateMachineFactory = new ContractFactory(
        MathStateMachineArtifact.abi,
        MathStateMachineArtifact.bytecode,
        config.signer
    );
    // MathStateMachine constructor takes a gas limit parameter
    const stateMachine = await MathStateMachineFactory.deploy(5000000); // 5M gas limit
    await stateMachine.waitForDeployment();
    console.log(`StateMachine deployed at: ${await stateMachine.getAddress()}`);

    // Deploy concrete diamond (no library linking needed)
    console.log("Deploying diamond proxy...");
    const AStateChannelManagerProxyFactory = new ContractFactory(
        AStateChannelManagerProxyArtifact.abi,
        AStateChannelManagerProxyArtifact.bytecode,
        config.signer
    );
    const diamond = await AStateChannelManagerProxyFactory.deploy(
        await stateMachine.getAddress(),
        await disputeManagerFacet.getAddress(),
        await fraudProofFacet.getAddress(),
        await disputeFraudProofFacet.getAddress(),
        await stateSnapshotFacet.getAddress(),
        await joinChannelFacet.getAddress(),
        consumerFacetAddress
    );
    await diamond.waitForDeployment();
    console.log(`Diamond deployed at: ${await diamond.getAddress()}`);

    const result: DeploymentResult = {
        diamond: diamond as unknown as AStateChannelManagerProxy,
        stateMachine: stateMachine as unknown as AStateMachine
    };

    console.log("Universal deployment completed successfully!");
    console.log("Deployment Summary:");
    console.log(`- Diamond Proxy: ${await diamond.getAddress()}`);
    console.log(`- State Machine: ${await stateMachine.getAddress()}`);
    console.log(`- Consumer Facet: ${consumerFacetAddress}`);

    return result;
}

/**
 * Helper function to create deployment config for different environments
 */
export function createDeploymentConfig(
    rpcUrl: string,
    privateKey: string
): DeploymentConfig {
    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(privateKey, provider);

    return {
        provider,
        signer,
        rpcUrl
    };
}
