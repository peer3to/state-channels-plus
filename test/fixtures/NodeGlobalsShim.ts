// @spec-test-coverage-ignore: worker fixture bootstrap; executable evidence is in nodeGlobalsShim.test.ts and browser gates.
// Must run before EVM imports in explicitly authored worker entries.
import { applyNodeGlobalsShim } from "@/evm/p2pRuntime/worker/applyNodeGlobalsShim";
export { applyNodeGlobalsShim } from "@/evm/p2pRuntime/worker/applyNodeGlobalsShim";
applyNodeGlobalsShim(globalThis);
