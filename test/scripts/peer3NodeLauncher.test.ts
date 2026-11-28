// @spec-test-coverage-ignore: developer test-node tooling; not protocol behavior, no specification or implementation IDs apply
import {
    argumentGivenTo,
    basePathGivenTo,
    exitedProcessId,
    failingNodeBinary,
    freshNodesDir,
    idleNodeBinary,
    nodeDirsIn,
    nodeDirWithPid,
    peer3NodeStartFailure,
    slotNodeDirectory,
    twoNodesStartedAtOnce,
    withNodeOnPath,
    withPeer3NodeBin
} from "@test/fixtures/node/Peer3NodeLauncherFixture";
import { PEER3_NODES_DIR } from "@test/utils/nodeInfra";
import { expect } from "chai";
import path from "node:path";

describe("peer3 node launcher", function () {
    it("starts zero-fee-node from PATH when PEER3_NODE_BIN is unset", async function () {
        const nodesDir = freshNodesDir();
        const binary = failingNodeBinary("started from PATH", 3);
        const failure = await withNodeOnPath(binary, () =>
            peer3NodeStartFailure(nodesDir)
        );
        expect(failure)
            .to.be.instanceOf(Error)
            .with.property("message")
            .that.includes("peer3 node exited with code 3 before ready")
            .and.includes("started from PATH");
        expect(path.dirname(basePathGivenTo(binary))).to.equal(nodesDir);
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

    it("asks the node to bind port 0 when no port is given", async function () {
        const binary = failingNodeBinary("stopped", 1);
        await withPeer3NodeBin(binary, () =>
            peer3NodeStartFailure(freshNodesDir())
        );
        expect(argumentGivenTo(binary, "--rpc-port")).to.equal("0");
    });

    it("starts two nodes at once without a port on two different ports that both answer", async function () {
        const nodes = await twoNodesStartedAtOnce(freshNodesDir());
        expect({
            distinct: new Set(nodes.map(({ url }) => url)).size,
            answered: nodes.map(({ chainId }) => typeof chainId)
        }).to.deep.equal({ distinct: 2, answered: ["string", "string"] });
    });

    it("gives a --parachain slot node a database directory that names its process and is removed when it dies", async function () {
        const binary = idleNodeBinary();
        expect(await slotNodeDirectory(binary)).to.deep.equal({
            namesLiveProcess: true,
            removedAfterKill: true
        });
        expect(basePathGivenTo(binary).startsWith(PEER3_NODES_DIR)).to.equal(
            true
        );
    });
});
