import { checkPreDeploymentRequest } from "@test/fixtures/P2pRuntimeHostReadinessStaging";
import { ethers } from "ethers";

describe("P2pRuntimeHost readiness", function () {
    it("rejects sendTransaction before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner.sendTransaction("0x").request()
        );
    });
    it("rejects callView before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner.callView("0x").request()
        );
    });
    it("rejects connectToChannel before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner
                .connectToChannel(ethers.ZeroHash, { encodedBalance: "0x" })
                .request()
        );
    });
    it("rejects cancelConnectToChannel before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner.cancelConnectToChannel(ethers.ZeroHash).request()
        );
    });
    it("rejects leaveChannel before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner.leaveChannel().request()
        );
    });
    it("rejects joinLobby before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner
                .joinLobby(ethers.ZeroHash, { encodedBalance: "0x" })
                .request()
        );
    });
    it("rejects leaveLobby before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner.leaveLobby(ethers.ZeroHash).request()
        );
    });
    it("rejects joinChannel before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner
                .joinChannel("0x", ethers.ZeroHash, ethers.ZeroHash)
                .request()
        );
    });
    it("rejects topUpBalance before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner
                .topUpBalance("0x", ethers.ZeroHash, ethers.ZeroHash)
                .request()
        );
    });
    it("rejects collectJoinChannelConfirmation before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner.collectJoinChannelConfirmation("0x").request()
        );
    });
    it("rejects getChannelStatus before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.p2pSigner.getChannelStatus().request()
        );
    });
    it("rejects hostRpc before deployment", async function () {
        await checkPreDeploymentRequest((host) =>
            host.hostRpc.call("query", "getForkId", [], "request", []).request()
        );
    });
    it("allows deploy signer address reads before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.deploySigner.getAddress().request(),
            true
        );
    });
});
