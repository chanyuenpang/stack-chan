/**
 * QQ Bot 斜杠指令处理模块
 *
 * 支持的指令：
 * - /echo <message>    直接回复消息（不经过 AI）
 * - /debug             切换 debug 模式（开启后附带链路耗时统计）
 * - /upgrade           自动执行插件更新
 */
import type { ResolvedQQBotAccount } from "./types.js";
export declare function isDebugEnabled(peerId: string): boolean;
export declare function setDebugEnabled(peerId: string, enabled: boolean): void;
export interface TimingTrace {
    /** QQ 平台事件时间戳 */
    eventTimestamp?: string;
    /** 收到 QQ WebSocket 消息的时间 */
    messageReceivedAt: number;
    /** 发送给 OpenClaw 的时间 */
    dispatchToOpenClawAt?: number;
    /** 消息发送完成的时间 */
    sendCompleteAt?: number;
}
/** 格式化耗时统计为可读文本 */
export declare function formatTimingTrace(trace: TimingTrace): string;
export interface SlashCommandResult {
    /** 是否是斜杠指令（true 表示已处理，不需要继续走 AI） */
    handled: boolean;
}
interface SendContext {
    type: "c2c" | "guild" | "dm" | "group";
    senderId: string;
    messageId: string;
    channelId?: string;
    groupOpenid?: string;
    account: ResolvedQQBotAccount;
    peerId: string;
    log?: {
        info: (msg: string) => void;
        error: (msg: string) => void;
        debug?: (msg: string) => void;
    };
}
/**
 * 尝试处理斜杠指令
 *
 * @returns handled=true 表示该消息已作为指令处理，不需要继续走 AI 管道
 */
export declare function handleSlashCommand(content: string, ctx: SendContext, receivedAt?: number, eventTimestamp?: string): Promise<SlashCommandResult>;
export {};
