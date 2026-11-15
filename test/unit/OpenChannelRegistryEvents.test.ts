import type { Bytes } from "@/types/types";
import { SignatureUtils } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import {
    slotAccountIndex,
    slotDeployerIndex
} from "@test/harness/core/slotAccounts";
import {
    createOpenChannelTestObject,
    deployMathChannelProxyFixture
} from "@test/test_utils/testHelpers";
import { expect } from "chai";

describe("open-channel registry events", function () {
    it("reconstructs the opened set from ChannelOpened events and matches the paged registry", async function () {
        const h = TestSession.getHarness();
        await h.connectChain();
        const firstSigner = h.signerFor(slotAccountIndex(0));
        const secondSigner = h.signerFor(slotAccountIndex(1));
        // the manager's events start after this block
        const fromBlock = await h.provider.getBlockNumber();
        const { mathChannelManager } = await deployMathChannelProxyFixture(
            h.signerFor(slotDeployerIndex())
        );
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
            await (
                await mathChannelManager.open({
                    encodedOpenChannel: first.encoded,
                    signatures: [
                        first.signature as Bytes,
                        second.signature as Bytes
                    ]
                })
            ).wait();
        }

        const opened = await mathChannelManager.queryFilter(
            mathChannelManager.filters.ChannelOpened(),
            fromBlock
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
