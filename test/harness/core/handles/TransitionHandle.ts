export type NamedOpRequest = {
    op: string;
    args?: unknown;
};

export interface TransitionHandle {
    submitNext(req: NamedOpRequest): Promise<unknown>;
}
