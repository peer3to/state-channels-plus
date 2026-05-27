// W2 - side-effect import. install BigInt.prototype.toJSON so log payloads
// stringify cleanly. NOT load-bearing for the rpc kernel (structured-clone
// handles BigInt natively); purely for log printing inside the worker.

type BigIntWithToJSON = bigint & { toJSON?: () => number };
const proto = BigInt.prototype as BigIntWithToJSON;
if (typeof proto.toJSON !== "function") {
    proto.toJSON = function (this: bigint): number {
        return Number(this);
    };
}
