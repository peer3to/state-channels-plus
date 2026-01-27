import { Address } from "@/types/types";

export interface LoggerContext {
    peerId?: number;
    peerAddress?: Address;
    component?: string;
    [key: string]: any; // Allow additional metadata properties
}

export type Logger = {
    level?: string;
    debug: (message: any, meta?: any, ...args: any[]) => void;
    info: (message: any, meta?: any, ...args: any[]) => void;
    warn: (message: any, meta?: any, ...args: any[]) => void;
    error: (message: any, meta?: any, ...args: any[]) => void;
    verbose: (message: any, meta?: any, ...args: any[]) => void;
    child: (context: LoggerContext) => Logger;
    group: (label?: string) => void;
    groupEnd: () => void;
    clear?: () => void;
    close?: () => void;
    // For crash handler
    getAllLogs: () => any[];
    clearLogs: () => void;
};
