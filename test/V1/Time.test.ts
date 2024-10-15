import { ethers as EH } from "hardhat";
import { JsonRpcProvider, ethers } from "ethers";

describe("Time", function () {
    return;
    const checkTime = async (provider: ethers.JsonRpcProvider) => {
        let currentTimestamp = Math.floor(Date.now() / 1000);
        let latestBlock = await provider.getBlock("latest");
        let blockNumber = latestBlock!.number;
        let latestTimestamp = latestBlock!.timestamp;
        let averageBlockTime = 0;
        let blockCnt = 10;
        for (let i = 1; i <= blockCnt; i++) {
            if (blockNumber - i < 0) {
                blockCnt = i;
                break;
            }
            let block = await provider.getBlock(blockNumber - i);
            averageBlockTime += latestTimestamp - block!.timestamp;
            latestTimestamp = block!.timestamp;
        }

        averageBlockTime /= blockCnt;
        console.log("Average block time:", averageBlockTime);
        console.log("Current timestamp:", currentTimestamp);
        console.log("Latest block timestamp:", latestBlock!.timestamp);
        console.log("Difference:", currentTimestamp - latestBlock!.timestamp);
    };

    it("local provider", async function () {
        let provider = EH.provider;
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("AVAX provider", async function () {
        let provider = new JsonRpcProvider(
            "https://api.avax.network/ext/bc/C/rpc"
        );
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Polygon ZKEVM provider", async function () {
        let provider = new JsonRpcProvider(
            "https://rpc.ankr.com/polygon_zkevm"
        );
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Astar ZKEVM provider", async function () {
        let provider = new JsonRpcProvider(
            "https://rpc.startale.com/astar-zkevm"
        );
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Moonbeam provider", async function () {
        let provider = new JsonRpcProvider("https://rpc.api.moonbeam.network");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("EVMOS provider", async function () {
        let provider = new JsonRpcProvider(
            "https://evmos-evm-rpc.publicnode.com"
        );
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Arbitrum One provider", async function () {
        let provider = new JsonRpcProvider("https://arb1.arbitrum.io/rpc");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Arbitrum Nova provider", async function () {
        let provider = new JsonRpcProvider("https://nova.arbitrum.io/rpc");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Shimmer provider", async function () {
        let provider = new JsonRpcProvider(
            "https://json-rpc.evm.shimmer.network"
        );
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Fantom provider", async function () {
        let provider = new JsonRpcProvider("https://rpc.ankr.com/fantom/");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("BSC provider", async function () {
        let provider = new JsonRpcProvider("https://rpc.ankr.com/bsc");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Celo provider", async function () {
        let provider = new JsonRpcProvider("https://rpc.ankr.com/celo");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Scroll provider", async function () {
        let provider = new JsonRpcProvider("https://rpc.ankr.com/scroll");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    it("Taiko provider", async function () {
        let provider = new JsonRpcProvider("https://rpc.ankr.com/taiko_katla");
        await checkTime(provider as unknown as ethers.JsonRpcProvider);
    });

    // it("Tenderly DevNet provider", async function () {
    //     let provider = new JsonRpcProvider(
    //         "https://rpc.vnet.tenderly.co/devnet/my-first-devnet/51eab80b-b812-4824-992e-ab358c5f478e"
    //     );
    //     await checkTime(provider as unknown as ethers.JsonRpcProvider);
    // });
});
