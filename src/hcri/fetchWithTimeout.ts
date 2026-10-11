// src/hcri/fetchWithTimeout.ts
//
// fetch() with a deadline and friendly errors. Plain fetch never times out on a stalled
// connection (the spinner would hang forever) and rejects with the unhelpful
// "Network request failed" when offline. This wrapper aborts after `timeoutMs` and rethrows
// those two cases with messages worth showing the user; other errors pass through untouched.

export const DEFAULT_TIMEOUT_MS = 25000;
export const UPLOAD_TIMEOUT_MS = 60000;

export const OFFLINE_MESSAGE = "Can't reach hCRI.io. Check your internet connection and try again.";
export const TIMEOUT_MESSAGE = 'hCRI.io took too long to respond. Check your connection and try again.';

export class NetworkError extends Error {
  kind: 'offline' | 'timeout';
  constructor(kind: 'offline' | 'timeout') {
    super(kind === 'offline' ? OFFLINE_MESSAGE : TIMEOUT_MESSAGE);
    this.name = 'NetworkError';
    this.kind = kind;
  }
}

export default async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (timedOut || e?.name === 'AbortError') throw new NetworkError('timeout');
    if (e instanceof TypeError || /network request failed/i.test(String(e?.message))) throw new NetworkError('offline');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
