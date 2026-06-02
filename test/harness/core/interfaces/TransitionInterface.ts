export type NamedOpRequest = {
    op: string;
    args?: unknown;
};

export interface TransitionInterface {
    submitNext(req: NamedOpRequest): Promise<unknown>;
}
