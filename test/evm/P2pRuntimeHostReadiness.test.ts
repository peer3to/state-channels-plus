import {
    checkDeployReadAgainstFailedStartup,
    checkDeployReadDuringStartup,
    checkPreDeploymentAddressRead,
    checkPreDeploymentRequest
} from "@test/fixtures/P2pRuntimeHostReadinessStaging";
import { ethers } from "ethers";

describe("P2pRuntimeHost readiness", function () {
    it("rejects sendTransaction before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.p2pSigner.sendTransaction("0x").request(),
            "runtime"
        );
    });
    it("rejects callView before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.p2pSigner.callView("0x").request(),
            "runtime"
        );
    });
    it("rejects connectToChannel before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) =>
                host.p2pSigner
                    .connectToChannel(ethers.ZeroHash, { encodedBalance: "0x" })
                    .request(),
            "runtime"
        );
    });
    it("rejects cancelConnectToChannel before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) =>
                host.p2pSigner
                    .cancelConnectToChannel(ethers.ZeroHash)
                    .request(),
            "runtime"
        );
    });
    it("rejects leaveChannel before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.p2pSigner.leaveChannel().request(),
            "runtime"
        );
    });
    it("rejects joinLobby before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) =>
                host.p2pSigner
                    .joinLobby(ethers.ZeroHash, { encodedBalance: "0x" })
                    .request(),
            "runtime"
        );
    });
    it("rejects leaveLobby before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.p2pSigner.leaveLobby(ethers.ZeroHash).request(),
            "runtime"
        );
    });
    it("rejects joinChannel before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) =>
                host.p2pSigner
                    .joinChannel("0x", ethers.ZeroHash, ethers.ZeroHash)
                    .request(),
            "runtime"
        );
    });
    it("rejects topUpBalance before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) =>
                host.p2pSigner
                    .topUpBalance("0x", ethers.ZeroHash, ethers.ZeroHash)
                    .request(),
            "runtime"
        );
    });
    it("rejects collectJoinChannelConfirmation before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) =>
                host.p2pSigner.collectJoinChannelConfirmation("0x").request(),
            "runtime"
        );
    });
    it("rejects getChannelStatus before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.p2pSigner.getChannelStatus().request(),
            "runtime"
        );
    });
    it("rejects setIsLeader before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.p2pSigner.setIsLeader(true).request(),
            "runtime"
        );
    });
    it("rejects disconnectFromPeers before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) => host.p2pSigner.disconnectFromPeers().request(),
            "runtime"
        );
    });
    it("rejects hostRpc before deployment", async function () {
        await checkPreDeploymentRequest(
            (host) =>
                host.hostRpc
                    .call("query", "getForkId", [], "request", [])
                    .request(),
            "runtime"
        );
    });
    it("allows deploy signer address reads before deployment", async function () {
        await checkPreDeploymentAddressRead();
    });

    it("answers a deploy signer read that arrived while the host was still building", async function () {
        await checkDeployReadDuringStartup();
    });

    it("rejects a deploy signer read waiting on a host whose startup failed", async function () {
        await checkDeployReadAgainstFailedStartup();
    });
});
