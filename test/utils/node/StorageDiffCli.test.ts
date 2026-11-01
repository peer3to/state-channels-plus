import {
    RecordedAssetHubNode,
    RecordedRelayNode,
    recorded
} from "../../fixtures/node/RecordedPolkadotNodes";
import { ScriptProcess } from "../../fixtures/node/ScriptProcess";
import {
    StorageDiffClient,
    withStorageDiffSession,
    withStorageDiffUpstream
} from "../../fixtures/node/StorageDiffService.fixture";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import { DepthIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/DepthIncludedHeadStrategy";
import { RelayIncludedHeadStrategy } from "@/utils/node/storageDiff/includedHead/RelayIncludedHeadStrategy";
import { parseStorageDiffArgs } from "@/utils/node/storageDiff/storageDiffCli";
import { expect } from "chai";

describe("storage diff service flags", function () {
    it("passes --max-peer-buffered-bytes on as the peer buffer limit", function () {
        const options = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1",
            "--max-peer-buffered-bytes",
            "65536"
        ]);

        expect(options.maxPeerBufferedBytes).to.equal(65536);
    });

    it("passes --cache-dir on as the cache directory, and leaves it unset without the flag", function () {
        const withFlag = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1",
            "--cache-dir",
            "/var/lib/storage-diff"
        ]);
        const without = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1"
        ]);

        expect(withFlag.cacheDir).to.equal("/var/lib/storage-diff");
        expect(without.cacheDir).to.equal(undefined);
    });

    it("leaves the peer buffer limit and the inclusion strategy unset without their flags", function () {
        const options = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1"
        ]);

        expect(options.maxPeerBufferedBytes).to.equal(undefined);
        expect(options.includedHead).to.equal(undefined);
    });

    it("lists backfill blocks through the Asset Hub child trie with the relay flags, and leaves the default without them", function () {
        const relay = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1",
            "--included-relay-url",
            "ws://127.0.0.1:2",
            "--included-asset-hub-url",
            "ws://127.0.0.1:3"
        ]);
        const dev = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1",
            "--included-dev-depth",
            "2"
        ]);

        expect(relay.backfillBlocks).to.be.instanceOf(ChildTrieBlockSource);
        expect(relay.includedHead).to.be.instanceOf(RelayIncludedHeadStrategy);
        expect(dev.backfillBlocks).to.equal(undefined);
        expect(dev.includedHead).to.be.instanceOf(DepthIncludedHeadStrategy);
    });

    // Mutation: the parsed --included-para-id ignored (the default used) -> another head key.
    it("builds the relay strategy for the para id of --included-para-id", async function () {
        const relayNode = await RecordedRelayNode.start(
            recorded.otherParaHeadKeys["2000"]
        );
        const assetHub = await RecordedAssetHubNode.start();
        try {
            const options = parseStorageDiffArgs([
                "--upstream",
                "ws://127.0.0.1:1",
                "--included-relay-url",
                relayNode.url,
                "--included-asset-hub-url",
                assetHub.url,
                "--included-para-id",
                "2000"
            ]);

            await withStorageDiffUpstream(async ({ start }) => {
                const started = start({ includedHead: options.includedHead });
                await relayNode.requestsReached("state_subscribeStorage", 1);
                expect(
                    relayNode.paramsOf("state_subscribeStorage")
                ).to.deep.equal([[[recorded.otherParaHeadKeys["2000"]]]]);
                await started;
            });
        } finally {
            await relayNode.close();
            await assetHub.close();
        }
    });

    it("refuses a relay URL without an Asset Hub URL", function () {
        expect(() =>
            parseStorageDiffArgs([
                "--upstream",
                "ws://127.0.0.1:1",
                "--included-relay-url",
                "ws://127.0.0.1:2"
            ])
        ).to.throw("required together");
    });

    it("refuses the dev depth together with the relay flags", function () {
        expect(() =>
            parseStorageDiffArgs([
                "--upstream",
                "ws://127.0.0.1:1",
                "--included-dev-depth",
                "2",
                "--included-relay-url",
                "ws://127.0.0.1:2",
                "--included-asset-hub-url",
                "ws://127.0.0.1:3"
            ])
        ).to.throw("cannot be combined");
    });

    it("refuses a flag value that is not a non-negative integer", function () {
        expect(() =>
            parseStorageDiffArgs([
                "--upstream",
                "ws://127.0.0.1:1",
                "--max-peer-buffered-bytes",
                "lots"
            ])
        ).to.throw("--max-peer-buffered-bytes must be a non-negative integer");
    });

    it("refuses an unknown flag", function () {
        expect(() =>
            parseStorageDiffArgs(["--upstream", "ws://127.0.0.1:1", "--nope"])
        ).to.throw();
    });

    it("starts the script with the dev inclusion flag and serves the included head", async function () {
        await withStorageDiffUpstream(async ({ relay }) => {
            const script = ScriptProcess.start([
                "--upstream",
                relay.url,
                "--port",
                "0",
                "--included-dev-depth",
                "1"
            ]);
            try {
                const client = await StorageDiffClient.connect(
                    await script.listeningUrl()
                );
                try {
                    const catchUp = await client.catchUp([], 0);
                    expect(catchUp.includedHead).to.not.equal(null);
                } finally {
                    client.close();
                }
            } finally {
                await script.stop();
            }
        });
    });

    it("fails the script at startup when --max-peer-buffered-bytes is zero", async function () {
        await withStorageDiffUpstream(async ({ relay }) => {
            const script = ScriptProcess.start([
                "--upstream",
                relay.url,
                "--port",
                "0",
                "--max-peer-buffered-bytes",
                "0"
            ]);

            const exit = await script.exited();

            expect(exit.code).to.equal(1);
            expect(exit.stderr).to.include(
                "maxPeerBufferedBytes must be a positive integer"
            );
        });
    });
});
