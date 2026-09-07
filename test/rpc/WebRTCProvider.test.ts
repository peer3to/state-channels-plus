import {
    isWorkerRuntime,
    loadWebRTCProvider
} from "@/rpc/services/WebRTCSetup/connection/WebRTCProvider";
import { runProviderImportCase } from "@test/fixtures/WebRTCProviderStaging";
import { expect } from "chai";
import { RTCPeerConnection } from "werift";

describe("WebRTCProvider", function () {
    it("returns the real global WebRTC constructor", async function () {
        const descriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            "RTCPeerConnection"
        );
        try {
            Object.defineProperty(globalThis, "RTCPeerConnection", {
                configurable: true,
                value: RTCPeerConnection
            });
            const provider = await loadWebRTCProvider();
            expect(
                Object.is(provider.RTCPeerConnection, RTCPeerConnection)
            ).to.equal(true);
        } finally {
            if (descriptor)
                Object.defineProperty(
                    globalThis,
                    "RTCPeerConnection",
                    descriptor
                );
            else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
        }
    });
    it("propagates a rejected provider import without wrapping it", async function () {
        const result = await runProviderImportCase("missing");
        expect(result.sameError).to.equal(true);
        expect(result.message).to.include("Cannot find package 'get-webrtc'");
    });
    it("keeps the unavailable-provider error for a module without a constructor", async function () {
        const result = await runProviderImportCase("empty");
        expect(result.message).to.equal(
            "RTCPeerConnection is unavailable in this runtime"
        );
    });
    it("does not classify the Node global as a browser worker", function () {
        expect(isWorkerRuntime()).to.equal(false);
    });
});
