import { expect } from "chai";
import type { TransactionResponse } from "ethers";
import { ethers } from "hardhat";
import assert from "node:assert/strict";
import sinon from "sinon";

import HostNonceManager from "@/evm/signer/HostNonceManager";

describe("HostNonceManager", () => {
    it("reuses a failed middle nonce without colliding with concurrent sends", async () => {
        const [funder, recipient] = await ethers.getSigners();
        const sender = ethers.Wallet.createRandom().connect(ethers.provider);
        await (
            await funder.sendTransaction({
                to: sender.address,
                value: ethers.parseEther("1")
            })
        ).wait();
        const manager = new HostNonceManager(sender);
        const pendingNonce = await sender.getNonce("pending");

        await ethers.provider.send("evm_setAutomine", [false]);
        let acceptedResponses: TransactionResponse[] = [];
        try {
            const results = await Promise.allSettled([
                manager.sendTransaction({
                    to: recipient.address,
                    value: 1n
                }),
                manager.sendTransaction({
                    to: recipient.address,
                    value: ethers.MaxUint256
                }),
                manager.sendTransaction({
                    to: recipient.address,
                    value: 2n
                })
            ]);
            expect(results[0].status, "first send must broadcast").to.equal(
                "fulfilled"
            );
            expect(results[1].status, "middle send must fail").to.equal(
                "rejected"
            );
            expect(results[2].status, "third send must broadcast").to.equal(
                "fulfilled"
            );
            acceptedResponses = results.flatMap((result) =>
                result.status === "fulfilled" ? [result.value] : []
            );
            await ethers.provider.send("hardhat_mine", ["0x1"]);
            await Promise.all(
                acceptedResponses.map((response) => response.wait())
            );
        } finally {
            await ethers.provider.send("evm_setAutomine", [true]);
        }

        const subsequentResponse = await manager.sendTransaction({
            to: recipient.address,
            value: 3n
        });
        await subsequentResponse.wait();

        expect(
            acceptedResponses
                .concat(subsequentResponse)
                .map((response) => response.nonce)
        ).to.deep.equal([pendingNonce, pendingNonce + 1, pendingNonce + 2]);
    });

    it("cannot create another nonce owner by reconnecting", async () => {
        const sender = ethers.Wallet.createRandom().connect(ethers.provider);
        const manager = new HostNonceManager(sender);

        expect(manager.connect(sender.provider)).to.equal(manager);
        expect(() => manager.connect(null)).to.throw(
            "cannot reconnect host nonce manager"
        );
    });

    it("recovers an indeterminate nonce lazily on the next send", async () => {
        const [funder, recipient] = await ethers.getSigners();
        const sender = ethers.Wallet.createRandom().connect(ethers.provider);
        await (
            await funder.sendTransaction({
                to: sender.address,
                value: ethers.parseEther("1")
            })
        ).wait();
        const manager = new HostNonceManager(sender);
        const originalGetNonce = sender.getNonce.bind(sender);
        let nonceQueries = 0;
        const getNonce = sinon
            .stub(sender, "getNonce")
            .callsFake(async (blockTag) => {
                nonceQueries += 1;
                if (nonceQueries === 2 || nonceQueries === 3) {
                    throw new Error("transient nonce query failure");
                }
                return originalGetNonce(blockTag);
            });

        try {
            await assert.rejects(
                manager.sendTransaction({
                    to: recipient.address,
                    value: ethers.parseEther("2")
                }),
                /account nonce state could not be reconciled/
            );
            expect(nonceQueries).to.equal(2);

            await assert.rejects(
                manager.sendTransaction({
                    to: recipient.address,
                    value: 1n
                }),
                /transient nonce query failure/
            );
            expect(nonceQueries).to.equal(3);

            const response = await manager.sendTransaction({
                to: recipient.address,
                value: 1n
            });
            await response.wait();

            expect(nonceQueries).to.equal(4);
            expect(response.nonce).to.equal(
                await ethers.provider.getTransactionCount(
                    sender.address,
                    response.blockNumber! - 1
                )
            );
        } finally {
            getNonce.restore();
        }
    });
});
