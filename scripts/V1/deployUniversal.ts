import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";
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
import LocalDiamondArtifact from "../../artifacts/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol/LocalDiamond.json";

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
 * @param consumerFacetAddress The address of the consumer facet implementation (or 0x00 for local)
 * @param config Deployment configuration with provider and signer
 * @returns DeploymentResult containing diamond and state machine
 */
export async function deployUniversal(
    consumerFacetAddress: string,
    config: DeploymentConfig
): Promise<DeploymentResult> {
    // Deploy the library first since other contracts depend on it
    const stateChannelUtilLibrary = await deployStateChannelUtilLibrary(config);
    const libraryAddress = await stateChannelUtilLibrary.getAddress();

    // Library placeholder that needs to be replaced in bytecode
    const placeholder = new RegExp(
        "__\\$a7bb0527a0afa4608b604803fa485abfbd\\$__",
        "g"
    );
    const libraryAddressWithoutPrefix = libraryAddress.slice(2); // Remove 0x prefix

    const linkBytecode = (bytecode: string) =>
        bytecode.replace(placeholder, libraryAddressWithoutPrefix);

    // Deploy DisputeManagerFacet with linked bytecode
    const linkedDisputeManagerBytecode = linkBytecode(
        DisputeManagerFacetArtifact.bytecode
    );
    const DisputeManagerFacetFactory = new ContractFactory(
        DisputeManagerFacetArtifact.abi,
        linkedDisputeManagerBytecode,
        config.signer
    );
    const disputeManagerFacet = await DisputeManagerFacetFactory.deploy();
    await disputeManagerFacet.waitForDeployment();

    // Deploy FraudProofFacet with linked bytecode
    const linkedFraudProofBytecode = linkBytecode(
        FraudProofFacetArtifact.bytecode
    );
    const FraudProofFacetFactory = new ContractFactory(
        FraudProofFacetArtifact.abi,
        linkedFraudProofBytecode,
        config.signer
    );
    const fraudProofFacet = await FraudProofFacetFactory.deploy();
    await fraudProofFacet.waitForDeployment();

    // Deploy DisputeFraudProofFacet with linked bytecode
    const linkedDisputeFraudProofBytecode = linkBytecode(
        DisputeFraudProofFacetArtifact.bytecode
    );
    const DisputeFraudProofFacetFactory = new ContractFactory(
        DisputeFraudProofFacetArtifact.abi,
        linkedDisputeFraudProofBytecode,
        config.signer
    );
    const disputeFraudProofFacet = await DisputeFraudProofFacetFactory.deploy();
    await disputeFraudProofFacet.waitForDeployment();

    // Deploy StateSnapshotFacet with linked bytecode
    const linkedStateSnapshotBytecode = linkBytecode(
        StateSnapshotFacetArtifact.bytecode
    );
    const StateSnapshotFacetFactory = new ContractFactory(
        StateSnapshotFacetArtifact.abi,
        linkedStateSnapshotBytecode,
        config.signer
    );
    const stateSnapshotFacet = await StateSnapshotFacetFactory.deploy();
    await stateSnapshotFacet.waitForDeployment();

    // Deploy JoinChannelFacet with linked bytecode
    const linkedJoinChannelBytecode = linkBytecode(
        JoinChannelFacetArtifact.bytecode
    );
    const JoinChannelFacetFactory = new ContractFactory(
        JoinChannelFacetArtifact.abi,
        linkedJoinChannelBytecode,
        config.signer
    );
    const joinChannelFacet = await JoinChannelFacetFactory.deploy();
    await joinChannelFacet.waitForDeployment();

    // Deploy state machine (no library dependency)
    const MathStateMachineFactory = new ContractFactory(
        MathStateMachineArtifact.abi,
        MathStateMachineArtifact.bytecode,
        config.signer
    );
    const stateMachine = await MathStateMachineFactory.deploy(5000000); // 5M gas limit
    await stateMachine.waitForDeployment();

    // Deploy diamond - conditional logic for LocalDiamond vs AStateChannelManagerProxy

    let diamond;
    if (consumerFacetAddress === "0x0000000000000000000000000000000000000000") {
        // Deploy LocalDiamond for testing (no consumer facet)
        const LocalDiamondFactory = new ContractFactory(
            LocalDiamondArtifact.abi,
            LocalDiamondArtifact.bytecode,
            config.signer
        );
        diamond = await LocalDiamondFactory.deploy(
            await stateMachine.getAddress(),
            await disputeManagerFacet.getAddress(),
            await fraudProofFacet.getAddress(),
            await disputeFraudProofFacet.getAddress(),
            await stateSnapshotFacet.getAddress(),
            await joinChannelFacet.getAddress()
        );
    } else {
        // Deploy regular AStateChannelManagerProxy with consumer facet
        const AStateChannelManagerProxyFactory = new ContractFactory(
            AStateChannelManagerProxyArtifact.abi,
            AStateChannelManagerProxyArtifact.bytecode,
            config.signer
        );
        diamond = await AStateChannelManagerProxyFactory.deploy(
            await stateMachine.getAddress(),
            await disputeManagerFacet.getAddress(),
            await fraudProofFacet.getAddress(),
            await disputeFraudProofFacet.getAddress(),
            await stateSnapshotFacet.getAddress(),
            await joinChannelFacet.getAddress(),
            consumerFacetAddress
        );
    }

    await diamond.waitForDeployment();

    const result: DeploymentResult = {
        diamond: diamond as unknown as AStateChannelManagerProxy,
        stateMachine: stateMachine as unknown as AStateMachine
    };

    return result;
}
