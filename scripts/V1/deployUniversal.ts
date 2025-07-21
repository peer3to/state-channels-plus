import { ethers } from "hardhat";
import { AStateChannelManagerProxy } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/AStateChannelManagerProxy";
import { DisputeManagerFacet } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet";
import { FraudProofFacet } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/FraudProofFacet";
import { DisputeFraudProofFacet } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet";
import { StateSnapshotFacet } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet";
import { JoinChannelFacet } from "../../typechain-types/contracts/V1/StateChannelDiamondProxy/JoinChannelFacet";
import { AStateMachine } from "../../typechain-types/contracts/V1/AStateMachine";

export interface DeploymentResult {
    diamond: AStateChannelManagerProxy;
    stateMachine: AStateMachine;
    disputeManagerFacet: DisputeManagerFacet;
    fraudProofFacet: FraudProofFacet;
    disputeFraudProofFacet: DisputeFraudProofFacet;
    stateSnapshotFacet: StateSnapshotFacet;
    joinChannelFacet: JoinChannelFacet;
    consumerFacet: any; // Type depends on the specific implementation
}

/**
 * Deploy the StateChannelUtilLibrary first since other contracts depend on it
 */
async function deployStateChannelUtilLibrary() {
    console.log("Deploying StateChannelUtilLibrary...");
    const StateChannelUtilLibraryFactory = await ethers.getContractFactory(
        "StateChannelUtilLibrary"
    );
    const stateChannelUtilLibrary =
        await StateChannelUtilLibraryFactory.deploy();
    await stateChannelUtilLibrary.waitForDeployment();
    console.log(
        `StateChannelUtilLibrary deployed at: ${await stateChannelUtilLibrary.getAddress()}`
    );
    return stateChannelUtilLibrary;
}

/**
 * Universal deployment function that deploys all facets and the diamond proxy
 * @param consumerFacetAddress The address of the consumer facet implementation
 * @returns DeploymentResult containing all deployed contracts
 */
export async function deployUniversal(
    consumerFacetAddress: string
): Promise<DeploymentResult> {
    console.log("Starting universal deployment...");
    console.log(`Consumer Facet Address: ${consumerFacetAddress}`);

    // Deploy StateChannelUtilLibrary first
    const stateChannelUtilLibrary = await deployStateChannelUtilLibrary();

    // Deploy all facets with library linking
    console.log("Deploying facets...");

    const DisputeManagerFacetFactory = await ethers.getContractFactory(
        "DisputeManagerFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const disputeManagerFacet = await DisputeManagerFacetFactory.deploy();
    await disputeManagerFacet.waitForDeployment();
    console.log(
        `DisputeManagerFacet deployed at: ${await disputeManagerFacet.getAddress()}`
    );

    const FraudProofFacetFactory = await ethers.getContractFactory(
        "FraudProofFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const fraudProofFacet = await FraudProofFacetFactory.deploy();
    await fraudProofFacet.waitForDeployment();
    console.log(
        `FraudProofFacet deployed at: ${await fraudProofFacet.getAddress()}`
    );

    const DisputeFraudProofFacetFactory = await ethers.getContractFactory(
        "DisputeFraudProofFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const disputeFraudProofFacet = await DisputeFraudProofFacetFactory.deploy();
    await disputeFraudProofFacet.waitForDeployment();
    console.log(
        `DisputeFraudProofFacet deployed at: ${await disputeFraudProofFacet.getAddress()}`
    );

    const StateSnapshotFacetFactory =
        await ethers.getContractFactory("StateSnapshotFacet");
    const stateSnapshotFacet = await StateSnapshotFacetFactory.deploy();
    await stateSnapshotFacet.waitForDeployment();
    console.log(
        `StateSnapshotFacet deployed at: ${await stateSnapshotFacet.getAddress()}`
    );

    const JoinChannelFacetFactory = await ethers.getContractFactory(
        "JoinChannelFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const joinChannelFacet = await JoinChannelFacetFactory.deploy();
    await joinChannelFacet.waitForDeployment();

    // Deploy state machine
    console.log("Deploying state machine...");
    const [deployer] = await ethers.getSigners();
    const MathStateMachineFactory = await ethers.getContractFactory(
        "MathStateMachine",
        deployer
    );
    const stateMachine = await MathStateMachineFactory.deploy(5000000); // 5M gas limit
    await stateMachine.waitForDeployment();
    console.log(`StateMachine deployed at: ${await stateMachine.getAddress()}`);

    // Deploy concrete diamond with library linking
    console.log("Deploying diamond proxy...");
    const AStateChannelManagerProxyFactory = await ethers.getContractFactory(
        "AStateChannelManagerProxy",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
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

    // Get the consumer facet contract instance
    const consumerFacet = await ethers.getContractAt(
        "ConsumerFacet",
        consumerFacetAddress
    );

    const result: DeploymentResult = {
        diamond,
        stateMachine,
        disputeManagerFacet,
        fraudProofFacet,
        disputeFraudProofFacet,
        stateSnapshotFacet,
        joinChannelFacet,
        consumerFacet
    };

    console.log("Universal deployment completed successfully!");
    console.log("Deployment Summary:");
    console.log(`- Diamond Proxy: ${await diamond.getAddress()}`);
    console.log(`- State Machine: ${await stateMachine.getAddress()}`);
    console.log(`- Consumer Facet: ${consumerFacetAddress}`);
    console.log(
        `- DisputeManagerFacet: ${await disputeManagerFacet.getAddress()}`
    );
    console.log(`- FraudProofFacet: ${await fraudProofFacet.getAddress()}`);
    console.log(
        `- DisputeFraudProofFacet: ${await disputeFraudProofFacet.getAddress()}`
    );
    console.log(
        `- StateSnapshotFacet: ${await stateSnapshotFacet.getAddress()}`
    );
    console.log(`- JoinChannelFacet: ${await joinChannelFacet.getAddress()}`);

    return result;
}

/**
 * Deploy a specific consumer facet implementation
 * @param consumerFacetName The name of the consumer facet contract to deploy
 * @returns The deployed consumer facet contract
 */
export async function deployConsumerFacet(
    consumerFacetName: string
): Promise<any> {
    console.log(`Deploying consumer facet: ${consumerFacetName}`);

    // Deploy StateChannelUtilLibrary first if needed
    const stateChannelUtilLibrary = await deployStateChannelUtilLibrary();

    const ConsumerFacetFactory = await ethers.getContractFactory(
        consumerFacetName,
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const consumerFacet = await ConsumerFacetFactory.deploy();
    await consumerFacet.waitForDeployment();

    console.log(
        `${consumerFacetName} deployed at: ${await consumerFacet.getAddress()}`
    );
    return consumerFacet;
}

/**
 * Deploy the complete system with a specific consumer facet
 * @param consumerFacetName The name of the consumer facet contract to deploy
 * @returns DeploymentResult containing all deployed contracts
 */
export async function deployUniversalWithConsumerFacet(
    consumerFacetName: string
): Promise<DeploymentResult> {
    // First deploy the consumer facet
    const consumerFacet = await deployConsumerFacet(consumerFacetName);

    // Then deploy the universal system with the consumer facet address
    return await deployUniversal(await consumerFacet.getAddress());
}

// Example usage for Math implementation
export async function deployMathSystem(): Promise<DeploymentResult> {
    return await deployUniversalWithConsumerFacet("MathConsumerFacet");
}

// Example usage for LocalDiamond (for testing)
export async function deployLocalSystem(): Promise<DeploymentResult> {
    console.log("Deploying local system with LocalDiamond...");

    // Deploy StateChannelUtilLibrary first
    const stateChannelUtilLibrary = await deployStateChannelUtilLibrary();

    // Deploy all facets with library linking
    const DisputeManagerFacetFactory = await ethers.getContractFactory(
        "DisputeManagerFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const disputeManagerFacet = await DisputeManagerFacetFactory.deploy();
    await disputeManagerFacet.waitForDeployment();

    const FraudProofFacetFactory = await ethers.getContractFactory(
        "FraudProofFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const fraudProofFacet = await FraudProofFacetFactory.deploy();
    await fraudProofFacet.waitForDeployment();

    const DisputeFraudProofFacetFactory = await ethers.getContractFactory(
        "DisputeFraudProofFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const disputeFraudProofFacet = await DisputeFraudProofFacetFactory.deploy();
    await disputeFraudProofFacet.waitForDeployment();

    const StateSnapshotFacetFactory =
        await ethers.getContractFactory("StateSnapshotFacet");
    const stateSnapshotFacet = await StateSnapshotFacetFactory.deploy();
    await stateSnapshotFacet.waitForDeployment();

    const JoinChannelFacetFactory = await ethers.getContractFactory(
        "JoinChannelFacet",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const joinChannelFacet = await JoinChannelFacetFactory.deploy();
    await joinChannelFacet.waitForDeployment();

    // Deploy state machine
    const [deployer] = await ethers.getSigners();
    const MathStateMachineFactory = await ethers.getContractFactory(
        "MathStateMachine",
        deployer
    );
    const stateMachine = await MathStateMachineFactory.deploy(5000000); // 5M gas limit
    await stateMachine.waitForDeployment();

    // Deploy LocalDiamond with library linking
    const LocalDiamondFactory = await ethers.getContractFactory(
        "LocalDiamond",
        {
            libraries: {
                StateChannelUtilLibrary:
                    await stateChannelUtilLibrary.getAddress()
            }
        }
    );
    const localDiamond = await LocalDiamondFactory.deploy(
        await stateMachine.getAddress(),
        await disputeManagerFacet.getAddress(),
        await fraudProofFacet.getAddress(),
        await disputeFraudProofFacet.getAddress(),
        await stateSnapshotFacet.getAddress(),
        await joinChannelFacet.getAddress()
    );
    await localDiamond.waitForDeployment();

    console.log(`LocalDiamond deployed at: ${await localDiamond.getAddress()}`);

    return {
        diamond: localDiamond as any, // Cast to AStateChannelManagerProxy type
        stateMachine,
        disputeManagerFacet,
        fraudProofFacet,
        disputeFraudProofFacet,
        stateSnapshotFacet,
        joinChannelFacet,
        consumerFacet: null // LocalDiamond doesn't use a consumer facet
    };
}

// Main function for direct execution
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying contracts with the account:",
        await deployer.getAddress()
    );

    // Example: Deploy Math system
    const result = await deployMathSystem();

    console.log("Deployment completed!");
    console.log("Diamond address:", await result.diamond.getAddress());
}

// Execute if this script is run directly
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
