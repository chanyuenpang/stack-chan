import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildDashScopeTool } from "./dashscope-provider.js";
import { buildJimengTool } from "./jimeng-provider.js";

export default definePluginEntry({
  id: "china-image-gen",
  name: "China Image Generation",
  description: "通义万相和即梦图像生成工具（国内可用）",
  register(api) {
    api.registerTool(buildDashScopeTool(api.config));
    api.registerTool(buildJimengTool());
  },
});
