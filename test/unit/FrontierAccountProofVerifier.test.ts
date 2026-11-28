import StorageProofError from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/StorageProofError";
import FrontierAccountProofVerifier from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierAccountProofVerifier";

import { encodeCompact } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/ScaleReader";
import {
    encodedAccountInfo,
    provenFromSingleAccount,
    provenFromSingleCode
} from "@test/fixtures/lightClient/craftedTrieNodes";
import { peer3AccountProof } from "@test/fixtures/lightClient/peer3AccountProof";
import { expect } from "chai";
import { concat, dataLength, dataSlice } from "ethers";

const {
    existentialDeposit,
    stateRoot,
    funded,
    contract,
    largeContract,
    unused,
    recipient,
    sharedProofNodes
} = peer3AccountProof;
const verifier = new FrontierAccountProofVerifier(existentialDeposit);

describe("FrontierAccountProofVerifier", function () {
    it("proves a funded account's nonce and balance to the node's own answers", function () {
        expect(funded.nonce > 0n && funded.balance > 0n).to.equal(true);
        expect(
            verifier.provenAccount(stateRoot, funded.address, funded.proofNodes)
        ).to.deep.equal({ nonce: funded.nonce, balance: funded.balance });
    });

    it("proves an address the chain holds nothing for as nonce and balance zero", function () {
        expect(
            verifier.provenAccount(stateRoot, unused.address, unused.proofNodes)
        ).to.deep.equal({ nonce: 0n, balance: 0n });
    });

    it("proves a contract's nonce and its zero balance to the node's own answers", function () {
        expect(contract.nonce).to.equal(1n);
        expect(
            verifier.provenAccount(
                stateRoot,
                contract.address,
                contract.proofNodes
            )
        ).to.deep.equal({ nonce: 1n, balance: 0n });
    });

    it("proves several accounts from one shared proof", function () {
        const accounts = [funded, recipient, contract, largeContract, unused];
        expect(
            accounts.map(({ address }) =>
                verifier.provenAccount(stateRoot, address, sharedProofNodes)
            )
        ).to.deep.equal(
            accounts.map(({ nonce, balance }) => ({ nonce, balance }))
        );
    });

    it("keeps back the existential deposit of a balance nothing is frozen of", function () {
        expect(
            provenFromSingleAccount(
                verifier,
                funded.address,
                encodedAccountInfo({
                    nonce: 7n,
                    free: 10n * existentialDeposit,
                    reserved: 0n,
                    frozen: 0n
                })
            )
        ).to.deep.equal({ nonce: 7n, balance: 9n * existentialDeposit });
    });

    it("keeps back a frozen balance that exceeds the existential deposit", function () {
        expect(
            provenFromSingleAccount(
                verifier,
                funded.address,
                encodedAccountInfo({
                    nonce: 0n,
                    free: 10n * existentialDeposit,
                    reserved: 0n,
                    frozen: 4n * existentialDeposit
                })
            ).balance
        ).to.equal(6n * existentialDeposit);
    });

    it("counts a freeze against the reserved balance before the free balance", function () {
        // one deposit more is frozen than reserved: the deposit still stays
        expect(
            provenFromSingleAccount(
                verifier,
                funded.address,
                encodedAccountInfo({
                    nonce: 0n,
                    free: 10n * existentialDeposit,
                    reserved: 3n * existentialDeposit,
                    frozen: 4n * existentialDeposit
                })
            ).balance
        ).to.equal(9n * existentialDeposit);
        // three deposits more are frozen than reserved
        expect(
            provenFromSingleAccount(
                verifier,
                funded.address,
                encodedAccountInfo({
                    nonce: 0n,
                    free: 10n * existentialDeposit,
                    reserved: 1n * existentialDeposit,
                    frozen: 4n * existentialDeposit
                })
            ).balance
        ).to.equal(7n * existentialDeposit);
        // more is reserved than frozen
        expect(
            provenFromSingleAccount(
                verifier,
                funded.address,
                encodedAccountInfo({
                    nonce: 0n,
                    free: 10n * existentialDeposit,
                    reserved: 5n * existentialDeposit,
                    frozen: 4n * existentialDeposit
                })
            ).balance
        ).to.equal(9n * existentialDeposit);
    });

    it("proves a free balance of no more than what is kept back as zero", function () {
        const balanceOf = (free: bigint) =>
            provenFromSingleAccount(
                verifier,
                funded.address,
                encodedAccountInfo({
                    nonce: 0n,
                    free,
                    reserved: 0n,
                    frozen: 0n
                })
            ).balance;
        expect(balanceOf(existentialDeposit - 1n)).to.equal(0n);
        expect(balanceOf(existentialDeposit)).to.equal(0n);
        expect(balanceOf(existentialDeposit + 1n)).to.equal(1n);
    });

    it("throws for an account the proof was not built for", function () {
        expect(() =>
            verifier.provenAccount(stateRoot, funded.address, unused.proofNodes)
        ).to.throw(StorageProofError, /holds no node with hash/);
    });

    it("throws when the proven account is not as long as an account entry", function () {
        const account = encodedAccountInfo({
            nonce: 1n,
            free: 2n * existentialDeposit,
            reserved: 0n,
            frozen: 0n
        });
        expect(dataLength(account)).to.equal(80);
        expect(() =>
            provenFromSingleAccount(
                verifier,
                funded.address,
                dataSlice(account, 0, 79)
            )
        ).to.throw(StorageProofError, /79-byte account/);
        expect(() =>
            provenFromSingleAccount(
                verifier,
                funded.address,
                concat([account, "0x00"])
            )
        ).to.throw(StorageProofError, /81-byte account/);
        // the same one-entry trie with the whole entry is accepted
        expect(
            provenFromSingleAccount(verifier, funded.address, account)
        ).to.deep.equal({
            nonce: 1n,
            balance: existentialDeposit
        });
    });

    it("refuses an address that is not 20 bytes", function () {
        expect(() =>
            verifier.provenAccount(
                stateRoot,
                funded.address.slice(0, -2),
                funded.proofNodes
            )
        ).to.throw(/an address is 20 bytes/);
        expect(() =>
            verifier.provenCode(
                stateRoot,
                contract.address.slice(0, -2),
                contract.proofNodes
            )
        ).to.throw(/an address is 20 bytes/);
    });

    it("proves code the trie holds inside its leaf to the node's own eth_getCode", function () {
        expect(dataLength(contract.code)).to.equal(16);
        expect(
            verifier.provenCode(
                stateRoot,
                contract.address,
                contract.proofNodes
            )
        ).to.equal(contract.code);
    });

    it("proves code the trie holds by hash to the node's own eth_getCode", function () {
        expect(dataLength(largeContract.code)).to.equal(48);
        expect(
            verifier.provenCode(
                stateRoot,
                largeContract.address,
                largeContract.proofNodes
            )
        ).to.equal(largeContract.code);
    });

    it("proves an account the chain holds no code for as empty", function () {
        expect(
            verifier.provenCode(stateRoot, funded.address, funded.proofNodes)
        ).to.equal("0x");
        expect(
            verifier.provenCode(stateRoot, unused.address, unused.proofNodes)
        ).to.equal("0x");
    });

    it("proves the code of several contracts from one shared proof", function () {
        expect(
            [contract, largeContract, funded].map(({ address }) =>
                verifier.provenCode(stateRoot, address, sharedProofNodes)
            )
        ).to.deep.equal([contract.code, largeContract.code, "0x"]);
    });

    it("throws for code the proof was not built for", function () {
        expect(() =>
            verifier.provenCode(
                stateRoot,
                largeContract.address,
                unused.proofNodes
            )
        ).to.throw(StorageProofError, /holds no node with hash/);
    });

    it("throws when the proof node that carries hashed code is left out", function () {
        const encodedCode = concat([encodeCompact(48), largeContract.code]);
        expect(largeContract.proofNodes).to.include(encodedCode);
        expect(() =>
            verifier.provenCode(
                stateRoot,
                largeContract.address,
                largeContract.proofNodes.filter((node) => node !== encodedCode)
            )
        ).to.throw(StorageProofError, /holds no node with hash/);
    });

    it("throws when the proven code is not as long as it announces", function () {
        expect(() =>
            provenFromSingleCode(
                verifier,
                contract.address,
                concat([encodeCompact(5), "0x600060"])
            )
        ).to.throw(StorageProofError, /ends early/);
        expect(() =>
            provenFromSingleCode(
                verifier,
                contract.address,
                concat([encodeCompact(2), "0x600060"])
            )
        ).to.throw(StorageProofError, /longer than it announces/);
        // the same one-entry trie with the announced length is accepted
        expect(
            provenFromSingleCode(
                verifier,
                contract.address,
                concat([encodeCompact(3), "0x600060"])
            )
        ).to.equal("0x600060");
    });

    it("throws when one byte of any node on the path of an account or its code was changed", function () {
        const { address, proofNodes } = largeContract;
        // the nodes with one byte in the middle of the node at `index` changed
        const withOneByteChanged = (index: number) => {
            const node = proofNodes[index];
            const middle = 2 + 2 * Math.floor((node.length - 2) / 4);
            const flipped =
                node.slice(middle, middle + 2) === "00" ? "01" : "00";
            return proofNodes.map((other, position) =>
                position === index
                    ? node.slice(0, middle) + flipped + node.slice(middle + 2)
                    : other
            );
        };
        const proofs = {
            account: (nodes: string[]) =>
                verifier.provenAccount(stateRoot, address, nodes),
            code: (nodes: string[]) =>
                verifier.provenCode(stateRoot, address, nodes)
        };
        for (const [name, prove] of Object.entries(proofs)) {
            // a node is on the path when the proof fails without it
            const pathIndexes = [...proofNodes.keys()].filter((index) => {
                try {
                    prove(proofNodes.filter((_, other) => other !== index));
                    return false;
                } catch (error) {
                    expect(error).to.be.instanceOf(StorageProofError);
                    return true;
                }
            });
            expect(pathIndexes.length, `${name} path`).to.be.greaterThan(1);
            for (const index of pathIndexes)
                expect(
                    () => prove(withOneByteChanged(index)),
                    `${name}, node ${index}`
                ).to.throw(StorageProofError, /holds no node with hash/);
        }
    });
});
