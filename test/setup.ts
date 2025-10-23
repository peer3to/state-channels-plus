import { ethers } from "hardhat";
import Clock from "@/Clock";

// Global test setup to ensure Clock is always initialized
before(async function () {
    await Clock.init(ethers.provider);
});
