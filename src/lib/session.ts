// 참가자가 조회한 결과를 이 탭에서만 기억한다(새로고침해도 유지, 탭을 닫으면 사라짐).
import { callPublic } from './supabase.ts';
import type { ModuleView } from '../../shared/view.ts';

export interface ViewedModule extends ModuleView {
  code: string;
  title: string | null;
  images: Record<string, string>;
  graded: { commit: string | null; zip: boolean; late: boolean };
  updatedAt: string;
}
export interface ViewedResult {
  contest: { slug: string; name: string; leaderboard_mode: string };
  participant: { name: string; anonNo: number | null };
  modules: ViewedModule[];
}

const KEY = (slug: string) => `gr:cred:${slug}`;
let cache: { slug: string; data: ViewedResult } | null = null;

export function saveCreds(slug: string, name: string, code: string) {
  try { sessionStorage.setItem(KEY(slug), JSON.stringify({ name, code })); } catch { /* 저장 못 해도 동작 */ }
}
export function loadCreds(slug: string): { name: string; code: string } | null {
  try {
    const raw = sessionStorage.getItem(KEY(slug));
    return raw ? (JSON.parse(raw) as { name: string; code: string }) : null;
  } catch { return null; }
}
export function clearCreds(slug: string) {
  cache = null;
  try { sessionStorage.removeItem(KEY(slug)); } catch { /* 무시 */ }
}
export function cachedResult(slug: string): ViewedResult | null {
  return cache?.slug === slug ? cache.data : null;
}

export async function fetchResult(slug: string, name: string, code: string): Promise<ViewedResult> {
  const data = await callPublic<ViewedResult>('view-result', { slug, name, code });
  cache = { slug, data };
  saveCreds(slug, name, code);
  return data;
}

/** 저장된 이름과 코드로 다시 조회한다. 없으면 null. */
export async function refetchResult(slug: string): Promise<ViewedResult | null> {
  const c = loadCreds(slug);
  if (!c) return null;
  try { return await fetchResult(slug, c.name, c.code); } catch { clearCreds(slug); return null; }
}
