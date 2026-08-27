import { expect } from "chai";
import { ethers } from "ethers";
import {
    LocalDiamond__factory,
    StateChannelManagerInterface__factory
} from "@typechain-types";
import { connectLocalDiamond, localDiamondAbi } from "@/utils/localDiamond";

// The mirror is never called here: these cases are about the ABI the binding
// carries, so any address is a valid placeholder for the binding itself.
const MIRROR_ADDRESS = "0x0000000000000000000000000000000000000001";

function fragmentKeys(abi: ethers.InterfaceAbi): string[] {
    return [...ethers.Interface.from(abi).fragments].map((fragment) =>
        fragment.type === "function" ||
        fragment.type === "event" ||
        fragment.type === "error"
            ? `${fragment.type}:${fragment.format("sighash")}`
            : fragment.type
    );
}

describe("localDiamond binding", function () {
    it("carries every fragment of both generated ABIs", function () {
        const merged = new Set(fragmentKeys(localDiamondAbi));
        const expected = [
            ...fragmentKeys(LocalDiamond__factory.abi),
            ...fragmentKeys(StateChannelManagerInterface__factory.abi)
        ];

        expect(
            [...new Set(expected)].filter((key) => !merged.has(key))
        ).to.deep.equal([]);
    });

    it("keeps one fragment for a signature declared by both ABIs", function () {
        const keys = fragmentKeys(localDiamondAbi);
        const duplicates = keys.filter(
            (key, index) => keys.indexOf(key) !== index
        );

        expect(duplicates).to.deep.equal([]);
    });

    it("encodes a call to a function the proxy routes to a facet", function () {
        const binding = connectLocalDiamond(MIRROR_ADDRESS, null);
        const channelId = ethers.id("local-diamond-binding-routed");

        expect(
            binding.interface.encodeFunctionData("getStateSnapshot", [
                channelId
            ])
        ).to.equal(
            StateChannelManagerInterface__factory.createInterface().encodeFunctionData(
                "getStateSnapshot",
                [channelId]
            )
        );
    });

    it("encodes a call to a function only the local diamond declares", function () {
        const binding = connectLocalDiamond(MIRROR_ADDRESS, null);
        const channelId = ethers.id("local-diamond-binding-local-only");

        expect(
            binding.interface.encodeFunctionData("getTotalDeposits", [
                channelId
            ])
        ).to.equal(
            LocalDiamond__factory.createInterface().encodeFunctionData(
                "getTotalDeposits",
                [channelId]
            )
        );
    });

    it("connects a read-only binding when no runner is given", function () {
        const binding = connectLocalDiamond(MIRROR_ADDRESS, null);

        expect(binding.target).to.equal(MIRROR_ADDRESS);
        expect(binding.runner).to.equal(null);
    });
});
