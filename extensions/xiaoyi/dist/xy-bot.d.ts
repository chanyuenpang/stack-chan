import type { OpenClawConfig, RuntimeEnv } from "openclaw/dist/plugin-sdk/index.js";
type ClawdbotConfig = OpenClawConfig;
import type { A2AJsonRpcRequest } from "./types.js";
/**
 * Parameters for handling an XY message.
 */
export interface HandleXYMessageParams {
    cfg: ClawdbotConfig;
    runtime: RuntimeEnv;
    message: A2AJsonRpcRequest;
    accountId: string;
}
/**
 * Handle an incoming A2A message.
 * This is the main entry point for message processing.
 * Runtime is expected to be validated before calling this function.
 */
export declare function handleXYMessage(params: HandleXYMessageParams): Promise<void>;
export {};
