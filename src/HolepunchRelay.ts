import { RelayerPool } from "@/transport/relay/RelayerPool";
import { Logger } from "@/utils";
import { DetachedPromises } from "@/utils/DetachedPromises";

type RelayModules = { DHT: any; Stream: any; Hyperswarm: any };

let relayModules: RelayModules | undefined;
let relayModulesLoad: Promise<RelayModules> | undefined;

/**
 * Loaded on the first relay connection, not with the SDK: the relay's crypto
 * instantiates five WebAssembly modules when it loads, and each one holds a
 * WebAssembly memory. Every thread that loads the SDK (the page, the VM
 * worker) paid them; only the thread that runs the relay needs them.
 */
export function loadRelayModules(): Promise<RelayModules> {
    return (relayModulesLoad ??= Promise.all([
        //@ts-ignore
        import("@hyperswarm/dht-relay"),
        //@ts-ignore
        import("@hyperswarm/dht-relay/ws"),
        //@ts-ignore
        import("hyperswarm")
    ]).then(
        ([dht, stream, hyperswarm]) =>
            (relayModules = {
                DHT: dht.default,
                Stream: stream.default,
                Hyperswarm: hyperswarm.default
            })
    ));
}

class HolepunchRelay {
    relayerUrls: string[];
    updateCallback: Function;
    swarm: any;
    logger: Logger;
    private relayerPool: RelayerPool;
    private socket?: WebSocket;
    private isDisposed = false;

    private static instance: HolepunchRelay;

    public static init(
        relayerUrls: string[],
        updateCallback: Function,
        logger: Logger
    ): HolepunchRelay {
        HolepunchRelay.instance = new HolepunchRelay(
            relayerUrls,
            updateCallback,
            logger
        );
        HolepunchRelay.instance.connect();
        return HolepunchRelay.instance;
    }
    public static getInstance(): HolepunchRelay {
        if (!HolepunchRelay.instance)
            throw new Error("HolepunchRelay not initialized");
        return HolepunchRelay.instance;
    }
    public getSwarm(): any {
        return this.swarm;
    }

    /**
     * Stops reconnecting and releases the socket before closing it: the
     * socket closes after its runtime's logger is disposed, and its handlers
     * act only for the current socket, so nothing logs or reconnects after.
     */
    public dispose(): void {
        this.isDisposed = true;
        this.relayerPool.dispose();
        const socket = this.socket;
        this.socket = undefined;
        socket?.close();
    }

    /**
     * Connects at once when the relay modules are loaded (every reconnect),
     * else once they are. A failed load is an internal failure: it is fatal,
     * never retried.
     */
    private connect(): void {
        if (relayModules) return this.connectToRelayer(relayModules);
        DetachedPromises.observe(
            loadRelayModules().then((modules) => {
                if (!this.isDisposed) this.connectToRelayer(modules);
            }),
            (error) => {
                throw error;
            }
        );
    }

    /**
     * The URLs were checked at construction. The WebSocket constructor still
     * throws for one it can never open (a blocked port): a configuration
     * error, which is fatal and not retried. A connection failure arrives
     * only as the socket's error or close event, or as the relay's failed
     * opening.
     */
    private connectToRelayer({ DHT, Stream, Hyperswarm }: RelayModules): void {
        if (this.relayerUrls.length === 0) {
            this.logger.warn("No holepunch relayers configured");
            return;
        }

        const relayerUrl = this.relayerPool.next();
        this.logger.info("Connecting to holepunch relayer", {
            relayerUrl
        });
        if (!relayerUrl) return;
        const ws = new WebSocket(relayerUrl);
        this.socket = ws;
        const isCurrent = () => this.socket === ws;
        // One failure per socket: the first of its error event, its close
        // event and the relay's failed opening counts. Disposal releases
        // the socket, so nothing counts after it.
        let hasFailed = false;
        const fail = (failure: Error | Event) => {
            if (hasFailed || !isCurrent()) return;
            hasFailed = true;
            this.relayerPool.onFailure(
                relayerUrl,
                relayerFailure(relayerUrl, failure),
                () => this.connect()
            );
        };
        const dht = new DHT(new Stream(true, ws));
        // The relay rejects its opening when the socket fails before it
        // opens: with the socket's error event, or its own Error.
        dht.ready().catch(fail);
        this.swarm = new Hyperswarm({
            dht: dht
        });
        ws.onopen = () => {
            if (!isCurrent()) return;
            this.logger.info("Holepunch relayer connected", {
                relayerUrl
            });
            this.relayerPool.onSuccess();
        };
        ws.onclose = fail;
        ws.onerror = fail;

        this.updateCallback();
    }

    private constructor(
        relayerUrls: string[],
        updateCallback: Function,
        logger: Logger
    ) {
        for (const relayerUrl of relayerUrls) assertRelayerUrl(relayerUrl);
        this.relayerUrls = relayerUrls;
        this.updateCallback = updateCallback;
        this.logger = logger.child({ component: "HolepunchRelay" });
        this.relayerPool = new RelayerPool(relayerUrls, this.logger);
    }
}

/**
 * A relayer URL that is not a ws: or wss: URL is a configuration error: it
 * throws at construction, not when a failover first selects it.
 */
function assertRelayerUrl(relayerUrl: string): void {
    const protocol = URL.canParse(relayerUrl)
        ? new URL(relayerUrl).protocol
        : undefined;
    if (protocol !== "ws:" && protocol !== "wss:")
        throw new Error(
            `Invalid holepunch relayer URL "${relayerUrl}": expected a ws: or wss: URL`
        );
}

/**
 * The one conversion of a relay failure into the Error the pool logs; it
 * names the relayer. A socket fails with an `Event`, which has no message:
 * the Error names its type, and a close event's code and reason. The relay's
 * own Error becomes the cause.
 */
function relayerFailure(relayerUrl: string, failure: Error | Event): Error {
    if (failure instanceof Error)
        return Object.assign(
            new Error(
                `Holepunch relayer ${relayerUrl} failed to open: ${failure.message}`
            ),
            { cause: failure }
        );
    const close = failure as Partial<CloseEvent>;
    const detail =
        close.code === undefined
            ? ""
            : ` (code ${close.code}${close.reason ? `, reason ${close.reason}` : ""})`;
    return new Error(
        `Holepunch relayer ${relayerUrl} ${failure.type} event${detail}`
    );
}

export default HolepunchRelay;
