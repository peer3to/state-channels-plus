import {
    CrossModuleEthersResult,
    CrossModuleRpcService,
    CrossModuleTransport
} from "../../testSupport/CrossModuleValues";
import { RpcRouter } from "@/rpc/RpcRouter";

import { isTransport } from "@/transport/ATransport";
import {
    convertEthersValue,
    createEthersResultProxy
} from "@/utils/EthersResultProxy";
import noOpLogger from "@/utils/logging/noOpLogger";
import { hasRpcService, isEthersResult } from "@/utils/ObjectChecks";
import { linkedRouters } from "@test/fixtures/rpc/PortRpcProbe.fixture";
import { expect } from "chai";
import { AbiCoder } from "ethers";

/** a router serving a root loaded from another module graph */
function routerServing<TRoot extends object>(root: TRoot) {
    return new RpcRouter<TRoot, TRoot>(() => root, noOpLogger);
}

describe("cross-module runtime values", function () {
    it("accepts an RPC service with the public service shape", function () {
        const service = new CrossModuleRpcService();
        const router = routerServing({ service });

        expect(hasRpcService(router.localRpc, "service")).to.equal(true);

        const firstProxy = Reflect.get(router.remoteRpc, "service");
        expect(firstProxy).to.be.an("object");
        expect(Reflect.get(router.remoteRpc, "service")).to.equal(firstProxy);
    });

    it("rejects an object that is missing part of the RPC service shape", function () {
        const root = {
            service: {
                p2pManager: {},
                runRPC: () => true
            }
        };

        // what dispatch refuses to route to; the far-end proxy is typed, not
        // guarded, so it never inspects a local object
        expect(hasRpcService(root, "service")).to.equal(false);
    });

    it("remains non-thenable during Promise assimilation", async function () {
        const remoteRpc = routerServing({
            service: new CrossModuleRpcService()
        }).remoteRpc;

        expect(Reflect.get(remoteRpc, "then")).to.equal(undefined);
        expect((await Promise.resolve(remoteRpc)) === remoteRpc).to.equal(true);
    });

    it("returns undefined for symbol property access", function () {
        const remoteRpc = routerServing({
            service: new CrossModuleRpcService()
        }).remoteRpc;

        expect(Reflect.get(remoteRpc, Symbol.iterator)).to.equal(undefined);
        expect(Reflect.get(remoteRpc, Symbol.toPrimitive)).to.equal(undefined);
    });

    it("returns a live handle for any string name, leaving refusal to the far end", async function () {
        const link = linkedRouters();
        try {
            const unknown = Reflect.get(link.a.far, "noSuchService") as Record<
                string,
                (...params: unknown[]) => { request: () => Promise<unknown> }
            >;
            expect(unknown).to.be.an("object");

            let caught: Error | undefined;
            try {
                await unknown.noSuchMethod().request();
            } catch (error) {
                caught = error as Error;
            }

            expect(caught?.message).to.equal(
                "Unknown RPC service 'noSuchService'"
            );
        } finally {
            link.close();
        }
    });

    it("keeps separate cached proxies for separate service names", function () {
        const remoteRpc = routerServing({
            firstService: new CrossModuleRpcService(),
            secondService: new CrossModuleRpcService()
        }).remoteRpc;
        const firstProxy = Reflect.get(remoteRpc, "firstService");
        const secondProxy = Reflect.get(remoteRpc, "secondService");

        expect(Reflect.get(remoteRpc, "firstService")).to.equal(firstProxy);
        expect(Reflect.get(remoteRpc, "secondService")).to.equal(secondProxy);
        expect(firstProxy === secondProxy).to.equal(false);
    });

    it("accepts a transport with the public transport shape", function () {
        expect(isTransport(new CrossModuleTransport())).to.equal(true);
    });

    it("rejects an object that is missing part of the transport shape", function () {
        expect(isTransport(undefined)).to.equal(false);
        expect(isTransport("transport")).to.equal(false);
        expect(
            isTransport({
                transportType: "0",
                send: () => undefined,
                sendRpcResponse: () => undefined
            })
        ).to.equal(false);
        expect(
            isTransport({
                transportType: 0,
                sendRpcResponse: () => undefined
            })
        ).to.equal(false);
        expect(
            isTransport({
                send: () => undefined,
                transportType: 0
            })
        ).to.equal(false);
        expect(
            isTransport({
                transportType: 0,
                send: "not-a-function",
                sendRpcResponse: () => undefined
            })
        ).to.equal(false);
        expect(
            isTransport({
                transportType: 0,
                send: () => undefined,
                sendRpcResponse: "not-a-function"
            })
        ).to.equal(false);
    });

    it("accepts native and cross-module ethers Result values", function () {
        const coder = AbiCoder.defaultAbiCoder();
        const nativeResult = coder.decode(
            ["tuple(uint256 amount, address owner)"],
            coder.encode(
                ["tuple(uint256 amount, address owner)"],
                [[3n, "0x0000000000000000000000000000000000000001"]]
            )
        )[0];
        const crossModuleResult = new CrossModuleEthersResult(
            [3n, "0x0000000000000000000000000000000000000001"],
            {
                amount: 3n,
                owner: "0x0000000000000000000000000000000000000001"
            }
        );

        expect(isEthersResult(nativeResult)).to.equal(true);
        expect(isEthersResult(crossModuleResult)).to.equal(true);
        expect(convertEthersValue(nativeResult)).to.deep.equal({
            amount: 3n,
            owner: "0x0000000000000000000000000000000000000001"
        });
        expect(convertEthersValue(crossModuleResult)).to.deep.equal({
            amount: 3n,
            owner: "0x0000000000000000000000000000000000000001"
        });
    });

    it("rejects arrays that do not expose the ethers Result API", function () {
        const ordinaryArray = [1n, 2n];

        expect(isEthersResult(ordinaryArray)).to.equal(false);
        expect(convertEthersValue(ordinaryArray)).to.equal(ordinaryArray);
    });

    it("accepts proxy-wrapped Result values and does not convert normalized values twice", async function () {
        const coder = AbiCoder.defaultAbiCoder();
        const nativeResult = coder.decode(
            ["tuple(uint256 amount, address owner)"],
            coder.encode(
                ["tuple(uint256 amount, address owner)"],
                [[3n, "0x0000000000000000000000000000000000000001"]]
            )
        )[0];
        const wrappedResult = new Proxy(nativeResult, {});
        const expected = {
            amount: 3n,
            owner: "0x0000000000000000000000000000000000000001"
        };

        expect(isEthersResult(wrappedResult)).to.equal(true);
        expect(convertEthersValue(wrappedResult)).to.deep.equal(expected);

        const read = Object.assign(async () => nativeResult, {
            staticCall: async () => nativeResult
        });
        const contract = createEthersResultProxy({ read });
        const converted = await contract.read();

        expect(isEthersResult(converted)).to.equal(false);
        expect(converted).to.deep.equal(expected);
        expect(convertEthersValue(converted)).to.equal(converted);
    });
});
