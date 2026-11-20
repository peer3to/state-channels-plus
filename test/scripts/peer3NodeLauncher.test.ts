// @spec-test-coverage-ignore: developer test-node tooling; not protocol behavior, no specification or implementation IDs apply
import {
    exitedProcessId,
    failingNodeBinary,
    nodeDirOfProcess,
    peer3NodeDirs,
    peer3NodeStartFailure,
    removeNodeDir,
    withPeer3NodeBin
} from "@test/fixtures/node/Peer3NodeLauncherFixture";
import { expect } from "chai";
import path from "node:path";

describe("peer3 node launcher", function () {
    it("throws when PEER3_NODE_BIN names no binary", async function () {
        const failure = await withPeer3NodeBin(
            undefined,
            peer3NodeStartFailure
        );
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.equals("PEER3_NODE_BIN names no peer3 node binary");
    });

    it("rejects with ENOENT and leaves no database directory when the binary does not exist", async function () {
        const before = peer3NodeDirs();
        const missing = path.join(process.cwd(), "temp", "no-such-node-bin");
        const failure = await withPeer3NodeBin(missing, peer3NodeStartFailure);
        expect(failure).to.have.property("code", "ENOENT");
        expect([...peer3NodeDirs()].filter((dir) => !before.has(dir))).to.be
            .empty;
    });

    it("rejects with the node's last output and leaves no database directory when the node exits before ready", async function () {
        const before = peer3NodeDirs();
        const binary = failingNodeBinary(
            "error: unexpected argument '--dev-seal'",
            2
        );
        const failure = await withPeer3NodeBin(binary, peer3NodeStartFailure);
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.includes("peer3 node exited with code 2 before ready")
            .and.includes("error: unexpected argument '--dev-seal'");
        expect([...peer3NodeDirs()].filter((dir) => !before.has(dir))).to.be
            .empty;
    });

    it("removes the database directory of a node whose process is gone and keeps a running node's", async function () {
        const dead = nodeDirOfProcess(await exitedProcessId());
        const running = nodeDirOfProcess(process.pid);
        try {
            const binary = failingNodeBinary("stopped", 1);
            await withPeer3NodeBin(binary, peer3NodeStartFailure);
            const dirs = peer3NodeDirs();
            expect({
                dead: dirs.has(dead),
                running: dirs.has(running)
            }).to.deep.equal({ dead: false, running: true });
        } finally {
            removeNodeDir(dead);
            removeNodeDir(running);
        }
    });
});
