import { expect } from "chai";
import { ethers } from "ethers";

import { EventSyncStorage } from "@/storage/EventSyncStorage";
import { ChannelId } from "@/types/types";

describe("EventSyncStorage", () => {
    it("stores independent monotonic watermarks per normalized channel", async () => {
        const storage = new EventSyncStorage();
        const channelA = ethers.id("event-sync-a") as ChannelId;
        const channelB = ethers.id("event-sync-b") as ChannelId;

        storage.storeLatestProcessedBlock(channelA, 20);
        storage.storeLatestProcessedBlock(
            String(channelA).toUpperCase() as ChannelId,
            10
        );
        storage.storeLatestProcessedBlock(channelB, 15);

        expect(storage.getLatestProcessedBlock(channelA)).to.equal(20);
        expect(storage.getLatestProcessedBlock(channelB)).to.equal(15);
    });

    it("has no cursor until an event-bearing block is published", async () => {
        const storage = new EventSyncStorage();
        const channelId = ethers.id("event-sync-empty") as ChannelId;

        expect(storage.getLatestProcessedBlock(channelId)).to.be.undefined;
    });
});
