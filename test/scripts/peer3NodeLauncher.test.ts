// @spec-test-coverage-ignore: developer test-node tooling; not protocol behavior, no specification or implementation IDs apply
import {
    basePathGivenTo,
    exitedProcessId,
    failingNodeBinary,
    freshNodesDir,
    nodeDirsIn,
    nodeDirWithPid,
    peer3NodeStartFailure,
    withPeer3NodeBin
} from "@test/fixtures/node/Peer3NodeLauncherFixture";
import { expect } from "chai";
import path from "node:path";

describe("peer3 node launcher", function () {
    it("throws when PEER3_NODE_BIN names no binary", async function () {
        const nodesDir = freshNodesDir();
        const failure = await withPeer3NodeBin(undefined, () =>
            peer3NodeStartFailure(nodesDir)
        );
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.equals("PEER3_NODE_BIN names no peer3 node binary");
    });

    it("rejects with ENOENT and leaves no database directory when the binary does not exist", async function () {
        const nodesDir = freshNodesDir();
        const missing = path.join(nodesDir, "no-such-node-bin");
        const failure = await withPeer3NodeBin(missing, () =>
            peer3NodeStartFailure(nodesDir)
        );
        expect(failure).to.have.property("code", "ENOENT");
        expect(nodeDirsIn(nodesDir)).to.deep.equal([]);
    });

    it("rejects with the node's last output and leaves no database directory when the node exits before ready", async function () {
        const nodesDir = freshNodesDir();
        const binary = failingNodeBinary(
            "error: unexpected argument '--dev-seal'",
            2
        );
        const failure = await withPeer3NodeBin(binary, () =>
            peer3NodeStartFailure(nodesDir)
        );
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.includes("peer3 node exited with code 2 before ready")
            .and.includes("error: unexpected argument '--dev-seal'");
        expect({
            parent: path.dirname(basePathGivenTo(binary)),
            left: nodeDirsIn(nodesDir)
        }).to.deep.equal({ parent: nodesDir, left: [] });
    });

    it("removes the database directory of a node whose process is gone and keeps the others", async function () {
        const nodesDir = freshNodesDir();
        const dead = nodeDirWithPid(nodesDir, await exitedProcessId());
        const kept = [
            nodeDirWithPid(nodesDir, process.pid),
            nodeDirWithPid(nodesDir, undefined),
            nodeDirWithPid(nodesDir, "")
        ].sort();
        const binary = failingNodeBinary("stopped", 1);
        await withPeer3NodeBin(binary, () => peer3NodeStartFailure(nodesDir));
        const left = nodeDirsIn(nodesDir);
        expect({ dead: left.includes(dead), left }).to.deep.equal({
            dead: false,
            left: kept
        });
    });
});
