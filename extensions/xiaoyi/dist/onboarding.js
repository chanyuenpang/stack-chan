"use strict";
/**
 * XiaoYi onboarding adapter for CLI setup wizard.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.xiaoyiOnboardingAdapter = void 0;
const channel = "xiaoyi";
/**
 * Get XiaoYi channel config from OpenClaw config
 */
function getXiaoYiConfig(cfg) {
    return cfg?.channels?.xiaoyi;
}
/**
 * Check if XiaoYi is properly configured
 */
function isXiaoYiConfigured(config) {
    if (!config) {
        return false;
    }
    // Check required fields: ak, sk, agentId
    // wsUrl1/wsUrl2 are optional (defaults will be used if not provided)
    const hasAk = typeof config.ak === "string" && config.ak.trim().length > 0;
    const hasSk = typeof config.sk === "string" && config.sk.trim().length > 0;
    const hasAgentId = typeof config.agentId === "string" && config.agentId.trim().length > 0;
    return hasAk && hasSk && hasAgentId;
}
/**
 * Set XiaoYi channel configuration
 */
function setXiaoYiConfig(cfg, config) {
    const existing = getXiaoYiConfig(cfg);
    const merged = {
        enabled: config.enabled ?? existing?.enabled ?? true,
        wsUrl: config.wsUrl ?? existing?.wsUrl ?? "",
        wsUrl1: config.wsUrl1 ?? existing?.wsUrl1 ?? "",
        wsUrl2: config.wsUrl2 ?? existing?.wsUrl2 ?? "",
        ak: config.ak ?? existing?.ak ?? "",
        sk: config.sk ?? existing?.sk ?? "",
        agentId: config.agentId ?? existing?.agentId ?? "",
        enableStreaming: config.enableStreaming ?? existing?.enableStreaming ?? true,
    };
    return {
        ...cfg,
        channels: {
            ...cfg.channels,
            xiaoyi: merged,
        },
    };
}
/**
 * Note about XiaoYi setup
 */
async function noteXiaoYiSetupHelp(prompter) {
    await prompter.note([
        "XiaoYi (小艺) uses A2A protocol via WebSocket connection.",
        "",
        "Required credentials:",
        "  - ak: Access Key for authentication",
        "  - sk: Secret Key for authentication",
        "  - agentId: Your agent identifier",
        "",
        "WebSocket URLs will use default values.",
        "",
        "Docs: https://docs.openclaw.ai/channels/xiaoyi",
    ].join("\n"), "XiaoYi setup");
}
/**
 * Prompt for Access Key
 */
async function promptAk(prompter, config) {
    const existing = config?.ak ?? "";
    return String(await prompter.text({
        message: "XiaoYi Access Key (ak)",
        initialValue: existing,
        validate: (value) => (value?.trim() ? undefined : "Required"),
    })).trim();
}
/**
 * Prompt for Secret Key
 */
async function promptSk(prompter, config) {
    const existing = config?.sk ?? "";
    return String(await prompter.text({
        message: "XiaoYi Secret Key (sk)",
        initialValue: existing,
        validate: (value) => (value?.trim() ? undefined : "Required"),
    })).trim();
}
/**
 * Prompt for Agent ID
 */
async function promptAgentId(prompter, config) {
    const existing = config?.agentId ?? "";
    return String(await prompter.text({
        message: "XiaoYi Agent ID",
        initialValue: existing,
        validate: (value) => (value?.trim() ? undefined : "Required"),
    })).trim();
}
exports.xiaoyiOnboardingAdapter = {
    channel,
    getStatus: async ({ cfg }) => {
        const config = getXiaoYiConfig(cfg);
        const configured = isXiaoYiConfigured(config);
        const enabled = config?.enabled !== false;
        const statusLines = [];
        if (configured) {
            statusLines.push(`XiaoYi: ${enabled ? "enabled" : "disabled"}`);
            if (config?.wsUrl1 || config?.wsUrl) {
                statusLines.push(`  WebSocket: ${config.wsUrl1 || config.wsUrl}`);
            }
            if (config?.wsUrl2) {
                statusLines.push(`  Secondary: ${config.wsUrl2}`);
            }
            if (config?.agentId) {
                statusLines.push(`  Agent ID: ${config.agentId}`);
            }
        }
        else {
            statusLines.push("XiaoYi: needs ak, sk, and agentId");
        }
        return {
            channel,
            configured,
            statusLines,
            selectionHint: configured ? "configured" : "needs setup",
            quickstartScore: 50,
        };
    },
    configure: async ({ cfg, prompter }) => {
        const config = getXiaoYiConfig(cfg);
        if (!isXiaoYiConfigured(config)) {
            await noteXiaoYiSetupHelp(prompter);
        }
        else {
            const reconfigure = await prompter.confirm({
                message: "XiaoYi already configured. Reconfigure?",
                initialValue: false,
            });
            if (!reconfigure) {
                return { cfg, accountId: "default" };
            }
        }
        // Prompt for required credentials
        const ak = await promptAk(prompter, config);
        const sk = await promptSk(prompter, config);
        const agentId = await promptAgentId(prompter, config);
        const cfgWithConfig = setXiaoYiConfig(cfg, {
            ak,
            sk,
            agentId,
            enabled: true,
        });
        return { cfg: cfgWithConfig, accountId: "default" };
    },
    disable: (cfg) => {
        const xiaoyi = getXiaoYiConfig(cfg);
        return {
            ...cfg,
            channels: {
                ...cfg.channels,
                xiaoyi: { ...xiaoyi, enabled: false },
            },
        };
    },
};
