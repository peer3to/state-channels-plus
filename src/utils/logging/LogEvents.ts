import { Address, BlockHeight, ChannelId, ForkId } from "@/types/types";

export enum LogEventType {
    // Channel lifecycle
    CHANNEL_OPENED = "channel.opened",
    CHANNEL_CLOSED = "channel.closed",
    FORK_CREATED = "fork.created",

    // State transitions
    TX_EXECUTED = "tx.executed",
    BLOCK_AUTHORING = "block.authoring",
    BLOCK_CREATED = "block.created",
    BLOCK_CONFIRMED = "block.confirmed",
    BLOCK_VALIDATION_FAILED = "block.validation.failed",
    BLOCK_POSTED_ONCHAIN = "block.posted.onchain",

    // P2P events
    RPC_CALL = "rpc.call",
    RPC_RESPONSE = "rpc.response",

    // Disputes & reduction
    DISPUTE_INITIATED = "dispute.initiated",
    DISPUTE_COMMITTED = "dispute.committed",
    SET_REDUCTION_TIMEOUT = "set.reduction.timeout",
    REDUCTION_COMPLETED = "reduction.completed",

    // Snapshots
    SNAPSHOT_POSTED = "snapshot.posted",

    // Gas tracking
    GAS_USED = "gas.used"
}

export interface LogEvent {
    // Core event data
    event?: LogEventType;
    level: "error" | "warn" | "info" | "debug" | "verbose";
    msg: string;

    // Timing
    ts: number;

    // Channel context (auto-populated by context provider)
    channelId?: ChannelId;
    forkId?: ForkId;
    peer?: Address;

    // State context (auto-populated where relevant)
    height?: BlockHeight;

    // Component that generated this
    component: string;

    // Trace ID for connecting related events (e.g., all logs for one transaction)
    traceId?: string;

    // Structured data (varies by event type)
    data?: Record<string, any>;

    // Error details
    err?: {
        msg: string;
        code?: string;
        stack?: string;
    };
}
