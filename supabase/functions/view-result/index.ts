// 참가자가 이름과 확인 코드로 본인 결과를 조회한다. 표를 직접 읽는 길은 없다.
import { HttpError, json, serve, str } from '../_shared/http.ts';
import { ipHash, serviceClient } from '../_shared/supabase.ts';
import { buildModuleView } from '../_shared/lib/view.ts';
import type { GradingResult, Rubric } from '../_shared/lib/types.ts';

const GENERIC_FAIL = '이름 또는 확인 코드가 맞지 않습니다.';

serve(async (req, body) => {
  const slug = str(body.slug, 80);
  const name = str(body.name, 40);
  const code = str(body.code, 40);
  if (!slug || !name || !code) throw new HttpError(400, '이름과 확인 코드를 입력해 주세요.');

  const db = serviceClient();
  const { data: contest } = await db.from('contests').select('id, slug, name, stage, year, leaderboard_mode, github_org')
    .eq('slug', slug).eq('is_public', true).maybeSingle();
  // 대회가 없을 때도 같은 문구
  if (!contest) throw new HttpError(401, GENERIC_FAIL);

  const ip = await ipHash(req);
  const { data: blocked } = await db.rpc('lookup_blocked', { p_contest: contest.id, p_name: name, p_ip: ip });
  if (blocked) throw new HttpError(429, '시도가 너무 많습니다. 15분 뒤에 다시 해 주세요.');

  const { data: rows } = await db.rpc('verify_participant', { p_slug: slug, p_name: name, p_code: code });
  const who = Array.isArray(rows) ? rows[0] : null;
  await db.from('lookup_attempts').insert({ contest_id: contest.id, name, ip_hash: ip, ok: !!who });
  if (!who) throw new HttpError(401, GENERIC_FAIL);

  const { data: results } = await db.from('results')
    .select('id, module_id, body, rubric_id, graded_commit, graded_zip_path, graded_late, updated_at, modules(code, title), rubrics(definition)')
    .eq('participant_id', who.participant_id).eq('is_public', true);

  const modules = [];
  for (const r of results ?? []) {
    const rubric = (r.rubrics as unknown as { definition: Rubric }).definition;
    const view = buildModuleView(rubric, r.body as GradingResult);
    const { data: imgs } = await db.from('result_images').select('file_name, storage_path').eq('result_id', r.id);
    const images: Record<string, string> = {};
    if (imgs?.length) {
      const { data: signed } = await db.storage.from('grading').createSignedUrls(imgs.map((i) => i.storage_path), 600);
      imgs.forEach((i, idx) => {
        const url = signed?.[idx]?.signedUrl;
        if (url) images[i.file_name] = url;
      });
    }
    const mod = r.modules as unknown as { code: string; title: string | null };
    modules.push({
      code: mod.code, title: mod.title, ...view, images,
      graded: { commit: r.graded_commit, zip: !!r.graded_zip_path, late: r.graded_late },
      updatedAt: r.updated_at,
    });
  }
  modules.sort((a, b) => a.code.localeCompare(b.code));

  const { data: anon } = await db.rpc('participant_anon_no', { p_participant: who.participant_id });
  return json({
    contest: { slug: contest.slug, name: contest.name, leaderboard_mode: contest.leaderboard_mode },
    participant: { name, anonNo: anon },
    modules,
  });
});
