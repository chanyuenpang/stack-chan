import { Type } from "@sinclair/typebox";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MODEL = "doubao-seedream-4-0-250828";

function resolveArkApiKey(cfg) {
  const envKey = process.env.ARK_API_KEY || process.env.VOLCANO_ENGINE_API_KEY;
  if (envKey) return envKey;
  const providerCfg = cfg?.models?.providers?.volcengine;
  if (providerCfg?.apiKey) return providerCfg.apiKey;
  return undefined;
}

const SeedreamParams = Type.Object({
  prompt: Type.String({ description: "Image generation prompt (图像描述提示词)" }),
  size: Type.Optional(
    Type.String({ description: "Image size, e.g. 1024x1024, 1280x720, 720x1280. Default: 1024x1024" })
  ),
});

export function seedreamToolFactory(ctx) {
  const cfg = ctx?.config;
  return {
    name: "seedream_image",
    label: "豆包生图",
    description:
      "Generate images from text prompts using Volcengine Doubao Seedream model. Produces high-quality creative and photorealistic images. Supports Chinese prompts well.",
    parameters: SeedreamParams,
    async execute(_callId, params) {
      const apiKey = resolveArkApiKey(cfg);
      if (!apiKey) {
        return {
          content: [{ type: "text", text: "Error: Volcengine ARK API key missing. Set ARK_API_KEY or VOLCANO_ENGINE_API_KEY env var, or configure models.providers.volcengine.apiKey in openclaw.json." }],
          details: { error: true },
        };
      }

      const url = `${ARK_API_BASE}/images/generations`;
      const body = {
        model: DEFAULT_MODEL,
        prompt: params.prompt,
        size: params.size || "1024x1024",
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
          content: [{ type: "text", text: `Seedream request failed: ${err.message}` }],
          details: { error: true },
        };
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return {
          content: [{ type: "text", text: `Seedream image generation failed (${resp.status}): ${text || resp.statusText}` }],
          details: { error: true },
        };
      }

      const data = await resp.json();

      if (data.error) {
        return {
          content: [{ type: "text", text: `Seedream API error: ${data.error.message || JSON.stringify(data.error)}` }],
          details: { error: true },
        };
      }

      const images = data.data ?? [];
      if (images.length === 0) {
        return {
          content: [{ type: "text", text: "Seedream returned no images" }],
          details: { error: true },
        };
      }

      const img = images[0];

      try {
        let buf;
        let mimeType = "image/png";

        if (img.b64_json) {
          buf = Buffer.from(img.b64_json, "base64");
        } else if (img.url) {
          const imgResp = await fetch(img.url);
          if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
          buf = Buffer.from(await imgResp.arrayBuffer());
          mimeType = imgResp.headers.get("content-type") || "image/png";
        } else {
          return {
            content: [{ type: "text", text: "Seedream returned no image data" }],
            details: { error: true },
          };
        }

        const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? ".jpg" : ".png";
        const imgDir = join(tmpdir(), "openclaw-images");
        await mkdir(imgDir, { recursive: true });
        const imgPath = join(imgDir, `seedream-${randomUUID()}${ext}`);
        await writeFile(imgPath, buf);

        return {
          content: [
            { type: "text", text: `MEDIA:${imgPath}` },
            { type: "image", data: buf.toString("base64"), mimeType },
          ],
          details: { path: imgPath, model: DEFAULT_MODEL },
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
