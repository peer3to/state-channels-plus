import { expect } from "chai";

import { deserializeError, serializeError } from "@/evm/p2pRuntime/errorWire";

describe("errorWire", function () {
    it("keeps the original error when its metadata toJSON throws", function () {
        const error = Object.assign(new Error("original failure"), {
            code: "CALL_EXCEPTION",
            info: {
                toJSON() {
                    throw new Error("metadata refused to serialize");
                }
            },
            transaction: { to: "0x0000000000000000000000000000000000000001" },
            receipt: {
                toJSON() {
                    throw new Error("receipt refused to serialize");
                }
            }
        });

        const serialized = serializeError(error);
        expect(serialized.message).to.equal("original failure");
        expect(serialized.name).to.equal("Error");
        expect(serialized.code).to.equal("CALL_EXCEPTION");
        expect(serialized.info).to.equal(undefined);
        expect(serialized.receipt).to.equal(undefined);
        expect(serialized.transaction).to.deep.equal({
            to: "0x0000000000000000000000000000000000000001"
        });
        expect(deserializeError(serialized).message).to.equal(
            "original failure"
        );
    });

    it("keeps the original error when its delay data cannot be cloned", function () {
        const error = Object.assign(new Error("Event loop delay"), {
            eventLoopDelay: {
                dMax: 1000,
                toJSON() {
                    throw new Error("delay refused to serialize");
                }
            }
        });
        const serialized = serializeError(error);
        expect(serialized.message).to.equal("Event loop delay");
        expect(serialized.eventLoopDelay).to.equal(undefined);
    });
});
