import { expect } from "chai";
import { ethers } from "hardhat";

import { SignatureUtils } from "@/utils";
import type { Bytes } from "@/types/types";
import {
    createOpenChannelTestObject,
    deployMathChannelProxyFixture,
    getSigners
} from "@test/test_utils/testHelpers";

describe("open-channel registry events", function () {
    it("reconstructs the opened set from ChannelOpened events and matches the paged registry", async function () {
        const { mathChannelManager } =
            await deployMathChannelProxyFixture(ethers);
        const { firstSigner, secondSigner } = await getSigners(ethers);
        const channels = [
            createOpenChannelTestObject(
                [firstSigner.address, secondSigner.address],
                { channelId: "event-registry-first" }
            ),
            createOpenChannelTestObject(
                [firstSigner.address, secondSigner.address],
                { channelId: "event-registry-second" }
            )
        ];

        for (const channel of channels) {
            const first = await SignatureUtils.signOpenChannel(
                channel,
                firstSigner
            );
            const second = await SignatureUtils.signOpenChannel(
                channel,
                secondSigner
            );
            await mathChannelManager.open({
                encodedOpenChannel: first.encoded,
                signatures: [
                    first.signature as Bytes,
                    second.signature as Bytes
                ]
            });
        }

        const opened = await mathChannelManager.queryFilter(
            mathChannelManager.filters.ChannelOpened()
        );
        const eventSet = opened.map((event) => event.args.channelId);
        const registry = await mathChannelManager.getOpenChannelIds(
            0,
            await mathChannelManager.getOpenChannelCount()
        );

        expect(eventSet).to.deep.equal(registry);
        expect(eventSet).to.deep.equal(
            channels.map((channel) => channel.channelId)
        );
    });
});
