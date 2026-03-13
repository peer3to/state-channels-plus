import axios from "axios";

function countAgentEntries(
    entries?: Record<string, unknown[]>
): number | undefined {
    if (!entries) return undefined;

    return Object.values(entries).reduce(
        (total, sockets) => total + sockets.length,
        0
    );
}

function describeNodeAgent(agent: any) {
    if (!agent) return undefined;

    return {
        keepAlive: Boolean(agent.keepAlive),
        maxSockets: agent.maxSockets,
        maxFreeSockets: agent.maxFreeSockets,
        activeSockets: countAgentEntries(agent.sockets),
        freeSockets: countAgentEntries(agent.freeSockets),
        queuedRequests: countAgentEntries(agent.requests)
    };
}

export function getSyncNetworkSnapshot(
    endpoint: string,
    uploadError?: unknown
) {
    if (typeof process === "undefined" || typeof window !== "undefined") {
        return undefined;
    }

    const memoryUsage = process.memoryUsage();
    const resourceUsage = process.resourceUsage();
    const activeHandles = (process as any)._getActiveHandles?.();
    const activeRequests = (process as any)._getActiveRequests?.();

    const http = require("http");
    const https = require("https");

    const request = axios.isAxiosError(uploadError)
        ? (uploadError.request as any)
        : undefined;
    const socket = request?.socket;

    return {
        process: {
            pid: process.pid,
            uptimeSec: Number(process.uptime().toFixed(3)),
            activeHandles: Array.isArray(activeHandles)
                ? activeHandles.length
                : undefined,
            activeRequests: Array.isArray(activeRequests)
                ? activeRequests.length
                : undefined,
            memoryMB: {
                rss: Number((memoryUsage.rss / 1e6).toFixed(3)),
                heapUsed: Number((memoryUsage.heapUsed / 1e6).toFixed(3)),
                external: Number((memoryUsage.external / 1e6).toFixed(3))
            },
            cpuMicros: {
                user: resourceUsage.userCPUTime,
                system: resourceUsage.systemCPUTime
            },
            fsReads: resourceUsage.fsRead,
            fsWrites: resourceUsage.fsWrite
        },
        endpoint,
        agents: {
            httpGlobal: describeNodeAgent(http.globalAgent),
            httpsGlobal: describeNodeAgent(https.globalAgent)
        },
        request: request
            ? {
                  reusedSocket: request.reusedSocket,
                  finished: request.finished,
                  destroyed: request.destroyed,
                  writableEnded: request.writableEnded,
                  socket: socket
                      ? {
                            connecting: socket.connecting,
                            destroyed: socket.destroyed,
                            localAddress: socket.localAddress,
                            localPort: socket.localPort,
                            remoteAddress: socket.remoteAddress,
                            remotePort: socket.remotePort,
                            bytesWritten: socket.bytesWritten,
                            bytesRead: socket.bytesRead
                        }
                      : undefined
              }
            : undefined
    };
}

export async function getDnsLookupSnapshot(endpoint: string) {
    if (typeof process === "undefined" || typeof window !== "undefined") {
        return undefined;
    }

    try {
        const { URL } = require("url");
        const dns = require("dns").promises;
        const parsedUrl = new URL(endpoint);
        const startedAt = Date.now();
        const dnsResult = await dns.lookup(parsedUrl.hostname);

        return {
            hostname: parsedUrl.hostname,
            address: dnsResult.address,
            family: dnsResult.family,
            lookupMs: Date.now() - startedAt
        };
    } catch (dnsError) {
        return {
            error: String(dnsError)
        };
    }
}

export function getAxiosRetrySummary(uploadError: unknown) {
    if (!axios.isAxiosError(uploadError)) {
        return { code: undefined, status: undefined };
    }

    return {
        code: uploadError.code,
        status: uploadError.response?.status
    };
}

export function sanitizeAxiosErrorForLogging(uploadError: unknown): void {
    if (!axios.isAxiosError(uploadError) || !uploadError.config) {
        return;
    }

    delete (uploadError.config as any).data;
}

export function getAxiosFailureSummary(uploadError: unknown) {
    if (!axios.isAxiosError(uploadError)) {
        return {
            code: undefined,
            status: undefined,
            statusText: undefined,
            timeout: undefined,
            requestUploadId: undefined,
            responseUploadId: undefined
        };
    }

    return {
        code: uploadError.code,
        status: uploadError.response?.status,
        statusText: uploadError.response?.statusText,
        timeout: uploadError.config?.timeout,
        requestUploadId: uploadError.config?.headers?.["x-upload-id"],
        responseUploadId: uploadError.response?.headers?.["x-upload-id"]
    };
}
