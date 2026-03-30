import { Type } from "@sinclair/typebox";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_MODEL = "wan2.6-t2i";

function resolveDashScopeApiKey(cfg) {
  const envKey = process.env.DASHSCOPE_API_KEY;
  if (envKey) return envKey;
  const providerCfg = cfg?.models?.providers?.dashscope;
  if (providerCfg?.apiKey) return providerCfg.apiKey;
  return undefined;
}

function resolveDashScopeBaseUrl(cfg) {
  const direct = cfg?.models?.providers?.dashscope?.baseUrl?.trim();
  if (direct) {
    try { return new URL(direct).origin; } catch {}
  }
  return DASHSCOPE_BASE_URL;
}

const DashScopeParams = Type.Object({
  prompt: Type.String({ description: "Image generation prompt (图像描述提示词)" }),
  size: Type.Optional(
    Type.String({ description: "Image size, e.g. 1024*1024, 1280*960" })
  ),
});

// ToolFactory: called per agent session, receives fresh context
export function dashScopeToolFactory(ctx) {
  const cfg = ctx?.config;
  return {
    name: "dashscope_image",
    label: "通义万相生图",
    description:
      "Generate images from text prompts using Alibaba DashScope Wanxiang model. Produces high-quality art, illustrations, and photorealistic images.",
    parameters: DashScopeParams,
    async execute(_callId, params) {
      const apiKey = resolveDashScopeApiKey(cfg);
      if (!apiKey) {
        return {
          content: [{ type: "text", text: "Error: DashScope API key missing. Set DASHSCOPE_API_KEY env var or configure models.providers.dashscope.apiKey in openclaw.json." }],
          details: { error: true },
        };
      }

      const baseUrl = resolveDashScopeBaseUrl(cfg);
      const url = `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;

      const body = {
        model: DEFAULT_MODEL,
        input: {
          messages: [{ role: "user", content: [{ text: params.prompt }] }],
        },
        parameters: {
          n: 1,
          prompt_extend: true,
          watermark: false,
          ...(params.size ? { size: params.size.replace("x", "*") } : {}),
        },
      };

      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        return {
          content: [{ type: "text", text: `DashScope request failed: ${err.message}` }],
          details: { error: true },
        };
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return {
          content: [{ type: "text", text: `DashScope image generation failed (${resp.status}): ${text || resp.statusText}` }],
          details: { error: true },
        };
      }

      const data = await resp.json();

      if (data.code && data.message) {
        return {
          content: [{ type: "text", text: `DashScope API error (${data.code}): ${data.message}` }],
          details: { error: true },
        };
      }

      const imageUrls = (data.output?.choices ?? [])
        .flatMap((c) => c.message?.content ?? [])
        .filter((c) => c.type === "image" && c.image)
        .map((c) => c.image);

      if (imageUrls.length === 0) {
        return {
          content: [{ type: "text", text: "DashScope returned no images" }],
          details: { error: true },
        };
      }

      try {
        const imgResp = await fetch(imageUrls[0]);
        if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
        const ab = await imgResp.arrayBuffer();
        const buf = Buffer.from(ab);
        const mimeType = imgResp.headers.get("content-type") || "image/png";

        const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? ".jpg" : ".png";
        const imgDir = join(tmpdir(), "openclaw-images");
        await mkdir(imgDir, { recursive: true });
        const imgPath = join(imgDir, `dashscope-${randomUUID()}${ext}`);
        await writeFile(imgPath, buf);

        return {
          content: [
            { type: "text", text: `MEDIA:${imgPath}` },
            { type: "image", data: buf.toString("base64"), mimeType },
          ],
          details: { path: imgPath, requestId: data.request_id, model: DEFAULT_MODEL },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to download image: ${err.message}` }],
          details: { error: true },
        };
      }
    },
  };
}
