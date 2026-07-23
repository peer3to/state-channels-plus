// Must run before any EVM/stream import pulls in Node globals.
import "./nodeGlobalsShim";

import { startP2pRuntimeWorker } from "./startP2pRuntimeWorker";

startP2pRuntimeWorker();
