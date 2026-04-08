import { runGitNexus } from "./cli.js";

/**
 * gitnexus_explore - Code exploration tool
 */
export function buildExploreTool() {
  return {
    name: "gitnexus_explore",
    label: "代码探索",
    description:
      "探索代码库，理解代码如何工作。通过语义搜索查找执行流程、调用链、架构关系。" +
      "例如：'认证流程是怎样的？'、'这个函数做了什么？'、'哪些代码处理支付？'",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "探索问题，如 '认证流程是怎样的？'" },
        repo: { type: "string", description: "目标仓库名（可选，多个索引时指定）" },
        goal: { type: "string", description: "想找到什么（可选，提高搜索精度）" },
      },
      required: ["query"],
    },
    async execute(_callId, params) {
      const args = ["query", params.query];
      if (params.repo) args.push("-r", params.repo);
      if (params.goal) args.push("-g", params.goal);
      args.push("--content");
      const result = await runGitNexus(args);
      return { content: [{ type: "text", text: result }] };
    },
  };
}

/**
 * gitnexus_debug - Debug tracing tool
 */
export function buildDebugTool() {
  return {
    name: "gitnexus_debug",
    label: "调试追踪",
    description:
      "追踪错误来源，分析失败原因。通过语义搜索定位相关代码和调用链。" +
      "例如：'为什么认证失败？'、'这个错误从哪来的？'、'openclaw 启动报错的原因'",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "调试问题，如 '为什么认证失败？'" },
        repo: { type: "string", description: "目标仓库名（可选）" },
        context: { type: "string", description: "任务上下文（可选，提高调试精度）" },
      },
      required: ["query"],
    },
    async execute(_callId, params) {
      const args = ["query", params.query, "--content"];
      if (params.repo) args.push("-r", params.repo);
      if (params.context) args.push("-c", params.context);
      const result = await runGitNexus(args);
      return { content: [{ type: "text", text: result }] };
    },
  };
}

/**
 * gitnexus_impact - Impact analysis tool
 */
export function buildImpactTool() {
  return {
    name: "gitnexus_impact",
    label: "影响分析",
    description:
      "分析修改某个符号的影响范围（爆炸半径）。查看谁依赖它、修改会破坏什么。" +
      "例如：'改 X 会影响什么？'、'删除这个函数安全吗？'",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "目标符号名，如 'UserService'、'processPayment'" },
        repo: { type: "string", description: "目标仓库名（可选）" },
        direction: {
          type: "string",
          enum: ["upstream", "downstream"],
          description: "分析方向：upstream=谁依赖它（默认），downstream=它依赖谁",
        },
        depth: { type: "number", description: "最大关系深度（默认3）" },
      },
      required: ["target"],
    },
    async execute(_callId, params) {
      const args = ["impact", params.target];
      if (params.repo) args.push("-r", params.repo);
      if (params.direction) args.push("-d", params.direction);
      if (params.depth) args.push("--depth", String(params.depth));
      const result = await runGitNexus(args);
      return { content: [{ type: "text", text: result }] };
    },
  };
}

/**
 * gitnexus_context - 360-degree symbol view
 */
export function buildContextTool() {
  return {
    name: "gitnexus_context",
    label: "符号上下文",
    description:
      "获取代码符号的360度视图：调用者、被调用者、所在流程。" +
      "例如：'UserService 的完整上下文'、'这个函数被哪些地方调用？'",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "符号名称，如 'UserService'、'handleAuth'" },
        repo: { type: "string", description: "目标仓库名（可选）" },
      },
      required: ["name"],
    },
    async execute(_callId, params) {
      const args = ["context", params.name, "--content"];
      if (params.repo) args.push("-r", params.repo);
      const result = await runGitNexus(args);
      return { content: [{ type: "text", text: result }] };
    },
  };
}

/**
 * gitnexus_cli - Repository management tool
 */
export function buildCliTool() {
  return {
    name: "gitnexus_cli",
    label: "GitNexus 管理",
    description:
      "管理 GitNexus 索引仓库。支持：list（列出所有已索引仓库）、status（查看当前仓库索引状态）、clean（删除索引）。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["list", "status", "clean"],
          description: "要执行的管理命令",
        },
      },
      required: ["command"],
    },
    async execute(_callId, params) {
      const result = await runGitNexus([params.command]);
      return { content: [{ type: "text", text: result }] };
    },
  };
}
