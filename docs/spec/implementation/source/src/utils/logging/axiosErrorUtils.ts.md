# axiosErrorUtils.ts

> **Source:** [src/utils/logging/axiosErrorUtils.ts](../../../../../../../src/utils/logging/axiosErrorUtils.ts)

No specified behavior: HTTP-error normalization for the uploader.

## UNIT-TEST-AXIOS-ERROR-1-Y9R801

The uploader's error helpers without loading axios

- Setup: Load the package index in a fresh node process; call `isAxiosError` on a real `AxiosError`, plain objects with `isAxiosError` set to `true` and to `"true"`, a plain `Error`, `null` and a string.
- Oracle: Whether the process holds an `axios` module, and each answer next to axios's own `axios.isAxiosError` for the same value. Forbidden: the index loading axios, which only an upload needs.

- [x] `UNIT-TEST-AXIOS-ERROR-1-Y9R801.P1` — node loading the package index holds no `axios` module
- [x] `UNIT-TEST-AXIOS-ERROR-1-Y9R801.P2` — `isAxiosError` answers every probe value as `axios.isAxiosError` does
