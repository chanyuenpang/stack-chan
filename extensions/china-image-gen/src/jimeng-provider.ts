/**
 * 即梦图像生成工具 (火山引擎)
 *
 * 认证方式: HMAC-SHA256 签名 (AccessKeyID + SecretAccessKey)
 * API endpoint: https://visual.volcengineapi.com/?Action=CVProcess&Version=2022-08-31
 */

import * as crypto from "crypto";
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { imageResult } from "openclaw/plugin-sdk/agents/tools/common";

const VOLCENGINE_API_HOST = "visual.volcengineapi.com";
const VOLCENGINE_API_BASE = `https://${VOLCENGINE_API_HOST}`;
const DEFAULT_REQ_KEY = "jimeng_high_aes_general_v21_L";
const SIGN_REGION = "cn-north-1";
const SIGN_SERVICE = "cv";

type JimengApiResponse = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    binary_data_base64?: string[];
    image_urls?: string[];
  };
};

type VolcengineCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

// --- 签名工具函数 ---

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function toUTCDateString(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function toUTCTimestamp(d: Date): string {
  const iso = d.toISOString();
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    "T" +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    "Z"
  );
}

function buildAuthorization(
  method: string,
  path: string,
  queryString: string,
  headerMap: Record<string, string>,
  bodyPayload: string,
  creds: VolcengineCredentials,
  now: Date
): string {
  const shortDate = toUTCDateString(now);
  const xDate = toUTCTimestamp(now);

  const sortedKeys = Object.keys(headerMap)
    .map((k) => k.toLowerCase())
    .sort();
  const signedHeaders = sortedKeys.join(";");

  const canonicalHeaders =
    sortedKeys
      .map((k) => {
        const origKey = Object.keys(headerMap).find(
          (h) => h.toLowerCase() === k
        )!;
        return `${k}:${headerMap[origKey].trim()}`;
      })
      .join("\n") + "\n";

  const hashedPayload = sha256Hex(bodyPayload);
  const canonicalRequest = [
    method,
    path,
    queryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  const credentialScope = `${shortDate}/${SIGN_REGION}/${SIGN_SERVICE}/request`;

  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(creds.secretAccessKey, shortDate);
  const kRegion = hmacSha256(kDate, SIGN_REGION);
  const kService = hmacSha256(kRegion, SIGN_SERVICE);
  const kSigning = hmacSha256(kService, "request");

  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  return `HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// --- 凭证解析 ---

function resolveVolcengineCredentials(): VolcengineCredentials {
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

// --- 工具定义 ---

const JimengParams = Type.Object({
  prompt: Type.String({ description: "图像描述提示词" }),
});

export function buildJimengTool(): AgentTool {
  return {
    name: "jimeng_image",
    label: "即梦生图",
    description:
      "使用字节跳动即梦 (Jimeng/Seedream) 根据文字描述生成图像。擅长生成高质量的创意、艺术和写实图片。",
    parameters: JimengParams,
    async execute(_callId, params): Promise<AgentToolResult<unknown>> {
      const creds = resolveVolcengineCredentials();
      if (!creds.accessKeyId || !creds.secretAccessKey) {
        throw new Error(
          "即梦 API 认证缺失。请设置 VOLCENGINE_ACCESS_KEY_ID 和 VOLCENGINE_ACCESS_KEY_SECRET 环境变量。"
        );
      }

      const reqKey = DEFAULT_REQ_KEY;

      const body: Record<string, unknown> = {
        req_key: reqKey,
        prompt: params.prompt,
        return_url: true,
      };

      const bodyStr = JSON.stringify(body);
      const now = new Date();
      const xDate = toUTCTimestamp(now);
      const contentSha256 = sha256Hex(bodyStr);

      const headerMap: Record<string, string> = {
        "Content-Type": "application/json",
        Host: VOLCENGINE_API_HOST,
        "X-Content-Sha256": contentSha256,
        "X-Date": xDate,
      };

      const queryString = "Action=CVProcess&Version=2022-08-31";

      const authorization = buildAuthorization(
        "POST",
        "/",
        queryString,
        headerMap,
        bodyStr,
        creds,
        now
      );

      const url = `${VOLCENGINE_API_BASE}/?${queryString}`;

      const resp = await fetch(url, {
        method: "POST",
        headers: { ...headerMap, Authorization: authorization },
        body: bodyStr,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
          `即梦图像生成失败 (${resp.status}): ${text || resp.statusText}`
        );
      }

      const data = (await resp.json()) as JimengApiResponse;

      if (data.code && data.code !== 10000) {
        throw new Error(
          `即梦 API 错误 (${data.code}): ${data.message ?? "unknown"}`
        );
      }

      const urls = data.data?.image_urls ?? [];
      const b64s = data.data?.binary_data_base64 ?? [];

      if (urls.length === 0 && b64s.length === 0) {
        throw new Error("即梦未返回图像");
      }

      let buf: Buffer;
      let mimeType = "image/png";

      if (urls.length > 0) {
        const imgResp = await fetch(urls[0]);
        if (!imgResp.ok) {
          throw new Error("无法下载生成的图像");
        }
        buf = Buffer.from(await imgResp.arrayBuffer());
        mimeType = imgResp.headers.get("content-type") || "image/png";
      } else {
        buf = Buffer.from(b64s[0], "base64");
      }

      const ext = mimeType.includes("jpeg") ? "jpg" : "png";
      const tmpPath = `/tmp/jimeng-${Date.now()}.${ext}`;
      const fs = await import("fs/promises");
      await fs.writeFile(tmpPath, buf);

      return imageResult({
        label: `即梦: ${params.prompt.slice(0, 50)}`,
        path: tmpPath,
        base64: buf.toString("base64"),
        mimeType,
        details: { requestId: data.request_id, model: reqKey },
      });
    },
  };
}
