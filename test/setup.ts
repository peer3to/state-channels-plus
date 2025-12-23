import { ethers } from "hardhat";
import Clock from "@/Clock";
import { initLogging } from "@/utils/logging";

// Global test setup to ensure Clock is always initialized
before(async function () {
    await Clock.init(ethers.provider);

    initLogging();
});
