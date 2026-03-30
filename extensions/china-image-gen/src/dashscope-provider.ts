/**
 * 通义万相图像生成工具 (阿里云 DashScope)
 */

import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { imageResult } from "openclaw/plugin-sdk/agents/tools/common";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/agents/model-auth";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config/config";

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_MODEL = "wan2.6-t2i";

type DashScopeImageResponse = {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{
          type?: string;
          image?: string;
        }>;
      };
    }>;
  };
  request_id?: string;
  code?: string;
  message?: string;
};

function resolveDashScopeBaseUrl(cfg?: OpenClawConfig): string {
  const direct = cfg?.models?.providers?.dashscope?.baseUrl?.trim();
  if (direct) {
    try {
      return new URL(direct).origin;
    } catch {
      // ignore
    }
  }
  return DASHSCOPE_BASE_URL;
}

const DashScopeParams = Type.Object({
  prompt: Type.String({ description: "图像描述提示词" }),
  size: Type.Optional(
    Type.String({ description: "图片尺寸，如 1024*1024、1280*960 等" })
  ),
});

export function buildDashScopeTool(cfg?: OpenClawConfig): AgentTool {
  return {
    name: "dashscope_image",
    label: "通义万相生图",
    description:
      "使用阿里云通义万相 (DashScope) 根据文字描述生成图像。适合生成高质量的艺术、插画、写实风格图片。",
    parameters: DashScopeParams,
    async execute(_callId, params): Promise<AgentToolResult<unknown>> {
      const auth = await resolveApiKeyForProvider({
        provider: "dashscope",
        cfg,
      });

      if (!auth.apiKey) {
        throw new Error(
          "DashScope API key 缺失。请设置 DASHSCOPE_API_KEY 环境变量或在 openclaw.json 中配置 models.providers.dashscope.apiKey"
        );
      }

      const baseUrl = resolveDashScopeBaseUrl(cfg);
      const url = `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;

      const body: Record<string, unknown> = {
        model: DEFAULT_MODEL,
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: params.prompt }],
            },
          ],
        },
        parameters: {
          n: 1,
          prompt_extend: true,
          watermark: false,
          ...(params.size ? { size: params.size.replace("x", "*") } : {}),
        },
      };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
          `DashScope 图像生成失败 (${resp.status}): ${text || resp.statusText}`
        );
      }

      const data = (await resp.json()) as DashScopeImageResponse;

      if (data.code && data.message) {
        throw new Error(`DashScope API 错误 (${data.code}): ${data.message}`);
      }

      const imageUrls = (data.output?.choices ?? [])
        .flatMap((c) => c.message?.content ?? [])
        .filter((c) => c.type === "image" && c.image)
        .map((c) => c.image!);

      if (imageUrls.length === 0) {
        throw new Error("DashScope 未返回图像");
      }

      // 下载第一张图并返回
      const imgResp = await fetch(imageUrls[0]);
      if (!imgResp.ok) {
        throw new Error("无法下载生成的图像");
      }
      const ab = await imgResp.arrayBuffer();
      const buf = Buffer.from(ab);
      const mimeType = imgResp.headers.get("content-type") || "image/png";
      const ext = mimeType.includes("jpeg") ? "jpg" : "png";

      const tmpPath = `/tmp/dashscope-${Date.now()}.${ext}`;
      const fs = await import("fs/promises");
      await fs.writeFile(tmpPath, buf);

      return imageResult({
        label: `通义万相: ${params.prompt.slice(0, 50)}`,
        path: tmpPath,
        base64: buf.toString("base64"),
        mimeType,
        details: { requestId: data.request_id, model: DEFAULT_MODEL },
      });
    },
  };
}
