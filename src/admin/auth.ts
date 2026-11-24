import { navigate } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';

export interface AdminInfo { userId: string; email: string; role: 'owner' | 'editor' }
let current: AdminInfo | null | undefined;

export async function loadAdmin(force = false): Promise<AdminInfo | null> {
  if (!force && current !== undefined) return current;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return (current = null);
  const { data: row } = await supabase.from('admins').select('user_id, email, role').eq('user_id', user.id).maybeSingle();
  current = row ? { userId: row.user_id, email: row.email, role: row.role as 'owner' | 'editor' } : null;
  return current;
}

export function admin(): AdminInfo {
  if (!current) throw new Error('관리자 정보가 없습니다.');
  return current;
}

/** 로그인한 관리자만 통과시킨다. 아니면 로그인 화면으로 보낸다. */
export async function guard(): Promise<AdminInfo | null> {
  const a = await loadAdmin();
  if (!a) { navigate('/admin/login', true); return null; }
  return a;
}

export async function signOut() {
  current = undefined;
  await supabase.auth.signOut();
  navigate('/admin/login');
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') current = undefined;
});
