# Runtime Isolation and Concurrency — Implementation

> **Specification subject:** [Runtime Isolation and Concurrency](../../../specification/runtime/execution.md)

## INTEGRATION-TEST-RUNTIME-1-G147DN

- Specification: [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- Specification tests: All applicable specification permutations
- Setup: Exercise the complete concrete subsystem through each documented entry and failure boundary.
- Oracle: The subsystem preserves the neutral behavior and contains failure without partial state.

- [ ] `INTEGRATION-TEST-RUNTIME-1-G147DN.P7` — boundary integration. Root creation and startup failure
