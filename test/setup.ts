import { ethers } from "hardhat";
import Clock from "@/Clock";

// Global test setup to ensure Clock is always initialized
before(async function () {
    console.log("Global test setup: Initializing Clock and mining blocks...");
    // Ensure the chain has enough history for tests that query logs "N blocks back".
    await ethers.provider.send("evm_setAutomine", [false]);
    await ethers.provider.send("evm_setIntervalMining", [2000]); // ms
    await ethers.provider.send("hardhat_mine", ["0x64"]); // 100 blocks
    await Clock.init(ethers.provider);

    // TODO - this file can be deleted - it's not used anywhere
});
