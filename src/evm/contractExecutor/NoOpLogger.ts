import type { Logger } from "@/utils";

const noop = () => {};

const noOpLogger = {
    child: () => noOpLogger,
    debug: noop,
    warn: noop,
    info: noop,
    error: noop,
    verbose: noop
} as unknown as Logger;

export default noOpLogger;
