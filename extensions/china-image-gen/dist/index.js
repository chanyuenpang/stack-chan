import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { dashScopeToolFactory } from "./dashscope-provider.js";
import { buildJimengTool } from "./jimeng-provider.js";
import { seedreamToolFactory } from "./seedream-provider.js";

const plugin = {
  id: "china-image-gen",
  name: "China Image Generation",
  description: "通义万相、即梦和豆包生图图像生成工具（国内可用）",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    // ToolFactory: receives ctx with fresh config per agent session
    api.registerTool(dashScopeToolFactory);
    // Static tool: reads credentials from env vars only
    api.registerTool(buildJimengTool());
    // ToolFactory: Volcengine ARK Seedream model
    api.registerTool(seedreamToolFactory);
  },
};

export default plugin;
