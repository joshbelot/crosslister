import type { Settings } from '../../shared/types';
import { aiFetch, aiError, type AiProvider } from './provider';
import { encodeImages } from './images';

export function ollamaProvider(ai: Settings['ai']): AiProvider {
  const base = ai.baseUrl.replace(/\/+$/, '');
  return {
    name: 'Ollama',
    async health() {
      try {
        const res = await aiFetch(`${base}/api/tags`, { method: 'GET' });
        const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
        const models = (body.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
        const has = (name: string) => models.some((m) => m === name || m === `${name}:latest`);
        for (const name of new Set([ai.textModel, ai.visionModel])) {
          if (name && !has(name)) return { ok: false, message: `Model ${name} not found. Run: ollama pull ${name}`, models };
        }
        return { ok: true, message: 'Ollama is running.', models };
      } catch (err) {
        return { ok: false, message: `Can't reach Ollama at ${base}. Is it running? (${(err as Error).message})` };
      }
    },
    async complete(req) {
      const images = encodeImages(req.images);
      const model = images.length ? ai.visionModel : ai.textModel;
      const res = await aiFetch(`${base}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, stream: false, ...(req.json ? { format: 'json' } : {}),
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt, ...(images.length ? { images } : {}) },
          ],
          options: { temperature: 0.2, ...(req.maxTokens ? { num_predict: req.maxTokens } : {}) },
        }),
      });
      const body = (await res.json()) as { message?: { content?: string } };
      if (!body.message?.content) throw aiError('empty answer');
      return body.message.content;
    },
  };
}
