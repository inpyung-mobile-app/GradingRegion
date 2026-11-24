// 관리자가 올린 결과 JSON을 서버가 한 번 더 검사하고 DB에 넣는다. 브라우저의 검사를 건너뛴 요청도 여기서 막힌다.
import { HttpError, json, serve, str } from '../_shared/http.ts';
import { requireAdmin, serviceClient } from '../_shared/supabase.ts';
import { computeScores, formatIssue, validateResult, validateRubric } from '../_shared/lib/validate.ts';
import type { GradingResult, Rubric } from '../_shared/lib/types.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 버킷 안의 prefix 아래 모든 파일(하위 폴더 포함)의 상대 경로 */
async function listAll(db: SupabaseClient, bucket: string, prefix: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await db.storage.from(bucket).list(rel ? `${prefix}${rel}` : prefix.replace(/\/$/, ''), { limit: 1000 });
  if (error) throw new HttpError(500, '캡처 파일 목록을 읽지 못했습니다.');
  for (const e of data ?? []) {
    if (e.id === null) out.push(...(await listAll(db, bucket, prefix, `${rel}${e.name}/`)));
    else out.push(`${rel}${e.name}`);
  }
  return out;
}

serve(async (req, body) => {
  const db = serviceClient();
  const admin = await requireAdmin(req, db);

  const moduleId = str(body.module_id, 40);
  const resultId = str(body.result_id, 40);
  if (!UUID.test(moduleId) || !UUID.test(resultId)) throw new HttpError(400, '모듈과 결과 id가 필요합니다.');
  const replace = body.replace === true;

  const { data: mod } = await db.from('modules')
    .select('id, code, contest_id, rubric_id, contests(slug), rubrics(id, definition)').eq('id', moduleId).maybeSingle();
  if (!mod) throw new HttpError(404, '모듈을 찾을 수 없습니다.');
  const rubricRow = mod.rubrics as unknown as { id: string; definition: Rubric } | null;
  if (!rubricRow) throw new HttpError(422, '이 모듈에 채점 기준표가 연결되어 있지 않습니다.');
  const rubric = rubricRow.definition;
  if (validateRubric(rubric).length) throw new HttpError(500, '저장된 채점 기준표가 올바르지 않습니다.');
  const slug = (mod.contests as unknown as { slug: string }).slug;

  // 참가자 이름 → 참가자
  const { data: parts } = await db.from('participants').select('id, students(name)').eq('contest_id', mod.contest_id);
  const byName = new Map((parts ?? []).map((p) => [(p.students as unknown as { name: string }).name, p.id as string]));

  const prefix = `${slug}/${mod.code}/${resultId}/`;
  const files = new Set(await listAll(db, 'grading', prefix));
  const issues = validateResult(body.result, { rubric, uploadedFiles: files, participantNames: [...byName.keys()] });
  if (issues.length) throw new HttpError(422, `결과 파일에 ${issues.length}개 문제가 있습니다.`, { issues, messages: issues.map(formatIssue) });

  const result = body.result as GradingResult;
  const participantId = byName.get(result.participant.trim())!;

  const { data: existing } = await db.from('results').select('id').eq('participant_id', participantId).eq('module_id', moduleId).maybeSingle();
  if (existing && !replace) throw new HttpError(409, '이 참가자의 이 모듈 결과가 이미 있습니다. 교체할지 확인해 주세요.', { exists: true });

  const { data: sub } = await db.from('submissions')
    .select('method, status, grade_commit, zip_path').eq('participant_id', participantId).eq('module_id', moduleId).maybeSingle();

  const scores = computeScores(rubric, result);
  const captions = new Map((result.screenshots ?? []).map((s) => [s.file, s.caption ?? null]));
  const referenced = new Set<string>();
  for (const it of result.items) for (const f of it.comment?.evidence ?? []) referenced.add(f);
  for (const n of result.notes ?? []) for (const f of n.images ?? []) referenced.add(f);
  for (const s of result.screenshots ?? []) referenced.add(s.file);
  const images = [...referenced].map((file) => ({ file, path: `${prefix}${file}`, caption: captions.get(file) ?? null }));

  const { error } = await db.rpc('save_result', {
    p_actor: admin.id, p_new_id: resultId, p_participant: participantId, p_module: moduleId, p_rubric: rubricRow.id,
    p_target: result.target ?? null,
    p_graded_commit: sub?.method === 'repo' ? sub.grade_commit : null,
    p_graded_zip: sub?.method === 'zip' ? sub.zip_path : null,
    p_graded_late: sub?.status === 'late',
    p_body: result, p_subjective: scores.subjective, p_objective: scores.objective, p_images: images,
  });
  if (error) throw new HttpError(500, '결과를 저장하지 못했습니다.');

  // 교체한 경우 예전 결과의 캡처를 지우고, 이번에 쓰지 않은 파일도 정리한다.
  if (existing && existing.id !== resultId) {
    const oldPrefix = `${slug}/${mod.code}/${existing.id}/`;
    const old = await listAll(db, 'grading', oldPrefix);
    if (old.length) await db.storage.from('grading').remove(old.map((f) => `${oldPrefix}${f}`));
  }
  const unused = [...files].filter((f) => !referenced.has(f));
  if (unused.length) await db.storage.from('grading').remove(unused.map((f) => `${prefix}${f}`));

  return json({ id: resultId, replaced: !!existing, scores });
});
