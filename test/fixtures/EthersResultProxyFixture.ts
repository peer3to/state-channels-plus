// @spec-test-coverage-ignore: shared proxy inputs and call recording; no executable test behavior
import { EventEmitter } from "events";

import { AbiCoder } from "ethers";

type ContractMethod = ((...args: unknown[]) => unknown) & {
    staticCall: (...args: unknown[]) => unknown;
    methodTag: string;
};

export class EthersResultProxyEventLog {
    readonly eventName = "ValueChanged";
    readonly args: unknown;

    constructor(args: unknown) {
        this.args = args;
    }
}

export class EthersResultProxyContractFixture extends EventEmitter {
    readonly marker = "fixture-contract";
    readonly read: ContractMethod;
    directArgs: unknown[] = [];
    directReceiver: unknown;
    directResult: unknown;
    queryResult: unknown = [];
    staticArgs: unknown[] = [];
    staticReceiver: unknown;
    staticResult: unknown;

    constructor(result: unknown) {
        super();
        this.directResult = result;
        this.staticResult = result;

        const fixture = this;
        const read = function (this: unknown, ...args: unknown[]): unknown {
            fixture.directArgs = args;
            fixture.directReceiver = this;
            return fixture.directResult;
        } as ContractMethod;
        read.staticCall = function (
            this: unknown,
            ...args: unknown[]
        ): unknown {
            fixture.staticArgs = args;
            fixture.staticReceiver = this;
            return fixture.staticResult;
        };
        Object.defineProperty(read, "methodTag", {
            value: "read-method",
            enumerable: false,
            configurable: true
        });
        this.read = read;
    }

    ordinaryMethod(): unknown {
        return this;
    }

    async queryFilter(): Promise<unknown> {
        return this.queryResult;
    }
}

export function createEthersNamedResult(
    amount = 3n,
    owner = "0x0000000000000000000000000000000000000001"
): unknown {
    const coder = AbiCoder.defaultAbiCoder();
    return coder.decode(
        ["tuple(uint256 amount, address owner)"],
        coder.encode(
            ["tuple(uint256 amount, address owner)"],
            [[amount, owner]]
        )
    )[0];
}
