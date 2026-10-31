export interface HostHandlerExecutionContext {
    runHandler<T>(handlerBody: () => T): T;
    /** Called once at the runtime's disposal cut-off. */
    dispose?(): void;
}
