// @ts-expect-error - standalone executor options are no longer a package export.
export type { ContractExecutorFactoryOptions } from "@/index";
import { assertCustomRpcTypes } from "@test/fixtures/RpcProxyTypesFixture";
import { expect } from "chai";

describe("CustomRpc typing", () => {
    it("allows custom RPC classes to extend MainRpcService", () => {
        void assertCustomRpcTypes;
        expect(true).to.equal(true);
    });
});
