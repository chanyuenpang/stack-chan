import { z } from 'zod';
/**
 * XiaoYi configuration schema using Zod
 * Defines the structure for XiaoYi A2A protocol configuration
 */
export declare const XiaoYiConfigSchema: z.ZodObject<{
    /** Account name (optional display name) */
    name: z.ZodOptional<z.ZodString>;
    /** Whether this channel is enabled */
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    /** First WebSocket server URL */
    wsUrl1: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    /** Second WebSocket server URL */
    wsUrl2: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    /** Access Key for authentication */
    ak: z.ZodOptional<z.ZodString>;
    /** Secret Key for authentication */
    sk: z.ZodOptional<z.ZodString>;
    /** Agent ID for this XiaoYi agent */
    agentId: z.ZodOptional<z.ZodString>;
    /** Enable debug logging */
    debug: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    /** Multi-account configuration */
    accounts: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    enabled?: boolean;
    wsUrl1?: string;
    wsUrl2?: string;
    ak?: string;
    sk?: string;
    agentId?: string;
    name?: string;
    debug?: boolean;
    accounts?: Record<string, unknown>;
}, {
    enabled?: boolean;
    wsUrl1?: string;
    wsUrl2?: string;
    ak?: string;
    sk?: string;
    agentId?: string;
    name?: string;
    debug?: boolean;
    accounts?: Record<string, unknown>;
}>;
export type XiaoYiConfig = z.infer<typeof XiaoYiConfigSchema>;
