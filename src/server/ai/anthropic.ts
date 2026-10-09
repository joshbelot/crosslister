import type { Settings } from '../../shared/types';
import { AppError } from '../errors';
import { aiFetch, aiError, type AiProvider } from './provider';
import { encodeImages } from './images';

const URL = 'https://api.anthropic.com/v1/messages';

export function anthropicProvider(ai: Settings['ai']): AiProvider {
  const key = () => {
    const k = process.env.ANTHROPIC_API_KEY;
    if (!k) throw new AppError('AI_ERROR', 502, "The AI model didn't respond: ANTHROPIC_API_KEY is not set in .env.");
    return k;
  };
  const call = async (model: string, system: string, content: unknown, maxTokens: number) => {
    const res = await aiFetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: 'user', content }] }),
    });
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    if (!text) throw aiError('empty answer');
    return text;
  };
  return {
    name: 'Anthropic',
    async health() {
      if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: 'ANTHROPIC_API_KEY is not set in .env.' };
      if (!ai.textModel) return { ok: false, message: 'Enter an Anthropic model name.' };
      try {
        await call(ai.textModel, 'Reply with the word ok.', 'ok?', 1);
        return { ok: true, message: 'Connected to Anthropic.' };
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },
    async complete(req) {
      const images = encodeImages(req.images);
      const content = images.length
        ? [...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })), { type: 'text', text: req.prompt }]
        : req.prompt;
      return call(images.length ? ai.visionModel : ai.textModel, req.system, content, req.maxTokens ?? 1024);
    },
  };
}
