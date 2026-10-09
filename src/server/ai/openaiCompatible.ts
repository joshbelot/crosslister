import type { Settings } from '../../shared/types';
import { aiFetch, aiError, type AiProvider } from './provider';
import { encodeImages } from './images';

export function openaiCompatibleProvider(ai: Settings['ai']): AiProvider {
  const base = ai.baseUrl.replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY || 'local'}` });
  return {
    name: 'OpenAI-compatible server',
    async health() {
      try {
        const res = await aiFetch(`${base}/models`, { method: 'GET', headers: headers() });
        const body = (await res.json()) as { data?: Array<{ id?: string }> };
        const models = (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
        for (const name of new Set([ai.textModel, ai.visionModel])) {
          if (name && models.length > 0 && !models.includes(name)) return { ok: false, message: `Model ${name} was not found on the server.`, models };
        }
        return { ok: true, message: 'The server is reachable.', models };
      } catch (err) {
        return { ok: false, message: `Can't reach ${base}. (${(err as Error).message})` };
      }
    },
    async complete(req) {
      const images = encodeImages(req.images);
      const content = images.length
        ? [{ type: 'text', text: req.prompt }, ...images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b}` } }))]
        : req.prompt;
      const res = await aiFetch(`${base}/chat/completions`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({
          model: images.length ? ai.visionModel : ai.textModel, temperature: 0.2,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: req.system }, { role: 'user', content }],
        }),
      });
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content;
      if (!text) throw aiError('empty answer');
      return text;
    },
  };
}
