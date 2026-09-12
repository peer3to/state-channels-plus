// @spec-test-coverage-ignore: browser page script for the router frame smoke; evidence is mapped from run-worker-contract-executor.mjs
const { RpcRouter } = await import("../../src/rpc/RpcRouter.ts");
const { default: ARpcMethods } = await import("../../src/rpc/ARpcMethods.ts");
const { default: ARpcService } = await import("../../src/rpc/ARpcService.ts");
const { default: ATransport } = await import(
    "../../src/transport/ATransport.ts"
);
const { TransportType } = await import("../../src/transport/TransportType.ts");

const received = [];

class FrameProbeRpcMethods extends ARpcMethods {
    record(value) {
        received.push(value);
    }
}

/** a peer line as a browser realm has one: untrusted, frames as strings */
class UntrustedPeerLine extends ATransport {
    constructor(router) {
        super(router);
        this.transportType = TransportType.WEBRTC;
    }

    _send() {}

    onMessage(frame) {
        this.router.onRpc(frame, this);
    }

    _close() {}
}

/**
 * An inbound peer frame in a realm with no `Buffer` global: the frame-size
 * guard runs on every untrusted line, so the router must bring its own
 * `Buffer` rather than read one off the page.
 */
globalThis.runRpcRouterFrameBrowserSmoke = async () => {
    received.length = 0;
    const router = new RpcRouter(
        (self) => ({
            frameProbe: new ARpcService(self, self.logger, FrameProbeRpcMethods)
        }),
        undefined
    );
    const line = new UntrustedPeerLine(router);
    const pageBuffer = globalThis.Buffer;
    delete globalThis.Buffer;
    try {
        line.onMessage(
            JSON.stringify({
                service: "frameProbe",
                method: "record",
                params: ["dispatched"]
            })
        );
    } finally {
        globalThis.Buffer = pageBuffer;
    }
    return { received: [...received] };
};
