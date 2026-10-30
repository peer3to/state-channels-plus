import { ContractExecutor } from "@/evm";
import LocalContractExecutorSigner from "@/evm/signer/LocalContractExecutorSigner";
import { EVM } from "@ethereumjs/evm";
import { expect } from "chai";
import { ethers } from "ethers";

// Init code that returns a one-byte runtime (STOP): CODECOPY the byte after
// these twelve, then RETURN it.
const STOP_CONTRACT_INIT_CODE = "0x6001600c60003960016000f300";

describe("LocalContractExecutorSigner", function () {
    it("deploys through the local EVM with no chain request, numbering its local transactions", async function () {
        const executor = new ContractExecutor(await EVM.create());
        try {
            // No provider: any chain read throws.
            const signer = new LocalContractExecutorSigner(
                ethers.Wallet.createRandom(),
                executor
            );
            const first = await signer.sendTransaction({
                data: STOP_CONTRACT_INIT_CODE
            });
            const second = await signer.sendTransaction({
                data: STOP_CONTRACT_INIT_CODE
            });

            expect([first.nonce, second.nonce]).to.deep.equal([0, 1]);
            expect(await signer.getNonce()).to.equal(2);
            const [firstReceipt, secondReceipt] = await Promise.all([
                first.wait(),
                second.wait()
            ]);
            expect(firstReceipt?.contractAddress).to.match(
                /^0x[0-9a-fA-F]{40}$/
            );
            expect(secondReceipt?.contractAddress).to.not.equal(
                firstReceipt?.contractAddress
            );
        } finally {
            await executor.dispose();
        }
    });
});
