import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { __setProviderForTest, completeJson, getProvider, parseJsonLoose, type AiProvider } from '../../src/server/ai/provider';
import { ollamaProvider } from '../../src/server/ai/ollama';
import { openaiCompatibleProvider } from '../../src/server/ai/openaiCompatible';
import { anthropicProvider } from '../../src/server/ai/anthropic';
import { createTestApp, req, type TestApp } from '../helpers/testApp';

const ai = (over: Record<string, unknown> = {}) => ({ enabled: true, provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', textModel: 'gemma3:4b', visionModel: 'gemma3:4b', ...over });
const settings = (over: Record<string, unknown> = {}) => ({ ai: ai(over) }) as never;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => { vi.restoreAllMocks(); __setProviderForTest(null); });

describe('parseJsonLoose / completeJson', () => {
  it('strips code fences and surrounding prose', () => {
    expect(parseJsonLoose('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('no json here')).toBeUndefined();
    expect(parseJsonLoose('{broken')).toBeUndefined();
  });
  it('retries once with a reminder, then fails with AI_ERROR', async () => {
    const prompts: string[] = [];
    const bad: AiProvider = { name: 't', health: async () => ({ ok: true, message: '' }), complete: async (r) => { prompts.push(r.prompt); return prompts.length === 1 ? 'nope' : '{"x":"ok"}'; } };
    await expect(completeJson(bad, { system: 's', prompt: 'p' }, z.object({ x: z.string() }))).resolves.toEqual({ x: 'ok' });
    expect(prompts[1]).toContain('Return only valid JSON.');
    const always: AiProvider = { ...bad, complete: async () => 'nope' };
    await expect(completeJson(always, { system: 's', prompt: 'p' }, z.object({ x: z.string() }))).rejects.toMatchObject({ code: 'AI_ERROR', status: 502 });
  });
});

describe('getProvider', () => {
  it('throws AI_DISABLED when AI is off', () => {
    expect(() => getProvider(settings({ enabled: false }))).toThrowError(/turned off/);
  });
  it('picks the configured provider', () => {
    expect(getProvider(settings()).name).toBe('Ollama');
    expect(getProvider(settings({ provider: 'openai_compatible', baseUrl: 'http://x/v1' })).name).toMatch(/OpenAI/);
    expect(getProvider(settings({ provider: 'anthropic' })).name).toBe('Anthropic');
  });
});

describe('Ollama', () => {
  it('health: reports a missing model with the pull command', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ models: [{ name: 'llama3:8b' }] }));
    const h = await ollamaProvider(ai()).health();
    expect(h).toMatchObject({ ok: false, message: 'Model gemma3:4b not found. Run: ollama pull gemma3:4b' });
  });
  it('health: ok when present (":latest" counts)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ models: [{ name: 'gemma3:4b' }] }));
    expect((await ollamaProvider(ai()).health()).ok).toBe(true);
  });
  it('complete: sends the chat request with images and json format', async () => {
    const img = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cl-ai-')), 'a.jpg');
    fs.writeFileSync(img, 'bytes');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ message: { content: '{"ok":true}' } }));
    const out = await ollamaProvider(ai()).complete({ system: 'S', prompt: 'P', images: [img], json: true });
    expect(out).toBe('{"ok":true}');
    const body = JSON.parse(String(spy.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ model: 'gemma3:4b', stream: false, format: 'json', options: { temperature: 0.2 } });
    expect(body.messages[1].images).toEqual([Buffer.from('bytes').toString('base64')]);
  });
  it('turns failures into AI_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(ollamaProvider(ai()).complete({ system: 's', prompt: 'p', json: false })).rejects.toMatchObject({ code: 'AI_ERROR' });
  });
});

describe('OpenAI-compatible and Anthropic', () => {
  it('OpenAI-compatible sends bearer auth and response_format', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ choices: [{ message: { content: 'hi' } }] }));
    const p = openaiCompatibleProvider(ai({ provider: 'openai_compatible', baseUrl: 'http://127.0.0.1:1234/v1', textModel: 'm' }));
    expect(await p.complete({ system: 's', prompt: 'p', json: true })).toBe('hi');
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer local');
    expect(JSON.parse(String(init!.body)).response_format).toEqual({ type: 'json_object' });
  });
  it('Anthropic needs a key and uses the messages API', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await anthropicProvider(ai({ provider: 'anthropic', textModel: 'm' })).health()).ok).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'k';
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ content: [{ type: 'text', text: 'ok' }] }));
    const p = anthropicProvider(ai({ provider: 'anthropic', textModel: 'm' }));
    expect(await p.complete({ system: 's', prompt: 'p', json: false })).toBe('ok');
    const init = spy.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect((await p.health()).ok).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('GET /api/ai/health', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.cleanup(); });
  it('is a 400 AI_DISABLED when AI is off, and returns provider health when injected', async () => {
    const off = await req(t.app, 'GET', '/api/ai/health');
    expect(off.statusCode).toBe(400);
    expect(off.json().error.code).toBe('AI_DISABLED');
    __setProviderForTest({ name: 'fake', health: async () => ({ ok: true, message: 'fine', models: ['m'] }), complete: async () => '' });
    expect((await req(t.app, 'GET', '/api/ai/health')).json()).toEqual({ ok: true, message: 'fine', models: ['m'] });
  });
});
