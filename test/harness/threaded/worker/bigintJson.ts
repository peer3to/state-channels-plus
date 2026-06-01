// BigInt.prototype.toJSON for log payloads; rpc uses structured-clone for BigInt natively.

type BigIntWithToJSON = bigint & { toJSON?: () => number };
const proto = BigInt.prototype as BigIntWithToJSON;
if (typeof proto.toJSON !== "function") {
    proto.toJSON = function (this: bigint): number {
        return Number(this);
    };
}
