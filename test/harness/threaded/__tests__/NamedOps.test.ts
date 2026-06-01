import { expect } from "chai";
import { describe, it } from "mocha";

import { rejectLambdaArgs } from "@test/harness/core/namedOpGuards";

describe("namedOpGuards.rejectLambdaArgs", () => {
    it("rejects function-typed txFn with clear migration error", () => {
        const req = { op: "x", txFn: () => undefined } as unknown as {
            op: string;
        };
        expect(() => rejectLambdaArgs("test", req)).to.throw(
            /function-typed 'txFn'/
        );
        expect(() => rejectLambdaArgs("test", req)).to.throw(/named-op shape/);
    });

    it("passes valid named-op shape through without throwing", () => {
        expect(() =>
            rejectLambdaArgs("test", { op: "math.add", args: { value: 1 } })
        ).to.not.throw();
    });
});
