// src/hcri/lightsApi.ts
//
// The hCRI.io "lights" API (api/lights.php, reached with the same personal API token uploads use). A light groups several
// readings (reports) of the same flashlight; the server keeps the order, the categories and the trend numbers.

import { HCRI_API_BASE } from './apiConfig';
import fetchWithTimeout from './fetchWithTimeout';

const BASE = `${HCRI_API_BASE}/index.php/api/v1/lights`;

export const LIGHT_KINDS = ['light_brand', 'light_model', 'led_brand', 'led_model', 'led_cct', 'optic'] as const;
export type LightKind = typeof LIGHT_KINDS[number];

export interface ServerReading {
  id: string;            // public report id (the same id an upload returns)
  label: string;
  linkLabel?: string;
  isPublic: boolean;
  createdAt: string;
  cct: number | null; duv: number | null; ra: number | null; r9: number | null; rf: number | null; rg: number | null; lux: number | null;
}
export interface MetricStat { latest: number | null; first?: number | null; change?: number | null; n: number }
export interface ServerLight {
  id: number;
  name: string;
  notes: string;
  categories: Partial<Record<LightKind, { id: number; value: string }[]>>;
  isPublic: boolean;
  count: number;
  stats: Record<string, MetricStat>;
  series: Record<string, (number | null)[]>;
  readings?: ServerReading[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetchWithTimeout(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    if (!res.ok) return { ok: false, status: res.status, error: data?.error || `Server answered ${res.status}` };
    return { ok: true, data: data as T };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || 'Could not reach hCRI.io' };
  }
}

/** 'ok' = the token works; 'invalid' = the server rejected it; 'offline' = could not ask. */
export async function checkLightsToken(token: string): Promise<'ok' | 'invalid' | 'offline'> {
  if (!token) return 'invalid';
  const r = await call<ServerLight[]>(token, 'GET', '');
  if (r.ok) return 'ok';
  return r.status === 401 || r.status === 403 ? 'invalid' : 'offline';
}

export const listServerLights = (t: string) => call<ServerLight[]>(t, 'GET', '');
export const getServerLight = (t: string, id: number) => call<ServerLight>(t, 'GET', `/${id}`);
export const createServerLight = (t: string, name: string, notes: string) => call<ServerLight>(t, 'POST', '', { name, notes });
export const patchServerLight = (t: string, id: number, name: string, notes: string) => call<ServerLight>(t, 'PATCH', `/${id}`, { name, notes });
export const deleteServerLight = (t: string, id: number) => call<{ deleted: boolean }>(t, 'DELETE', `/${id}`);
export const setServerCategories = (t: string, id: number, kind: LightKind, values: string[]) => call<{ categories: unknown }>(t, 'POST', `/${id}/categories`, { kind, values });
export const attachServerReports = (t: string, id: number, reportIds: (string | number)[]) => call<{ added: number; light: ServerLight }>(t, 'POST', `/${id}/reports`, { reportIds });
export const orderServerReports = (t: string, id: number, reportIds: (string | number)[]) => call<ServerLight>(t, 'POST', `/${id}/reports/order`, { reportIds });
export const removeServerReport = (t: string, id: number, reportId: string | number) => call<{ removed: boolean }>(t, 'DELETE', `/${id}/reports/${reportId}`);
