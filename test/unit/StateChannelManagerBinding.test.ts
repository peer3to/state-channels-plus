import { expect } from "chai";
import { ErrorFragment, ethers, InterfaceAbi } from "ethers";
import {
    StateChannelManagerInterface__factory,
    StateChannelManagerProxy__factory
} from "@typechain-types";
import {
    connectStateChannelManager,
    stateChannelManagerAbi
} from "@/utils/stateChannelManager";
import {
    duplicateFragmentKeys,
    expectCompleteFragmentKeys,
    expectedManagerErrorKeys,
    fragmentKeysOfType
} from "@test/fixtures/ContractAbiFixture";
import * as factory from "@test/factory";

const MANAGER_ADDRESS = "0x0000000000000000000000000000000000000001";

describe("stateChannelManager binding", function () {
    it("keeps functions and events exactly equal to the manager interface", function () {
        for (const type of ["function", "event"] as const) {
            expect(
                fragmentKeysOfType(stateChannelManagerAbi, type)
            ).to.deep.equal(
                fragmentKeysOfType(
                    StateChannelManagerInterface__factory.abi,
                    type
                )
            );
        }
    });

    it("includes the generated manager error union exactly once", function () {
        expect(
            fragmentKeysOfType(stateChannelManagerAbi, "error")
        ).to.deep.equal(expectedManagerErrorKeys());
        expect(duplicateFragmentKeys(stateChannelManagerAbi)).to.deep.equal([]);
    });

    it("parses every custom error exposed by the old proxy artifact", function () {
        const managerInterface = new ethers.Interface(stateChannelManagerAbi);
        const proxyErrors =
            StateChannelManagerProxy__factory.createInterface().fragments.filter(
                (fragment): fragment is ErrorFragment =>
                    fragment.type === "error"
            );

        for (const error of proxyErrors) {
            const data = factory.encodedCustomErrorRevert(error.name);
            expect(managerInterface.parseError(data)?.name).to.equal(
                error.name
            );
        }
    });

    it("parses a facet-only error with its arguments", function () {
        const managerInterface = new ethers.Interface(stateChannelManagerAbi);
        const data = managerInterface.encodeErrorResult(
            "ECDSAInvalidSignatureLength",
            [65n]
        );
        const decoded = managerInterface.parseError(data);

        expect(decoded?.name).to.equal("ECDSAInvalidSignatureLength");
        expect(decoded?.args[0]).to.equal(65n);
    });

    it("round-trips the complete ABI through the runtime JSON payload", function () {
        const original = new ethers.Interface(stateChannelManagerAbi);
        const serialized = original.formatJson();
        const reconstructed = new ethers.Interface(
            JSON.parse(serialized) as InterfaceAbi
        );

        const keys = expectCompleteFragmentKeys(
            reconstructed.fragments,
            original.fragments
        );
        expect(keys.actual).to.deep.equal(keys.expected);

        for (const errorName of [
            "RaceConditionChannelAlreadyOpen",
            "ECDSAInvalidSignature"
        ]) {
            const data = reconstructed.encodeErrorResult(errorName);
            expect(reconstructed.parseError(data)?.name).to.equal(errorName);
        }
    });

    it("connects a read-only binding when no runner is given", function () {
        const binding = connectStateChannelManager(MANAGER_ADDRESS, null);

        expect(binding.target).to.equal(MANAGER_ADDRESS);
        expect(binding.runner).to.equal(null);
    });
});
