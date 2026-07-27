import { expect } from "chai";
import { Codec, Type } from "@/utils";
import { Block } from "@/models";
import * as factory from "@test/factory";
import type { Address } from "@/types/types";

// contract of the crafting helpers in test/factory.ts. pure data - no session.

describe("Unit: factory", function () {
    describe("buildAndEncodeBlock", function () {
        it("defaults the block author to the signer → recovered signer === author", async function () {
            const wallet = factory.randomWallet();

            const encoded = await factory.buildAndEncodeBlock(wallet, {
                header: {
                    channelId: factory.zeroHex(),
                    forkId: factory.hash(),
                    transactionCnt: 0
                }
            });

            const block = Block.fromBlockConfirmation(
                Codec.decode(encoded, Type.BlockConfirmation)
            );

            expect(String(block.author).toLowerCase()).to.equal(
                wallet.address.toLowerCase()
            );
            expect(String(block.signerAddress).toLowerCase()).to.equal(
                String(block.author).toLowerCase()
            );
        });

        it("an explicit header.participant still wins → crafted signer/author mismatch", async function () {
            const wallet = factory.randomWallet();
            const other = factory.randomAddress();

            const encoded = await factory.buildAndEncodeBlock(wallet, {
                header: {
                    channelId: factory.zeroHex(),
                    forkId: factory.hash(),
                    transactionCnt: 0,
                    participant: other as Address
                }
            });

            const block = Block.fromBlockConfirmation(
                Codec.decode(encoded, Type.BlockConfirmation)
            );

            expect(String(block.author).toLowerCase()).to.equal(
                String(other).toLowerCase()
            );
            expect(String(block.signerAddress).toLowerCase()).to.equal(
                wallet.address.toLowerCase()
            );
        });
    });
});
