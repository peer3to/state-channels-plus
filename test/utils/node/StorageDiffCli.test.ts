import { ScriptProcess } from "../../fixtures/node/ScriptProcess";
import { StorageDiffClient } from "../../fixtures/node/StorageDiffClient";
import { withStorageDiffUpstream } from "../../fixtures/node/StorageDiffSession";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import {
    parseStorageDiffArgs,
    UPSTREAM_URL_ENV
} from "@/utils/node/storageDiff/storageDiffCli";
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

    it("leaves the peer buffer limit unset without its flag", function () {
        const options = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1"
        ]);

        expect(options.maxPeerBufferedBytes).to.equal(undefined);
    });

    it("lists backfill blocks through the Asset Hub child trie with --asset-hub-substrate-url, and leaves the default without it", function () {
        const assetHub = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1",
            "--asset-hub-substrate-url",
            "ws://127.0.0.1:2"
        ]);
        const plain = parseStorageDiffArgs(["--upstream", "ws://127.0.0.1:1"]);

        expect(assetHub.backfillBlocks).to.be.instanceOf(ChildTrieBlockSource);
        expect(plain.backfillBlocks).to.equal(undefined);
        assetHub.backfillBlocks!.close();
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

    it("passes each limit flag on as its service option", function () {
        const options = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1",
            "--max-addresses-per-request",
            "11",
            "--max-subscriptions-per-connection",
            "12",
            "--max-connections",
            "13",
            "--max-in-flight-requests",
            "14",
            "--max-watched-addresses",
            "15",
            "--max-watched-addresses-per-connection",
            "16"
        ]);

        expect(options).to.deep.equal({
            upstreamUrl: "ws://127.0.0.1:1",
            maxAddressesPerRequest: 11,
            maxSubscriptionsPerConnection: 12,
            maxConnections: 13,
            maxInFlightRequests: 14,
            maxWatchedAddresses: 15,
            maxWatchedAddressesPerConnection: 16
        });
    });

    it("passes every --allow-origin on as an allowed origin", function () {
        const options = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1",
            "--allow-origin",
            "https://a.example",
            "--allow-origin",
            "https://b.example"
        ]);

        expect(options.allowedOrigins).to.deep.equal([
            "https://a.example",
            "https://b.example"
        ]);
    });

    it("reads the upstream URL from STORAGE_DIFF_UPSTREAM_URL without --upstream", function () {
        const options = parseStorageDiffArgs([], {
            [UPSTREAM_URL_ENV]: "wss://user:key@rpc.example"
        });

        expect(options.upstreamUrl).to.equal("wss://user:key@rpc.example");
    });

    it("takes --upstream over STORAGE_DIFF_UPSTREAM_URL", function () {
        const options = parseStorageDiffArgs(
            ["--upstream", "ws://127.0.0.1:1"],
            { [UPSTREAM_URL_ENV]: "ws://127.0.0.1:2" }
        );

        expect(options.upstreamUrl).to.equal("ws://127.0.0.1:1");
    });

    it("refuses to start without --upstream or STORAGE_DIFF_UPSTREAM_URL", function () {
        expect(() => parseStorageDiffArgs([], {})).to.throw(
            "--upstream <ws://... | wss://...> or STORAGE_DIFF_UPSTREAM_URL is required"
        );
    });

    it("refuses an unknown flag", function () {
        expect(() =>
            parseStorageDiffArgs(["--upstream", "ws://127.0.0.1:1", "--nope"])
        ).to.throw();
    });

    it("starts the script and serves catch-up up to the upstream's head", async function () {
        await withStorageDiffUpstream(async ({ provider, relay }) => {
            const script = ScriptProcess.start([
                "--upstream",
                relay.url,
                "--port",
                "0"
            ]);
            try {
                const client = await StorageDiffClient.connect(
                    await script.listeningUrl()
                );
                try {
                    const catchUp = await client.catchUp([], 0);
                    expect(Number(catchUp.head.number)).to.equal(
                        await provider.getBlockNumber()
                    );
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
