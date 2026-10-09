import { z } from 'zod';
import type { Settings } from '../../shared/types';
import { AppError } from '../errors';
import { anthropicProvider } from './anthropic';
import { ollamaProvider } from './ollama';
import { openaiCompatibleProvider } from './openaiCompatible';

export interface AiRequest { system: string; prompt: string; images?: string[] /* absolute file paths */; json: boolean; maxTokens?: number }
export interface AiProvider {
  name: string;
  health(): Promise<{ ok: boolean; message: string; models?: string[] }>;
  complete(req: AiRequest): Promise<string>;
}

export const AI_TIMEOUT_MS = 120_000;

let override: AiProvider | null = null;
/** Tests only: replace the provider for every call (pass null to restore). */
export function __setProviderForTest(p: AiProvider | null): void { override = p; }

export function getProvider(settings: Settings): AiProvider {
  if (override) return override;
  if (!settings.ai.enabled) throw new AppError('AI_DISABLED', 400, 'AI is turned off in Settings.');
  switch (settings.ai.provider) {
    case 'ollama': return ollamaProvider(settings.ai);
    case 'openai_compatible': return openaiCompatibleProvider(settings.ai);
    case 'anthropic': return anthropicProvider(settings.ai);
  }
}

export const aiError = (reason: string) => new AppError('AI_ERROR', 502, `The AI model didn't respond: ${reason}`);

/** fetch with the shared timeout; network and HTTP failures become AI_ERROR. */
export async function aiFetch(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
  } catch (err) {
    const e = err as Error;
    throw aiError(e.name === 'TimeoutError' ? 'it took too long' : e.message);
  }
  if (!res.ok) throw aiError(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
  return res;
}

/** Strip code fences, take the first `{…}` block and parse it. Returns undefined when nothing parses. */
export function parseJsonLoose(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(stripped.slice(start, end + 1)); } catch { return undefined; }
}

/** Ask for JSON, validate with `schema`; retry once with a reminder, then give up with AI_ERROR. */
export async function completeJson<T>(provider: AiProvider, req: Omit<AiRequest, 'json'>, schema: z.ZodType<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? req.prompt : `${req.prompt}\n\nReturn only valid JSON.`;
    const text = await provider.complete({ ...req, prompt, json: true });
    const parsed = schema.safeParse(parseJsonLoose(text));
    if (parsed.success) return parsed.data;
  }
  throw aiError('it did not return a usable answer');
}
