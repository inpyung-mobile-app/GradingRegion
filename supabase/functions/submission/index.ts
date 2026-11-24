// 참가자가 이름과 확인 코드로 제출 현황을 보고, 백업 zip을 올린다.
import { HttpError, json, serve, str } from '../_shared/http.ts';
import { ipHash, serviceClient } from '../_shared/supabase.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const GENERIC_FAIL = '이름 또는 확인 코드가 맞지 않습니다.';

async function authParticipant(req: Request, db: SupabaseClient, body: Record<string, unknown>) {
  const slug = str(body.slug, 80);
  const name = str(body.name, 40);
  const code = str(body.code, 40);
  if (!slug || !name || !code) throw new HttpError(400, '이름과 확인 코드를 입력해 주세요.');
  const { data: contest } = await db.from('contests').select('id, slug, name, github_org').eq('slug', slug).eq('is_public', true).maybeSingle();
  if (!contest) throw new HttpError(401, GENERIC_FAIL);
  const ip = await ipHash(req);
  const { data: blocked } = await db.rpc('lookup_blocked', { p_contest: contest.id, p_name: name, p_ip: ip });
  if (blocked) throw new HttpError(429, '시도가 너무 많습니다. 15분 뒤에 다시 해 주세요.');
  const { data: rows } = await db.rpc('verify_participant', { p_slug: slug, p_name: name, p_code: code });
  const who = Array.isArray(rows) ? rows[0] : null;
  await db.from('lookup_attempts').insert({ contest_id: contest.id, name, ip_hash: ip, ok: !!who });
  if (!who) throw new HttpError(401, GENERIC_FAIL);
  return { contest, name, participantId: who.participant_id as string };
}

serve(async (req, body) => {
  const db = serviceClient();
  const { contest, name, participantId } = await authParticipant(req, db, body);
  const action = str(body.action, 20) || 'status';

  const { data: part } = await db.from('participants').select('repo_name, invite_status').eq('id', participantId).single();
  const [{ data: mods }, { data: subs }, { data: exts }] = await Promise.all([
    db.from('modules').select('id, code, title, folder, deadline').eq('contest_id', contest.id).order('code'),
    db.from('submissions').select('*').eq('participant_id', participantId),
    db.from('deadline_extensions').select('module_id, extended_until').eq('participant_id', participantId),
  ]);
  const extMap = new Map((exts ?? []).map((e) => [e.module_id, e.extended_until as string]));
  const subMap = new Map((subs ?? []).map((s) => [s.module_id, s]));
  const effective = (m: { id: string; deadline: string | null }) => extMap.get(m.id) ?? m.deadline;

  if (action === 'status') {
    return json({
      contest: { slug: contest.slug, name: contest.name },
      participant: { name },
      repo: part?.repo_name ? { name: part.repo_name, url: `https://github.com/${contest.github_org}/${part.repo_name}`, invite: part.invite_status } : null,
      modules: (mods ?? []).map((m) => {
        const s = subMap.get(m.id);
        return {
          code: m.code, title: m.title, folder: m.folder, deadline: effective(m), extended: extMap.has(m.id),
          status: s?.status ?? 'open', method: s?.method ?? 'repo',
          lastPushAt: s?.last_push_at ?? null, lastPushSha: s?.last_push_sha?.slice(0, 7) ?? null,
          ontimeCommit: s?.ontime_commit?.slice(0, 7) ?? null, lateSeconds: s?.late_seconds ?? null,
          zip: s?.zip_path && !s.zip_purged_at ? { size: s.zip_size, uploadedAt: s.zip_uploaded_at } : null,
        };
      }),
    });
  }

  const code = str(body.module, 4);
  const m = (mods ?? []).find((x) => x.code === code);
  if (!m) throw new HttpError(400, '모듈을 찾을 수 없습니다.');
  const prefix = `${contest.slug}/${participantId}/${m.code}/`;

  if (action === 'sign') {
    const path = `${prefix}${Date.now()}.zip`;
    const { data, error } = await db.storage.from('submissions').createSignedUploadUrl(path);
    if (error || !data) throw new HttpError(500, '올리기 주소를 만들지 못했습니다.');
    return json({ path, token: data.token });
  }

  if (action === 'confirm') {
    const path = str(body.path, 300);
    if (!path.startsWith(prefix) || !/^[0-9]+\.zip$/.test(path.slice(prefix.length))) throw new HttpError(400, '올바르지 않은 경로입니다.');
    const file = path.slice(prefix.length);
    const { data: found } = await db.storage.from('submissions').list(prefix.replace(/\/$/, ''), { search: file, limit: 5 });
    const obj = found?.find((f) => f.name === file);
    if (!obj) throw new HttpError(404, '올린 파일을 찾지 못했습니다. 다시 올려 주세요.');
    const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);

    const now = new Date();
    const dl = effective(m);
    const late = !!dl && new Date(dl) <= now;
    const old = subMap.get(m.id)?.zip_path as string | undefined;
    const patch = {
      participant_id: participantId, module_id: m.id, method: 'zip', zip_path: path, zip_size: size,
      zip_uploaded_at: now.toISOString(), zip_purged_at: null,
      ...(late ? { status: 'late', late_at: now.toISOString(), late_seconds: Math.round((now.getTime() - new Date(dl!).getTime()) / 1000) } : {}),
    };
    const { error } = await db.from('submissions').upsert(patch, { onConflict: 'participant_id,module_id' });
    if (error) throw new HttpError(500, '제출 기록을 저장하지 못했습니다.');
    if (old && old !== path) await db.storage.from('submissions').remove([old]);
    return json({ ok: true, late, size });
  }

  if (action === 'use_repo') {
    const s = subMap.get(m.id);
    if (s && s.status !== 'open') throw new HttpError(409, '마감된 모듈은 바꿀 수 없습니다.');
    await db.from('submissions').upsert({ participant_id: participantId, module_id: m.id, method: 'repo' }, { onConflict: 'participant_id,module_id' });
    return json({ ok: true });
  }

  throw new HttpError(400, '알 수 없는 동작입니다.');
});
