import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type ErrorEnvelope, OpenSdrError, toErrorEnvelope } from '../errors.js';

export const MAX_RESPONSE_BYTES = 60 * 1024;

const TRUNCATION_WARNING =
  'Response exceeded the 60 KB limit and was truncated. Narrow the request or page with next_cursor.';

const ENVELOPE = Symbol('opensdr.envelope');

export interface ResponseMeta {
  demo: boolean;
  sources: string[];
  credits_used_estimate: number;
  cached: boolean;
  truncated: boolean;
  next_cursor: string | null;
}

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  data: T;
  meta: ResponseMeta;
  warnings: string[];
}

function defaultMeta(): ResponseMeta {
  return {
    demo: false,
    sources: [],
    credits_used_estimate: 0,
    cached: false,
    truncated: false,
    next_cursor: null,
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function shrinkValue(data: unknown, fits: () => boolean): unknown {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const arrayKeys = Object.keys(record)
      .filter((key) => Array.isArray(record[key]))
      .sort((a, b) => (record[b] as unknown[]).length - (record[a] as unknown[]).length);
    for (const key of arrayKeys) {
      let list = record[key] as unknown[];
      while (list.length > 0) {
        list = list.slice(0, Math.floor(list.length / 2));
        record[key] = list;
        if (fits()) return record;
      }
    }
  }
  const text = typeof data === 'string' ? data : safeStringify(data);
  return { truncated: true, preview: text.slice(0, 2000) };
}

export function capEnvelope<T>(
  envelope: SuccessEnvelope<T>,
  maxBytes: number = MAX_RESPONSE_BYTES,
): SuccessEnvelope<T> {
  if (byteLength(JSON.stringify(envelope)) <= maxBytes) return envelope;

  const capped: SuccessEnvelope<T> = {
    ...envelope,
    meta: { ...envelope.meta, truncated: true },
    warnings: [...envelope.warnings, TRUNCATION_WARNING],
  };
  const fits = () => byteLength(JSON.stringify(capped)) <= maxBytes;
  if (!fits()) capped.data = shrinkValue(capped.data, fits) as T;
  return capped;
}

function tag(result: CallToolResult, envelope: SuccessEnvelope | ErrorEnvelope): CallToolResult {
  Object.defineProperty(result, ENVELOPE, { value: envelope, enumerable: false });
  return result;
}

export function envelopeOf(result: CallToolResult): SuccessEnvelope | ErrorEnvelope | undefined {
  return (result as CallToolResult & { [ENVELOPE]?: SuccessEnvelope | ErrorEnvelope })[ENVELOPE];
}

export function ok<T>(
  data: T,
  meta: Partial<ResponseMeta> = {},
  warnings: string[] = [],
): CallToolResult {
  const envelope = capEnvelope<T>({
    ok: true,
    data,
    meta: { ...defaultMeta(), ...meta },
    warnings,
  });
  return tag({ content: [{ type: 'text', text: JSON.stringify(envelope) }] }, envelope);
}

/**
 * Like ok(), but refuses to truncate. Write-tool previews must show the user everything the
 * confirmation token covers, so an oversize preview is an error rather than a silent cut.
 */
export function okComplete<T>(
  data: T,
  meta: Partial<ResponseMeta> = {},
  warnings: string[] = [],
  maxBytes: number = MAX_RESPONSE_BYTES,
): CallToolResult {
  const envelope: SuccessEnvelope<T> = {
    ok: true,
    data,
    meta: { ...defaultMeta(), ...meta },
    warnings,
  };
  if (byteLength(JSON.stringify(envelope)) > maxBytes) {
    throw new OpenSdrError({
      code: 'BAD_INPUT',
      message: 'The preview is too large to show in full, so it cannot be confirmed safely.',
      hint: 'Select fewer prospects (for example, split the list into smaller batches) and preview again.',
    });
  }
  return tag({ content: [{ type: 'text', text: JSON.stringify(envelope) }] }, envelope);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === 'object'
  );
}

export function fail(error: unknown): CallToolResult {
  const envelope: ErrorEnvelope = isErrorEnvelope(error) ? error : toErrorEnvelope(error);
  return tag(
    { content: [{ type: 'text', text: JSON.stringify(envelope) }], isError: true },
    envelope,
  );
}

/**
 * The MCP SDK validates tool input against the zod schema before our handler runs and reports
 * failures as plain text. Route those through the envelope so every tool error has one shape.
 */
export function installErrorEnvelope(server: McpServer): void {
  const target = server as unknown as { createToolError?: (message: string) => CallToolResult };
  if (typeof target.createToolError !== 'function') {
    throw new Error('MCP SDK no longer exposes createToolError; update installErrorEnvelope.');
  }
  target.createToolError = (message: string) => {
    const isValidation = /Input validation error|Invalid arguments for tool/.test(message);
    return fail(
      new OpenSdrError({
        code: isValidation ? 'BAD_INPUT' : 'INTERNAL',
        message: message.replace(/^MCP error -?\d+:\s*/, ''),
      }),
    );
  };
}

export function badInput(error: z.ZodError, prefix = 'Invalid input'): OpenSdrError {
  const detail = error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ');
  return new OpenSdrError({ code: 'BAD_INPUT', message: `${prefix}: ${detail}` });
}

type ToolHandler<S extends z.ZodRawShape> = (
  args: z.infer<z.ZodObject<S>>,
  extra: unknown,
) => CallToolResult | Promise<CallToolResult>;

export interface ToolDefinition<S extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  outputSchema?: z.ZodRawShape;
  annotations: ToolAnnotations;
  handler: ToolHandler<S>;
}

export function defineTool<S extends z.ZodRawShape>(
  server: McpServer,
  def: ToolDefinition<S>,
): void {
  const inputObject = z.object(def.inputSchema);

  const handler: ToolHandler<S> = async (args) => {
    try {
      const parsed = inputObject.safeParse(args ?? {});
      if (!parsed.success) return fail(badInput(parsed.error));
      const result = await def.handler(parsed.data as z.infer<z.ZodObject<S>>, undefined);
      if (def.outputSchema) {
        const envelope = envelopeOf(result);
        if (envelope && !result.isError) {
          result.structuredContent = envelope as unknown as Record<string, unknown>;
        }
      }
      return result;
    } catch (error) {
      return fail(error);
    }
  };

  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      annotations: def.annotations,
    },
    handler as unknown as ToolCallback<S>,
  );
}
