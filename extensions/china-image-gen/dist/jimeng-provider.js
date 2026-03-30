import { createHash, createHmac } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";

const VOLCENGINE_API_HOST = "visual.volcengineapi.com";
const VOLCENGINE_API_BASE = `https://${VOLCENGINE_API_HOST}`;
const DEFAULT_REQ_KEY = "jimeng_high_aes_general_v21_L";
const SIGN_REGION = "cn-north-1";
const SIGN_SERVICE = "cv";

// --- Signing helpers ---

function sha256Hex(data) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function toUTCDateString(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function toUTCTimestamp(d) {
  const iso = d.toISOString();
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10)
    + "T" + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + "Z";
}

function buildAuthorization(method, path, queryString, headerMap, bodyPayload, creds, now) {
  const shortDate = toUTCDateString(now);
  const xDate = toUTCTimestamp(now);

  const sortedKeys = Object.keys(headerMap).map((k) => k.toLowerCase()).sort();
  const signedHeaders = sortedKeys.join(";");

  const canonicalHeaders = sortedKeys.map((k) => {
    const origKey = Object.keys(headerMap).find((h) => h.toLowerCase() === k);
    return `${k}:${headerMap[origKey].trim()}`;
  }).join("\n") + "\n";

  const hashedPayload = sha256Hex(bodyPayload);
  const canonicalRequest = [method, path, queryString, canonicalHeaders, signedHeaders, hashedPayload].join("\n");

  const credentialScope = `${shortDate}/${SIGN_REGION}/${SIGN_SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmacSha256(creds.secretAccessKey, shortDate);
  const kRegion = hmacSha256(kDate, SIGN_REGION);
  const kService = hmacSha256(kRegion, SIGN_SERVICE);
  const kSigning = hmacSha256(kService, "request");

  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  return `HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// --- Credential resolution ---

function resolveVolcengineCredentials() {
  return {
    accessKeyId:
      process.env.VOLCENGINE_ACCESS_KEY_ID ||
      process.env.VOLCANO_ENGINE_ACCESS_KEY_ID ||
      "",
    secretAccessKey:
      process.env.VOLCENGINE_ACCESS_KEY_SECRET ||
      process.env.VOLCANO_ENGINE_ACCESS_KEY_SECRET ||
      "",
  };
}

// --- Tool ---

const JimengParams = Type.Object({
  prompt: Type.String({ description: "Image generation prompt (图像描述提示词)" }),
});

export function buildJimengTool() {
  return {
    name: "jimeng_image",
    label: "即梦生图",
    description:
      "Generate images from text prompts using ByteDance Jimeng (Seedream). Produces high-quality creative, artistic, and photorealistic images.",
    parameters: JimengParams,
    async execute(_callId, params) {
      const creds = resolveVolcengineCredentials();
      if (!creds.accessKeyId || !creds.secretAccessKey) {
        return {
          content: [{ type: "text", text: "Error: Jimeng API credentials missing. Set VOLCENGINE_ACCESS_KEY_ID and VOLCENGINE_ACCESS_KEY_SECRET environment variables." }],
          details: { error: true },
        };
      }

      const body = {
        req_key: DEFAULT_REQ_KEY,
        prompt: params.prompt,
        return_url: true,
      };

      const bodyStr = JSON.stringify(body);
      const now = new Date();
      const xDate = toUTCTimestamp(now);
      const contentSha256 = sha256Hex(bodyStr);

      const headerMap = {
        "Content-Type": "application/json",
        "Host": VOLCENGINE_API_HOST,
        "X-Content-Sha256": contentSha256,
        "X-Date": xDate,
      };

      const queryString = "Action=CVProcess&Version=2022-08-31";
      const authorization = buildAuthorization("POST", "/", queryString, headerMap, bodyStr, creds, now);
      const url = `${VOLCENGINE_API_BASE}/?${queryString}`;

      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: { ...headerMap, Authorization: authorization },
          body: bodyStr,
        });
      } catch (err) {
        return {
          content: [{ type: "text", text: `Jimeng request failed: ${err.message}` }],
          details: { error: true },
        };
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return {
          content: [{ type: "text", text: `Jimeng image generation failed (${resp.status}): ${text || resp.statusText}` }],
          details: { error: true },
        };
      }

      const data = await resp.json();

      if (data.code && data.code !== 10000) {
        return {
          content: [{ type: "text", text: `Jimeng API error (${data.code}): ${data.message ?? "unknown"}` }],
          details: { error: true },
        };
      }

      const urls = data.data?.image_urls ?? [];
      const b64s = data.data?.binary_data_base64 ?? [];

      if (urls.length === 0 && b64s.length === 0) {
        return {
          content: [{ type: "text", text: "Jimeng returned no images" }],
          details: { error: true },
        };
      }

      try {
        let buf;
        let mimeType = "image/png";

        if (urls.length > 0) {
          const imgResp = await fetch(urls[0]);
          if (!imgResp.ok) throw new Error(`HTTP ${imgResp.status}`);
          buf = Buffer.from(await imgResp.arrayBuffer());
          mimeType = imgResp.headers.get("content-type") || "image/png";
        } else {
          buf = Buffer.from(b64s[0], "base64");
        }

        const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? ".jpg" : ".png";
        const imgDir = join(tmpdir(), "openclaw-images");
        await mkdir(imgDir, { recursive: true });
        const imgPath = join(imgDir, `jimeng-${randomUUID()}${ext}`);
        await writeFile(imgPath, buf);

        return {
          content: [
            { type: "text", text: `MEDIA:${imgPath}` },
            { type: "image", data: buf.toString("base64"), mimeType },
          ],
          details: { path: imgPath, requestId: data.request_id, model: DEFAULT_REQ_KEY },
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
