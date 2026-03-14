/**
 * QQ Bot 斜杠指令处理模块
 *
 * 支持的指令：
 * - /echo <message>    直接回复消息（不经过 AI）
 * - /debug             切换 debug 模式（开启后附带链路耗时统计）
 * - /upgrade           自动执行插件更新
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getAccessToken, sendC2CMessage, sendGroupMessage, sendChannelMessage, clearTokenCache, } from "./api.js";
const execAsync = promisify(exec);
// ============ Debug 模式管理 ============
/** 每个会话（peerId）独立的 debug 开关 */
const debugSessions = new Map();
export function isDebugEnabled(peerId) {
    return debugSessions.get(peerId) === true;
}
export function setDebugEnabled(peerId, enabled) {
    if (enabled) {
        debugSessions.set(peerId, true);
    }
    else {
        debugSessions.delete(peerId);
    }
}
/** 格式化耗时统计为可读文本 */
export function formatTimingTrace(trace) {
    const lines = ["📊 链路耗时统计"];
    const t0 = trace.messageReceivedAt;
    const eventTs = trace.eventTimestamp ? new Date(trace.eventTimestamp).getTime() : 0;
    const platformDelay = eventTs > 0 ? `${t0 - eventTs}ms` : "N/A";
    lines.push(`├ 平台→QQBot插件: ${platformDelay}`);
    if (trace.dispatchToOpenClawAt) {
        lines.push(`├ QQBot插件耗时: ${trace.dispatchToOpenClawAt - t0}ms`);
    }
    if (trace.sendCompleteAt && trace.dispatchToOpenClawAt) {
        lines.push(`└ OpenClaw耗时: ${trace.sendCompleteAt - trace.dispatchToOpenClawAt}ms`);
    }
    return lines.join("\n");
}
/** 发送带 token 重试的消息 */
async function sendReply(ctx, text) {
    const { type, senderId, messageId, channelId, groupOpenid, account } = ctx;
    const send = async (token) => {
        if (type === "c2c") {
            await sendC2CMessage(token, senderId, text, messageId);
        }
        else if (type === "group" && groupOpenid) {
            await sendGroupMessage(token, groupOpenid, text, messageId);
        }
        else if (channelId) {
            await sendChannelMessage(token, channelId, text, messageId);
        }
    };
    try {
        const token = await getAccessToken(account.appId, account.clientSecret);
        await send(token);
    }
    catch (err) {
        const errMsg = String(err);
        if (errMsg.includes("401") || errMsg.includes("token") || errMsg.includes("access_token")) {
            clearTokenCache(account.appId);
            const newToken = await getAccessToken(account.appId, account.clientSecret);
            await send(newToken);
        }
        else {
            throw err;
        }
    }
}
// ============ 指令处理 ============
/** 处理 /echo 指令 */
async function handleEcho(ctx, args, receivedAt, eventTimestamp) {
    const message = args.trim();
    if (message) {
        await sendReply(ctx, message);
    }
    // 计算事件时间戳 → 插件收到消息的延迟（QQ 平台 → WebSocket 传输耗时）
    const eventTs = eventTimestamp ? new Date(eventTimestamp).getTime() : 0;
    const platformDelay = eventTs > 0 ? `${receivedAt - eventTs}ms` : "N/A";
    const timing = [
        "⏱ 通道耗时",
        `├ 事件时间: ${eventTs > 0 ? new Date(eventTs).toISOString() : "N/A"}`,
        `├ 平台→插件: ${platformDelay}`,
        `└ 插件处理: ${Date.now() - receivedAt}ms`,
    ].join("\n");
    await sendReply(ctx, timing);
}
/** 处理 /debug 指令 */
async function handleDebug(ctx) {
    const current = isDebugEnabled(ctx.peerId);
    const next = !current;
    setDebugEnabled(ctx.peerId, next);
    const status = next
        ? "🔍 Debug 模式已开启\n后续消息回复将附带链路耗时统计"
        : "🔕 Debug 模式已关闭";
    await sendReply(ctx, status);
}
/** 处理 /upgrade 指令 */
async function handleUpgrade(ctx) {
    await sendReply(ctx, "⏳ 正在执行插件更新，请稍候...");
    // 检测 CLI 名称
    let cmdName = "";
    for (const name of ["openclaw", "clawdbot", "moltbot"]) {
        try {
            await execAsync(`command -v ${name}`);
            cmdName = name;
            break;
        }
        catch {
            // not found, try next
        }
    }
    if (!cmdName) {
        await sendReply(ctx, "❌ 更新失败: 未找到 openclaw / clawdbot / moltbot CLI");
        return;
    }
    const PKG_NAME = "@tencent-connect/openclaw-qqbot";
    const steps = [];
    let hasError = false;
    try {
        // [1/2] 直接安装最新版本（覆盖安装，不先 uninstall 避免触发框架自动重启）
        steps.push("[1/2] 安装最新版本...");
        try {
            const { stdout, stderr } = await execAsync(`${cmdName} plugins install "${PKG_NAME}@latest"`, { timeout: 120000 });
            const output = (stdout + "\n" + stderr).trim();
            if (output) {
                const lines = output.split("\n").filter(l => l.trim());
                steps.push(...lines.slice(0, 10).map(l => `  ${l}`));
                if (lines.length > 10) {
                    steps.push(`  ... (${lines.length - 10} more lines)`);
                }
            }
            steps.push("  ✅ 安装成功");
        }
        catch (installErr) {
            const errOutput = installErr instanceof Error ? installErr.stderr || installErr.message : String(installErr);
            steps.push(`  ❌ 安装失败: ${String(errOutput).slice(0, 200)}`);
            hasError = true;
        }
    }
    catch (err) {
        steps.push(`❌ 更新过程出错: ${String(err).slice(0, 200)}`);
        hasError = true;
    }
    // 先发送结果汇总（必须在重启之前发送，否则进程被杀后无法发送）
    if (!hasError) {
        steps.push("[2/2] 即将重启网关...");
    }
    const header = hasError ? "❌ 插件更新完成（有错误）" : "✅ 插件更新完成";
    const result = `${header}\n${"=".repeat(30)}\n${steps.join("\n")}`;
    try {
        await sendReply(ctx, result);
    }
    catch (sendErr) {
        ctx.log?.error(`[qqbot] Failed to send upgrade result: ${sendErr}`);
    }
    // 最后再重启网关（重启会杀掉当前进程，之后的代码不会执行）
    if (!hasError) {
        try {
            await execAsync(`${cmdName} gateway restart`, { timeout: 30000 });
        }
        catch (restartErr) {
            const errOutput = restartErr instanceof Error ? restartErr.stderr || restartErr.message : String(restartErr);
            ctx.log?.error(`[qqbot] Gateway restart failed: ${errOutput}`);
        }
    }
}
// ============ 指令分发 ============
/**
 * 尝试处理斜杠指令
 *
 * @returns handled=true 表示该消息已作为指令处理，不需要继续走 AI 管道
 */
export async function handleSlashCommand(content, ctx, receivedAt, eventTimestamp) {
    const trimmed = content.trim();
    if (!trimmed.startsWith("/")) {
        return { handled: false };
    }
    // 解析指令名和参数
    const spaceIdx = trimmed.indexOf(" ");
    const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
    const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
    ctx.log?.info(`[qqbot:${ctx.account.accountId}] Slash command: ${command}, args: ${args.slice(0, 50)}`);
    try {
        switch (command) {
            case "/echo":
                await handleEcho(ctx, args, receivedAt ?? Date.now(), eventTimestamp);
                return { handled: true };
            case "/debug":
                await handleDebug(ctx);
                return { handled: true };
            case "/upgrade":
                await handleUpgrade(ctx);
                return { handled: true };
            default:
                // 不是已知指令，交给 AI 处理
                return { handled: false };
        }
    }
    catch (err) {
        ctx.log?.error(`[qqbot:${ctx.account.accountId}] Slash command error: ${err}`);
        try {
            await sendReply(ctx, `❌ 指令执行失败: ${String(err).slice(0, 200)}`);
        }
        catch {
            // 发送错误消息也失败了，只能记日志
        }
        return { handled: true };
    }
}
