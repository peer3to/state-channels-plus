// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";

/** Observe real connections while fixture-owned SDK setup is running. */
export class RootCreationControl {
    public static readonly roots = new Set<AInternalRpcRoot>();
    private static readonly observers = new Set<
        (root: AInternalRpcRoot) => void
    >();
    private static restoreObservation?: () => void;

    public static track(root: AInternalRpcRoot): void {
        if (this.roots.has(root)) return;
        this.roots.add(root);
        root.onClosed(() => this.roots.delete(root));
    }

    public static connection(
        root: AInternalRpcRoot,
        remoteRoot: RemoteRoot<AInternalRpcRoot>
    ) {
        const connection = [...root.connections.values()].find(
            (entry) => entry === remoteRoot
        );
        if (!connection)
            throw new Error("Root connection is no longer registered");
        return connection;
    }

    public static connections(
        root: AInternalRpcRoot,
        observe: (connection: RemoteRoot<AInternalRpcRoot>) => void
    ): void {
        for (const connection of root.connections.values()) observe(connection);
        const connect = root.connect;
        root.connect = function <T extends AInternalRpcRoot>(
            ...args: Parameters<typeof connect<T>>
        ) {
            const connection = connect.bind(this)<T>(...args);
            observe(connection);
            return connection;
        };
        root.onClosed(() => {
            root.connect = connect;
        });
    }

    public static async observe<T>(
        run: () => Promise<T>,
        observe?: (root: AInternalRpcRoot) => void
    ): Promise<T> {
        const seen = new Set(RootCreationControl.roots);
        const observer = (root: AInternalRpcRoot) => {
            if (seen.has(root)) return;
            seen.add(root);
            observe?.(root);
        };
        if (!this.restoreObservation) {
            const startRuntime = AInternalRpcRoot.prototype.startRuntime;
            AInternalRpcRoot.prototype.startRuntime = function (...args) {
                RootCreationControl.track(this);
                return startRuntime.apply(this, args);
            };
            const connect = AInternalRpcRoot.prototype.connect;
            AInternalRpcRoot.prototype.connect = function <
                T extends AInternalRpcRoot
            >(...args: Parameters<typeof connect<T>>) {
                const connection = connect.bind(this)<T>(...args);
                for (const listener of RootCreationControl.observers)
                    listener(this);
                return connection;
            };
            this.restoreObservation = () => {
                AInternalRpcRoot.prototype.connect = connect;
                AInternalRpcRoot.prototype.startRuntime = startRuntime;
            };
        }
        this.observers.add(observer);
        try {
            return await run();
        } finally {
            this.observers.delete(observer);
            if (!this.observers.size) {
                this.restoreObservation?.();
                this.restoreObservation = undefined;
            }
        }
    }
}
