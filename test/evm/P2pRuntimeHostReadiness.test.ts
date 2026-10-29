import { checkPreDeploymentRequest } from "@test/fixtures/P2pRuntimeHostReadinessStaging";
import { ethers } from "ethers";

describe("P2pRuntimeHost readiness", function () {
    it("allows chain message signing before deployment", async function () {
        await checkPreDeploymentRequest(async (connection) => {
            const message = "chain signer before deployment";
            const signature = await connection.chainSigner
                .signMessage({ kind: "string", value: message })
                .request();
            return ethers.verifyMessage(message, signature);
        }, true);
    });
    it("allows raw message signing before deployment", async function () {
        await checkPreDeploymentRequest(async (connection) => {
            const message = "P2P signer before deployment";
            return ethers.verifyMessage(
                message,
                await connection.p2pSigner
                    .signMessage({ kind: "string", value: message })
                    .request()
            );
        }, true);
    });
    it("allows chain typed data signing before deployment", async function () {
        await checkPreDeploymentRequest(async (connection) => {
            const domain = { name: "Runtime readiness", version: "1" };
            const types = { Ready: [{ name: "message", type: "string" }] };
            const value = { message: "ready to deploy" };
            const signature = await connection.chainSigner
                .signTypedData(domain, types, value)
                .request();
            return ethers.verifyTypedData(domain, types, value, signature);
        }, true);
    });
    it("allows raw typed data signing before deployment", async function () {
        await checkPreDeploymentRequest(async (connection) => {
            const domain = { name: "Runtime readiness", version: "1" };
            const types = { Ready: [{ name: "message", type: "string" }] };
            const value = { message: "ready to deploy" };
            const signature = await connection.p2pSigner
                .signTypedData(domain, types, value)
                .request();
            return ethers.verifyTypedData(domain, types, value, signature);
        }, true);
    });
    it("rejects sendTransaction before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.sendTransaction("0x").request()
        );
    });
    it("rejects callView before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.callView("0x").request()
        );
    });
    it("rejects connectToChannel before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner
                .connectToChannel(ethers.ZeroHash, { encodedBalance: "0x" })
                .request()
        );
    });
    it("rejects cancelConnectToChannel before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner
                .cancelConnectToChannel(ethers.ZeroHash)
                .request()
        );
    });
    it("rejects leaveChannel before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.leaveChannel().request()
        );
    });
    it("rejects joinLobby before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner
                .joinLobby(ethers.ZeroHash, { encodedBalance: "0x" })
                .request()
        );
    });
    it("rejects leaveLobby before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.leaveLobby(ethers.ZeroHash).request()
        );
    });
    it("rejects joinChannel before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner
                .joinChannel("0x", ethers.ZeroHash, ethers.ZeroHash)
                .request()
        );
    });
    it("rejects topUpBalance before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner
                .topUpBalance("0x", ethers.ZeroHash, ethers.ZeroHash)
                .request()
        );
    });
    it("rejects collectJoinChannelConfirmation before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.collectJoinChannelConfirmation("0x").request()
        );
    });
    it("rejects getChannelStatus before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.getChannelStatus().request()
        );
    });
    it("rejects setIsLeader before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.setIsLeader(true).request()
        );
    });
    it("rejects disconnectFromPeers before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.p2pSigner.disconnectFromPeers().request()
        );
    });
    it("rejects hostRpc before deployment", async function () {
        await checkPreDeploymentRequest((connection) =>
            connection.hostRpc
                .invoke("query", "getForkId", [], "request", [])
                .request()
        );
    });
    it("allows deploy signer address reads before deployment", async function () {
        await checkPreDeploymentRequest(
            (connection) => connection.deploySigner.getAddress().request(),
            true
        );
    });
});
