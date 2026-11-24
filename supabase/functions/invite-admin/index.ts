// owner가 관리자를 초대하거나 세션을 끊는다. 자유 가입은 막혀 있고, 여기서 만든 계정만 admins에 들어간다.
import { HttpError, json, serve, str } from '../_shared/http.ts';
import { requireAdmin, serviceClient } from '../_shared/supabase.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req, body) => {
  const db = serviceClient();
  const owner = await requireAdmin(req, db, true);
  const action = str(body.action, 20) || 'invite';

  if (action === 'invite') {
    const email = str(body.email, 200).toLowerCase();
    const role = body.role === 'owner' ? 'owner' : 'editor';
    if (!EMAIL.test(email)) throw new HttpError(400, '이메일 주소를 확인해 주세요.');

    // 이미 있는 계정이면 재사용, 없으면 새로 만든다(메일 확인은 매직 링크로 로그인할 때 끝난다).
    let userId: string | undefined;
    const created = await db.auth.admin.createUser({ email, email_confirm: true });
    if (created.data.user) userId = created.data.user.id;
    else {
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id;
    }
    if (!userId) throw new HttpError(500, '계정을 만들지 못했습니다.');

    const { error } = await db.from('admins').upsert({ user_id: userId, email, role, added_by: owner.id });
    if (error) throw new HttpError(500, '관리자로 등록하지 못했습니다.');
    return json({ ok: true, userId, email, role });
  }

  if (action === 'revoke_sessions') {
    const userId = str(body.user_id, 40);
    const { data: target } = await db.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
    if (!target) throw new HttpError(404, '관리자를 찾을 수 없습니다.');
    const { data } = await db.rpc('revoke_sessions', { p_user: userId });
    return json({ ok: true, revoked: data });
  }

  throw new HttpError(400, '알 수 없는 동작입니다.');
});
