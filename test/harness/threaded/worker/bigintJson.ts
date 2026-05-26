// W2 - side-effect import. install BigInt.prototype.toJSON so log payloads
// stringify cleanly. NOT load-bearing for the rpc kernel (structured-clone
// handles BigInt natively); purely for log printing inside the worker.

if (typeof (BigInt.prototype as { toJSON?: unknown }).toJSON !== "function") {
    (BigInt.prototype as unknown as { toJSON: () => number }).toJSON =
        function () {
            return Number(this as unknown as bigint);
        };
}
