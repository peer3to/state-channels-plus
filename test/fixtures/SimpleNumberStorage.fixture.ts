import { ethers } from "hardhat";
import { HardhatEthersHelpers } from "@nomicfoundation/hardhat-ethers/types";

export async function getSimpleNumberStorageDeploymentTransaction(
    _ethers: typeof ethers & HardhatEthersHelpers
) {
    const SimpleNumberStorageFactory = await _ethers.getContractFactory(
        "SimpleNumberStorage"
    );
    return await SimpleNumberStorageFactory.getDeployTransaction();
}

export async function getSimpleNumberStorageFactory(
    _ethers: typeof ethers & HardhatEthersHelpers
) {
    return await _ethers.getContractFactory("SimpleNumberStorage");
}
