export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData, keepalive = false): Promise<T> {
  const headers: Record<string, string> = { 'X-Crosslister': '1' };
  let payload: BodyInit | undefined;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, keepalive });
  } catch {
    throw new ApiError(0, 'NETWORK', "Couldn't reach the app server. Is it running?");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status}).`, err?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  /** Best-effort PATCH that survives page unloads. */
  patchKeepalive: (path: string, body: unknown) => request<unknown>('PATCH', path, body, undefined, true).catch(() => undefined),
  del: (path: string) => request<void>('DELETE', path),
  upload<T>(path: string, files: File[]): Promise<T> {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return request<T>('POST', path, undefined, form);
  },
};
