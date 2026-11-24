// 마감이 지난 모듈의 마지막 커밋을 기록하고, 마감 뒤 push는 지각으로 표시한다. 제출 zip 정리도 한다.
// 부르는 쪽: pg_cron(x-cron-secret 헤더) 또는 로그인한 관리자(제출 현황의 새로 고침).
import { HttpError, json, serve, str } from '../_shared/http.ts';
import { requireAdmin, serviceClient } from '../_shared/supabase.ts';
import { github, type GitHub } from '../_shared/github.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

interface Sub {
  id: string; participant_id: string; module_id: string; method: 'repo' | 'zip'; status: 'open' | 'closed' | 'late';
  last_push_sha: string | null; ontime_commit: string | null; zip_path: string | null; zip_uploaded_at: string | null;
}
interface Ctx {
  org: string; repo: string; folder: string; deadline: string | null; sub: Sub;
}

/** 한 행의 새 상태를 계산한다. 바꿀 게 없으면 null. */
async function compute(gh: GitHub, x: Ctx, now: Date): Promise<Record<string, unknown> | null> {
  const { sub, deadline } = x;
  const out: Record<string, unknown> = { last_checked_at: now.toISOString() };
  const passed = !!deadline && new Date(deadline) <= now;
  // 마감이 뒤로 미뤄져 아직 안 지났으면 다시 연다.
  if (!passed && sub.status !== 'open') {
    Object.assign(out, { status: 'open', closed_at: null, ontime_commit: null, ontime_zip_path: null, grade_commit: null, late_commit: null, late_at: null, late_seconds: null });
  }

  if (sub.method === 'zip') {
    if (!passed) return out;
    const onTime = sub.zip_path && sub.zip_uploaded_at && new Date(sub.zip_uploaded_at) <= new Date(deadline!);
    if (sub.status === 'open') Object.assign(out, { status: 'closed', closed_at: deadline, ontime_zip_path: onTime ? sub.zip_path : null });
    return out;
  }

  const latest = await gh.lastCommit(x.org, x.repo, x.folder);
  if (latest) Object.assign(out, { last_push_sha: latest.sha, last_push_at: latest.at });
  if (!passed) return out;

  const ontime = await gh.lastCommit(x.org, x.repo, x.folder, deadline!);
  const isLate = !!latest && new Date(latest.at) > new Date(deadline!);
  Object.assign(out, {
    status: isLate ? 'late' : 'closed',
    closed_at: deadline,
    ontime_commit: ontime?.sha ?? null,
    grade_commit: ontime?.sha ?? (isLate ? latest!.sha : null),
    late_commit: isLate ? latest!.sha : null,
    late_at: isLate ? latest!.at : null,
    late_seconds: isLate ? Math.round((new Date(latest!.at).getTime() - new Date(deadline!).getTime()) / 1000) : null,
  });
  return out;
}

async function purge(db: SupabaseClient): Promise<number> {
  // 결과가 공개된 지 보존 기간이 지난 제출 zip을 지운다. (공개 시각은 결과가 마지막으로 바뀐 때로 본다.)
  const { data: subs } = await db.from('submissions')
    .select('id, participant_id, module_id, zip_path, participants!inner(contests!inner(zip_retention_days))')
    .not('zip_path', 'is', null).is('zip_purged_at', null);
  const list = (subs ?? []) as any[];
  if (!list.length) return 0;
  const { data: res } = await db.from('results').select('participant_id, module_id, updated_at')
    .eq('is_public', true).in('participant_id', [...new Set(list.map((s) => s.participant_id))]);
  const pub = new Map((res ?? []).map((r) => [`${r.participant_id}:${r.module_id}`, new Date(r.updated_at).getTime()]));
  let n = 0;
  for (const s of list) {
    const at = pub.get(`${s.participant_id}:${s.module_id}`);
    const days = s.participants.contests.zip_retention_days as number;
    if (at === undefined || Date.now() - at < days * 86400_000) continue;
    await db.storage.from('submissions').remove([s.zip_path]);
    await db.from('submissions').update({ zip_purged_at: new Date().toISOString() }).eq('id', s.id);
    n++;
  }
  return n;
}

serve(async (req, body) => {
  const db = serviceClient();
  const cron = req.headers.get('x-cron-secret');
  const isCron = !!cron && cron === Deno.env.get('CRON_SECRET');
  if (!isCron) await requireAdmin(req, db);

  const contestId = str(body.contest_id, 40) || null;
  const full = body.purge === true || body.refresh === true; // 전체 점검(마감 전 행의 최근 push도 새로 읽는다)

  let q = db.from('participants').select('id, repo_name, contest_id, contests!inner(github_org, is_public)');
  if (contestId) q = q.eq('contest_id', contestId);
  const parts = ((await q).data ?? []) as unknown as { id: string; repo_name: string | null; contest_id: string; contests: { github_org: string } }[];
  if (!parts.length) return json({ updated: 0, purged: 0 });

  const contestIds = [...new Set(parts.map((p) => p.contest_id))];
  const [{ data: mods }, { data: subs }, { data: exts }] = await Promise.all([
    db.from('modules').select('id, contest_id, folder, deadline').in('contest_id', contestIds),
    db.from('submissions').select('*').in('participant_id', parts.map((p) => p.id)),
    db.from('deadline_extensions').select('participant_id, module_id, extended_until').in('participant_id', parts.map((p) => p.id)),
  ]);
  const extMap = new Map((exts ?? []).map((e) => [`${e.participant_id}:${e.module_id}`, e.extended_until as string]));
  const subMap = new Map(((subs ?? []) as Sub[]).map((s) => [`${s.participant_id}:${s.module_id}`, s]));

  const now = new Date();
  const jobs: { p: (typeof parts)[number]; m: NonNullable<typeof mods>[number]; deadline: string | null; sub: Sub | undefined }[] = [];
  for (const p of parts) {
    for (const m of (mods ?? []).filter((x) => x.contest_id === p.contest_id)) {
      const sub = subMap.get(`${p.id}:${m.id}`);
      const dl = extMap.get(`${p.id}:${m.id}`) ?? (m.deadline as string | null);
      const passed = !!dl && new Date(dl) <= now;
      // 평소에는 마감이 지났는데 아직 열려 있는 행만. 전체 점검이면 지각이 아닌 모든 행.
      if (!full && !(passed && (sub?.status ?? 'open') === 'open')) continue;
      jobs.push({ p, m, deadline: dl, sub });
    }
  }
  if (!jobs.length && !body.purge) return json({ updated: 0, purged: 0 });

  const gh = jobs.some((j) => !j.sub || j.sub.method === 'repo') ? await github() : null;
  let updated = 0;
  const errors: string[] = [];
  for (let i = 0; i < jobs.length; i += 5) {
    await Promise.all(jobs.slice(i, i + 5).map(async ({ p, m, deadline, sub }) => {
      try {
        let s = sub;
        if (!s) {
          const ins = await db.from('submissions').upsert({ participant_id: p.id, module_id: m.id }, { onConflict: 'participant_id,module_id' }).select('*').single();
          s = ins.data as Sub;
        }
        if (!p.repo_name && s.method === 'repo') return;
        const patch = await compute(gh!, { org: p.contests.github_org, repo: p.repo_name ?? '', folder: m.folder, deadline, sub: s }, now);
        if (patch) { await db.from('submissions').update(patch).eq('id', s.id); updated++; }
      } catch (e) { errors.push(`${p.id}/${m.folder}: ${(e as Error).message}`); }
    }));
  }
  const purged = body.purge === true ? await purge(db) : 0;
  if (errors.length) console.error(errors);
  return json({ updated, purged, errors: errors.length });
});
