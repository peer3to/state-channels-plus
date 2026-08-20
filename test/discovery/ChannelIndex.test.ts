import { expect } from "chai";
import { ethers } from "ethers";

import { createLogger } from "@/utils";
import { StateChannelManagerProxy__factory } from "@typechain-types";
import {
    ChannelIndex,
    type ChannelIndexContract,
    type ChannelIndexProvider,
    type ChannelScanLog
} from "@/discovery/ChannelIndex";

/**
 * Real ABI (via typechain), so the topic hashes this test canns up are the
 * actual on-chain topic hashes - not hand-picked strings that could drift
 * from the contract.
 */
const contractInterface = StateChannelManagerProxy__factory.createInterface();
const CHANNEL_OPENED_TOPIC =
    contractInterface.getEvent("ChannelOpened")!.topicHash;
const CHANNEL_STORAGE_CLEARED_TOPIC = contractInterface.getEvent(
    "ChannelStorageCleared"
)!.topicHash;

const CONTRACT_ADDRESS = ethers.getAddress("0x" + "42".repeat(20));

function channelId(seed: number): string {
    return ethers.zeroPadValue(ethers.toBeHex(seed), 32);
}

function openedLog(
    channelIdHex: string,
    blockNumber: number,
    index = 0
): ChannelScanLog {
    return {
        address: CONTRACT_ADDRESS,
        topics: [CHANNEL_OPENED_TOPIC, channelIdHex],
        blockNumber,
        index,
        transactionHash: ethers.hexlify(ethers.randomBytes(32))
    };
}

function clearedLog(
    channelIdHex: string,
    blockNumber: number,
    index = 0
): ChannelScanLog {
    return {
        address: CONTRACT_ADDRESS,
        topics: [CHANNEL_STORAGE_CLEARED_TOPIC, channelIdHex],
        blockNumber,
        index,
        transactionHash: ethers.hexlify(ethers.randomBytes(32))
    };
}

function createLoggerForTest() {
    return createLogger({}, {}, { level: "error" });
}

/**
 * Narrow fake provider (test/AGENTS.md: a provider is an external boundary).
 * `respond` decides, per getLogs call, whether to return canned logs or throw
 * a canned error - lets a test script a range-limit rejection deterministically.
 */
function makeFakeProvider(
    latestBlock: number,
    respond: (fromBlock: number, toBlock: number) => ChannelScanLog[] | Error
): ChannelIndexProvider & {
    calls: { fromBlock: number; toBlock: number }[];
} {
    const calls: { fromBlock: number; toBlock: number }[] = [];
    return {
        calls,
        getBlockNumber: async () => latestBlock,
        getLogs: async (filter) => {
            const fromBlock = Number(filter.fromBlock);
            const toBlock = Number(filter.toBlock);
            calls.push({ fromBlock, toBlock });
            const result = respond(fromBlock, toBlock);
            if (result instanceof Error) throw result;
            return result;
        }
    };
}

/**
 * Narrow fake contract. `isChannelOpen` is the only network-dependent method
 * this module calls on the contract - the ABI-derived bits (`target`,
 * `interface.getEvent`) come from the real typechain interface above.
 */
function makeFakeContract(
    openChannelKeys: Set<string> = new Set()
): ChannelIndexContract {
    return {
        target: CONTRACT_ADDRESS,
        interface: {
            getEvent: (name) => contractInterface.getEvent(name)
        },
        isChannelOpen: async (id) => {
            const key = ethers.hexlify(id).toLowerCase();
            return [openChannelKeys.has(key), {}] as const;
        }
    };
}

function allOpen(ids: string[]): Set<string> {
    return new Set(ids.map((id) => id.toLowerCase()));
}

describe("ChannelIndex", () => {
    it("returns confirmed-open candidates newest-first", async () => {
        const idOld = channelId(1);
        const idMid = channelId(2);
        const idNew = channelId(3);

        const provider = makeFakeProvider(100, (fromBlock, toBlock) => [
            openedLog(idOld, 10),
            openedLog(idMid, 50),
            openedLog(idNew, 90)
        ]);
        const contract = makeFakeContract(allOpen([idOld, idMid, idNew]));

        const index = new ChannelIndex({
            provider,
            stateChannelManagerContract: contract,
            logger: createLoggerForTest()
        });

        const result = await index.listOpenChannels({
            max: 10,
            maxLookbackBlocks: 100,
            chunkBlocks: 1000
        });

        expect(result).to.deep.equal([idNew, idMid, idOld]);
    });

    it("stops early once `max` confirmed candidates are collected", async () => {
        const ids = [channelId(1), channelId(2), channelId(3), channelId(4)];

        const provider = makeFakeProvider(100, () =>
            ids.map((id, i) => openedLog(id, 10 + i * 10))
        );
        const contract = makeFakeContract(allOpen(ids));

        const index = new ChannelIndex({
            provider,
            stateChannelManagerContract: contract,
            logger: createLoggerForTest()
        });

        const result = await index.listOpenChannels({
            max: 2,
            maxLookbackBlocks: 100,
            chunkBlocks: 1000
        });

        // The two newest of the four.
        expect(result).to.deep.equal([ids[3], ids[2]]);
    });

    it("never scans past the lookback floor", async () => {
        const idInRange = channelId(1);
        const idBeforeFloor = channelId(2);

        const latestBlock = 1000;
        const maxLookbackBlocks = 50;
        const floor = latestBlock - maxLookbackBlocks;

        const provider = makeFakeProvider(latestBlock, (fromBlock, toBlock) => {
            expect(fromBlock).to.be.at.least(floor);
            if (toBlock >= floor && fromBlock <= latestBlock - 10) {
                return [openedLog(idInRange, latestBlock - 10)];
            }
            return [];
        });
        // idBeforeFloor would only ever surface from a query below the
        // floor, which the provider assertion above forbids - present here
        // purely as documentation of intent, never actually returned.
        const contract = makeFakeContract(allOpen([idInRange, idBeforeFloor]));

        const index = new ChannelIndex({
            provider,
            stateChannelManagerContract: contract,
            logger: createLoggerForTest()
        });

        const result = await index.listOpenChannels({
            max: 10,
            maxLookbackBlocks,
            chunkBlocks: 10
        });

        expect(result).to.deep.equal([idInRange]);
        for (const call of provider.calls) {
            expect(call.fromBlock).to.be.at.least(floor);
        }
    });

    it("halves the chunk and retries on a range-limit rejection, then succeeds", async () => {
        const id = channelId(1);
        const latestBlock = 100;

        let sawRejection = false;
        const provider = makeFakeProvider(latestBlock, (fromBlock, toBlock) => {
            const width = toBlock - fromBlock + 1;
            if (width > 20) {
                sawRejection = true;
                return new Error(
                    "query returned more than 10000 results. Try with this block range"
                );
            }
            if (fromBlock <= 90 && toBlock >= 90) return [openedLog(id, 90)];
            return [];
        });
        const contract = makeFakeContract(allOpen([id]));

        const index = new ChannelIndex({
            provider,
            stateChannelManagerContract: contract,
            logger: createLoggerForTest()
        });

        const result = await index.listOpenChannels({
            max: 10,
            maxLookbackBlocks: 100,
            chunkBlocks: 100
        });

        expect(sawRejection).to.equal(true);
        expect(result).to.deep.equal([id]);
    });

    it("excludes a channel whose most recent event is ChannelStorageCleared", async () => {
        const openedThenCleared = channelId(1);
        const stillOpen = channelId(2);

        const provider = makeFakeProvider(100, () => [
            // Newer event first is not required - the scan re-sorts by block.
            openedLog(openedThenCleared, 10),
            clearedLog(openedThenCleared, 50),
            openedLog(stillOpen, 60)
        ]);
        const contract = makeFakeContract(
            allOpen([openedThenCleared, stillOpen])
        );

        const index = new ChannelIndex({
            provider,
            stateChannelManagerContract: contract,
            logger: createLoggerForTest()
        });

        const result = await index.listOpenChannels({
            max: 10,
            maxLookbackBlocks: 100,
            chunkBlocks: 1000
        });

        expect(result).to.deep.equal([stillOpen]);
    });

    it("drops a log-scan candidate that isChannelOpen reports as not open", async () => {
        const staleCandidate = channelId(1);
        const genuinelyOpen = channelId(2);

        const provider = makeFakeProvider(100, () => [
            openedLog(staleCandidate, 40),
            openedLog(genuinelyOpen, 80)
        ]);
        // Only genuinelyOpen is authoritatively open on-chain.
        const contract = makeFakeContract(allOpen([genuinelyOpen]));

        const index = new ChannelIndex({
            provider,
            stateChannelManagerContract: contract,
            logger: createLoggerForTest()
        });

        const result = await index.listOpenChannels({
            max: 10,
            maxLookbackBlocks: 100,
            chunkBlocks: 1000
        });

        expect(result).to.deep.equal([genuinelyOpen]);
    });

    describe("ingestLog", () => {
        it("folds a freshly ingested ChannelOpened into the next scan without a rescan hit", async () => {
            const ingested = channelId(7);
            const fromScan = channelId(8);

            const provider = makeFakeProvider(100, () => [
                openedLog(fromScan, 50)
            ]);
            const contract = makeFakeContract(allOpen([ingested, fromScan]));

            const index = new ChannelIndex({
                provider,
                stateChannelManagerContract: contract,
                logger: createLoggerForTest()
            });

            index.ingestLog(openedLog(ingested, 999));

            const result = await index.listOpenChannels({
                max: 10,
                maxLookbackBlocks: 100,
                chunkBlocks: 1000
            });

            // Ingested (freshest) candidate first, then the scan-discovered one.
            expect(result).to.deep.equal([ingested, fromScan]);
        });

        it("excludes a channel ingested as ChannelStorageCleared, overriding a stale scan hit", async () => {
            const cleared = channelId(9);

            const provider = makeFakeProvider(100, () => [
                openedLog(cleared, 50)
            ]);
            const contract = makeFakeContract(allOpen([cleared]));

            const index = new ChannelIndex({
                provider,
                stateChannelManagerContract: contract,
                logger: createLoggerForTest()
            });

            index.ingestLog(clearedLog(cleared, 999));

            const result = await index.listOpenChannels({
                max: 10,
                maxLookbackBlocks: 100,
                chunkBlocks: 1000
            });

            expect(result).to.deep.equal([]);
        });
    });

    it("exposes an unfiltered ChannelOpened/ChannelStorageCleared subscription filter with no channelId topic", () => {
        const index = new ChannelIndex({
            provider: makeFakeProvider(0, () => []),
            stateChannelManagerContract: makeFakeContract(),
            logger: createLoggerForTest()
        });

        const filter = index.getDiscoverySubscriptionFilter();

        expect(filter.address).to.equal(CONTRACT_ADDRESS);
        expect(filter.topics?.[0]).to.deep.equal([
            CHANNEL_OPENED_TOPIC,
            CHANNEL_STORAGE_CLEARED_TOPIC
        ]);
        expect(filter.topics?.length).to.equal(1);
    });
});
