import { ScriptProcess } from "../../fixtures/node/ScriptProcess";
import { StorageDiffClient } from "../../fixtures/node/StorageDiffClient";
import { withStorageDiffUpstream } from "../../fixtures/node/StorageDiffSession";
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

    it("leaves the peer buffer limit unset without its flag", function () {
        const options = parseStorageDiffArgs([
            "--upstream",
            "ws://127.0.0.1:1"
        ]);

        expect(options.maxPeerBufferedBytes).to.equal(undefined);
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
