import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AdminInfo {
  id: string;
  email: string;
  role: 'owner' | 'editor';
}

/** 요청의 로그인 토큰을 확인하고 admins 표에 있는 사람만 통과시킨다. */
export async function requireAdmin(req: Request, db: SupabaseClient, ownerOnly = false): Promise<AdminInfo> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, '로그인이 필요합니다.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, '로그인이 필요합니다.');
  const { data: admin } = await db.from('admins').select('user_id, email, role').eq('user_id', data.user.id).maybeSingle();
  if (!admin) throw new HttpError(403, '관리자만 할 수 있습니다.');
  if (ownerOnly && admin.role !== 'owner') throw new HttpError(403, 'owner만 할 수 있습니다.');
  return { id: admin.user_id, email: admin.email, role: admin.role };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** IP는 해시로만 저장한다. */
export async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown').split(',')[0]!.trim();
  return (await sha256Hex(`${ip}|${Deno.env.get('SUPABASE_URL')}`)).slice(0, 32);
}
