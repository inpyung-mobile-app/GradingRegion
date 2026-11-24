import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL 과 VITE_SUPABASE_PUBLISHABLE_KEY 를 환경 변수로 넣어 주세요.');
}

/** 브라우저에는 공개용 키만 둔다. 모든 권한은 DB의 RLS와 Edge Function이 막는다. */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export const functionsUrl = `${url}/functions/v1`;

/** 참가자 화면용 Edge Function 호출(로그인 없이). 오류 응답의 error 문구를 그대로 던진다. */
export async function callPublic<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key!, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? '요청에 실패했습니다.'), { status: res.status, data });
  return data as T;
}

/** 관리자 화면용 Edge Function 호출(로그인 토큰을 붙인다). */
export async function callAdmin<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  const res = await fetch(`${functionsUrl}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key!, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? '요청에 실패했습니다.'), { status: res.status, data });
  return data as T;
}
