// Electron 环境：检测是否在 file:// 协议下运行，直接访问后端 URL
// Web 开发环境：同源，Vite proxy 转发 /api/*
function getApiBase(): string {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return 'http://localhost:8765';
  }
  return '';
}

/** M8：数据目录未配置时后端返 503 + {code: "NEEDS_DATA_DIR"}。 */
export class DataDirNotConfiguredError extends Error {
  readonly code = 'NEEDS_DATA_DIR' as const;
  constructor(message = '请先在「设置 · 数据目录」中指定数据目录') {
    super(message);
    this.name = 'DataDirNotConfiguredError';
  }
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown; // 自动 JSON.stringify
  /** M8：置 true 时遇到 NEEDS_DATA_DIR 不重试（queryFn 自己捕获） */
  skipNeedsDataDirRetry?: boolean;
}

/** 带重试的 request（处理 DuckDB 锁冲突） */
async function request<T>(path: string, opts: FetchOptions = {}, retries = 3): Promise<T> {
  const { body, headers, skipNeedsDataDirRetry: _skipNeedsDataDirRetry, ...rest } = opts;
  const apiBase = getApiBase(); // 动态获取
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(apiBase + path, {
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...rest,
    });
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return res.json();
    }
    // 503 + NEEDS_DATA_DIR：不重试，让上层 DataDirGate 处理
    if (res.status === 503) {
      let body: { code?: string; detail?: string } | null = null;
      try { body = await res.json(); } catch { /* ignore */ }
      if (body?.code === 'NEEDS_DATA_DIR') {
        throw new DataDirNotConfiguredError(body.detail);
      }
    }
    // 503/500 且还有重试次数：等一会儿再试（SQLite 锁冲突）
    // 只对 GET 重试，POST/PUT/DELETE 不重试，避免非幂等操作重复执行
    const isSafeMethod = !rest.method || rest.method === 'GET'
    if (isSafeMethod && (res.status === 503 || res.status === 500) && attempt < retries) {
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      continue;
    }
    let detail: string;
    try {
      detail = (await res.json()).detail;
    } catch {
      detail = res.statusText;
    }
    const err = new Error(detail || `HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  // 不应该到这里，但 TypeScript 需要
  throw new Error('请求失败');
}

export const api = {
  get:  <T>(path: string)                    => request<T>(path),
  post: <T>(path: string, body: unknown)     => request<T>(path, { method: 'POST', body }),
  put:  <T>(path: string, body: unknown)     => request<T>(path, { method: 'PUT', body }),
  del:  <T>(path: string)                    => request<T>(path, { method: 'DELETE' }),
};

/** SSE 流式 POST。解析 `data: {...}\n\n` 事件，[DONE] 结束。 */
export async function* streamPost<TChunk>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<TChunk> {
  const apiBase = getApiBase(); // 动态获取
  const res = await fetch(apiBase + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let detail: string
    try { detail = (await res.json()).detail } catch { detail = res.statusText }
    const err = new Error(detail || `HTTP ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const dataLine = event.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) continue
      const payload = dataLine.slice(5).trim()
      if (payload === '[DONE]') return
      yield JSON.parse(payload) as TChunk
    }
  }
}
