import { expect } from "chai";
import { ethers } from "ethers";
import { LoggerUtils } from "@/utils/LoggerUtils";

describe("LoggerUtils", function () {
    it("builds contract-call metadata from encoded calldata", function () {
        const contractInterface = new ethers.Interface([
            "function setValue(uint256 value)"
        ]);
        const encodedData = contractInterface.encodeFunctionData("setValue", [
            42n
        ]);
        const contractAddress = ethers.Wallet.createRandom().address;

        expect(
            LoggerUtils.getContractCallMetadata(encodedData, contractAddress)
        ).to.deep.equal({
            contractAddress,
            functionSelector: encodedData.slice(0, 10),
            calldataBytes: ethers.dataLength(encodedData)
        });
    });
});
