import { expect } from "chai";
import { AbiCoder } from "ethers";

import RemoteRpcProxy from "@/rpc/RemoteRpcProxy";
import { isTransport } from "@/transport/ATransport";
import {
    convertEthersValue,
    createEthersResultProxy
} from "@/utils/EthersResultProxy";
import { hasRpcService, isEthersResult } from "@/utils/ObjectChecks";
import {
    CrossModuleEthersResult,
    CrossModuleRpcService,
    CrossModuleTransport
} from "../../testSupport/CrossModuleValues";

describe("cross-module runtime values", function () {
    it("accepts an RPC service with the public service shape", function () {
        const service = new CrossModuleRpcService();
        const root = { service };

        expect(hasRpcService(root, "service")).to.equal(true);

        const remoteRpc = RemoteRpcProxy.createProxy(root);
        const firstProxy = Reflect.get(remoteRpc, "service");
        expect(firstProxy).to.be.an("object");
        expect(Reflect.get(remoteRpc, "service")).to.equal(firstProxy);
    });

    it("rejects an object that is missing part of the RPC service shape", function () {
        const root = {
            service: {
                p2pManager: {},
                runRPC: () => true
            }
        };

        expect(hasRpcService(root, "service")).to.equal(false);
        expect(() =>
            Reflect.get(RemoteRpcProxy.createProxy(root), "service")
        ).to.throw("RemoteRpcProxy can only access services");
    });

    it("passes symbol property access through to the local RPC root", function () {
        const inspection = Symbol("inspection");
        const root = {
            service: new CrossModuleRpcService(),
            [inspection]: "inspection-value"
        };

        expect(
            Reflect.get(RemoteRpcProxy.createProxy(root), inspection)
        ).to.equal("inspection-value");
    });

    it("rejects ordinary and missing string properties", function () {
        const remoteRpc = RemoteRpcProxy.createProxy({
            service: new CrossModuleRpcService(),
            internalState: "not-a-service"
        });

        expect(() => Reflect.get(remoteRpc, "internalState")).to.throw(
            "RemoteRpcProxy can only access services"
        );
        expect(() => Reflect.get(remoteRpc, "missing")).to.throw(
            "RemoteRpcProxy can only access services"
        );
    });

    it("remains non-thenable during Promise assimilation", async function () {
        const remoteRpc = RemoteRpcProxy.createProxy({
            service: new CrossModuleRpcService()
        });

        expect(Reflect.get(remoteRpc, "then")).to.equal(undefined);
        expect((await Promise.resolve(remoteRpc)) === remoteRpc).to.equal(true);
    });

    it("keeps separate cached proxies for separate service names", function () {
        const remoteRpc = RemoteRpcProxy.createProxy({
            firstService: new CrossModuleRpcService(),
            secondService: new CrossModuleRpcService()
        });
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
