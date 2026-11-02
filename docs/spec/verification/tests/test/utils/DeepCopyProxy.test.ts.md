# DeepCopyProxy.test.ts

Test file: [test/utils/DeepCopyProxy.test.ts](../../../../../../../test/utils/DeepCopyProxy.test.ts)
Exercises: [DeepCopyProxy.ts](../../../../../implementation/source/src/utils/DeepCopyProxy.ts.md)

## Overview

The suite wraps a small holder object with `deepCopyProxy` and mutates what comes back: the value an asynchronous method resolves to, and the argument passed to a method named in `preserveArgumentsFor`.

## Tests

- `copies the value an asynchronous read resolves to`: REQ-STOR-6-SKP0KM.T1.P7
- `passes the arguments of a preserved method through uncopied`: none
