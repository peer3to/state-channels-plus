// The harness-control surface for an application's custom RPC, which runs on
// the runtime's own threads. Unlike `test-harness` it never loads the peer
// harness, sessions or scenario actions those threads never use. The
// `test-harness` entry re-exports this list, so the two cannot drift apart.
export {
    HarnessControlRpc,
    withHarnessControl,
    type HarnessControlRpcShape,
    type HarnessControlServices
} from "./test/fixtures/customRpc/harnessControl/HarnessControlRpc";
// Holds and observes actual internal RPC deliveries on a connection.
export { RuntimeRpcControl } from "./test/fixtures/runtimeRpc/RuntimeRpcControl";
// Observes actual roots and connections created while a test operation runs.
export { RootCreationControl } from "./test/fixtures/runtimeRpc/RootCreationControl";
