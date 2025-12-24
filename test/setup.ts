import { ethers } from "hardhat";
import Clock from "@/Clock";

// Global test setup to ensure Clock is always initialized
before(async function () {
    await Clock.init(ethers.provider);

    // Ensure the chain has enough history for tests that query logs "N blocks back".
    await ethers.provider.send("hardhat_mine", ["0x64"]); // 100 blocks
});
