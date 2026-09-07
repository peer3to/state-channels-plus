import { checkPreDeploymentRequest } from "@test/fixtures/P2pRuntimeHostReadinessStaging";
import { ethers } from "ethers";

describe("P2pRuntimeHost readiness", function () {
    it("rejects sendTransaction before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "sendTransaction",
            data: "0x"
        });
    });
    it("rejects callView before deployment", async function () {
        await checkPreDeploymentRequest({ type: "callView", data: "0x" });
    });
    it("rejects connectToChannel before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "connectToChannel",
            channelId: ethers.ZeroHash,
            options: { encodedBalance: "0x" }
        });
    });
    it("rejects cancelConnectToChannel before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "cancelConnectToChannel",
            channelId: ethers.ZeroHash
        });
    });
    it("rejects leaveChannel before deployment", async function () {
        await checkPreDeploymentRequest({ type: "leaveChannel" });
    });
    it("rejects joinLobby before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "joinLobby",
            lobbyTopic: ethers.ZeroHash,
            options: { encodedBalance: "0x" }
        });
    });
    it("rejects leaveLobby before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "leaveLobby",
            lobbyTopic: ethers.ZeroHash
        });
    });
    it("rejects joinChannel before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "joinChannel",
            encodedJoinChannelConfirmation: "0x",
            expectedSnapshotHash: ethers.ZeroHash,
            expectedForkId: ethers.ZeroHash
        });
    });
    it("rejects topUpBalance before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "topUpBalance",
            encodedJoinChannelConfirmation: "0x",
            expectedSnapshotHash: ethers.ZeroHash,
            expectedForkId: ethers.ZeroHash
        });
    });
    it("rejects collectJoinChannelConfirmation before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "collectJoinChannelConfirmation",
            encodedJoinChannel: "0x"
        });
    });
    it("rejects getChannelStatus before deployment", async function () {
        await checkPreDeploymentRequest({ type: "getChannelStatus" });
    });
    it("rejects setIsLeader before deployment", async function () {
        await checkPreDeploymentRequest({ type: "setIsLeader", value: true });
    });
    it("rejects disconnectFromPeers before deployment", async function () {
        await checkPreDeploymentRequest({ type: "disconnectFromPeers" });
    });
    it("rejects hostRpc before deployment", async function () {
        await checkPreDeploymentRequest({
            type: "hostRpc",
            service: "query",
            method: "getForkId",
            params: [],
            delivery: "request",
            args: []
        });
    });
    it("allows deploy signer address reads before deployment", async function () {
        await checkPreDeploymentRequest(
            { type: "deploySignerGetAddress" },
            true
        );
    });
});
