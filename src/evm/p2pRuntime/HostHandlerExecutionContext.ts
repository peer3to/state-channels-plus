export interface HostHandlerExecutionContext {
    runHandler<T>(handlerBody: () => T): T;
}
