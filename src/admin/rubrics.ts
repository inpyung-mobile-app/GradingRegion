import { $, html, raw, type Safe } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { buildInstructionPrompt } from '../../shared/prompt.ts';
import type { Rubric } from '../../shared/types.ts';
import { formatIssue, isAllOrNothing, validateRubric } from '../../shared/validate.ts';
import { guard } from './auth.ts';
import { loadContest, type Module } from './contests.ts';
import { adminShell, bindShell } from './shell.ts';

interface RubricRow { id: string; rubric_key: string; version: number; title: string; definition: Rubric; created_at: string }

function itemsTable(r: Rubric): Safe {
  return html`<div class="scroll-x"><table><thead><tr><th class="th">번호</th><th class="th">구분</th><th class="th">항목</th><th class="th r">배점</th><th class="th">규칙</th></tr></thead><tbody>
    ${r.items.map((it) => html`<tr><td class="td id">${it.id}</td><td class="td nw">${it.type === 'subjective' ? '주관' : '객관'}</td>
      <td class="td">${it.title}${it.guide ? html`<div class="small muted">${it.guide}</div>` : ''}${it.checks?.length ? html`<ul class="small muted" style="margin:4px 0 0;padding-left:18px">${it.checks.map((c) => html`<li>${c.id} ${c.text}</li>`)}</ul>` : ''}</td>
      <td class="td r nw">${it.points}</td><td class="td small nw">${it.type === 'subjective' ? (it.step ? `${it.step} 단위` : '자유') : isAllOrNothing(it) ? '전부/전무' : '부분 점수'}</td></tr>`)}
  </tbody></table></div>`;
}

export async function rubricsPage({ root, params }: RouteCtx) {
  if (!(await guard())) return;
  const c = await loadContest(params.id!);
  if (!c) return;
  const [{ data: mods }, { data: rubs }] = await Promise.all([
    supabase.from('modules').select('*').eq('contest_id', c.id).order('code'),
    supabase.from('rubrics').select('id, rubric_key, version, title, definition, created_at').order('created_at', { ascending: false }),
  ]);
  const modules = (mods ?? []) as Module[];
  const rubrics = (rubs ?? []) as RubricRow[];
  const byId = new Map(rubrics.map((r) => [r.id, r]));

  const section = (m: Module): Safe => {
    const r = m.rubric_id ? byId.get(m.rubric_id) : undefined;
    return html`<section class="panel" data-mod="${m.id}"><h2 class="panel-h"><span>Module ${m.code}${m.title ? ` · ${m.title}` : ''}</span>
      ${r ? html`<span class="small" style="font-weight:400">${r.title} · 버전 ${r.version} · 주관 ${r.definition.max.subjective} + 객관 ${r.definition.max.objective}</span>` : html`<span class="tag amber">기준표 없음</span>`}</h2>
      <div class="panel-b stack">
        ${r ? html`${itemsTable(r.definition)}
          <div class="row"><button type="button" class="btn sm" data-prompt>AI 지시문 복사</button><button type="button" class="btn line sm" data-download>기준표 파일로 내려받기</button></div>` : html`<p class="muted" style="margin:0">아래에서 채점 기준표 파일을 올리면 이 모듈에 연결됩니다.</p>`}
        <details><summary style="cursor:pointer;font-weight:600">${r ? '기준표 바꾸기(새 버전 만들기)' : '채점 기준표 올리기'}</summary>
          <div class="stack" style="margin-top:12px">
            <div class="field"><label>기준표 파일(.json)</label><input type="file" accept=".json,application/json" data-file></div>
            <div class="field"><label>또는 내용을 붙여 넣기</label><textarea data-text rows="8" spellcheck="false" placeholder='{ "id": "2026-national-A", "version": 1, ... }'></textarea></div>
            <div data-issues></div>
            <p class="small muted" style="margin:0">같은 기준표 id가 이미 있으면 버전 번호가 자동으로 올라갑니다. 이미 채점한 결과는 예전 버전을 계속 가리킵니다.</p>
            <button type="button" class="btn" style="align-self:flex-start" data-save>검사하고 저장</button>
          </div></details>
      </div></section>`;
  };

  const body = html`<h1>모듈과 채점 기준표</h1>
    ${modules.length ? modules.map(section) : html`<p class="notice">먼저 <a href="/admin/c/${c.id}">대회 설정</a>에서 모듈을 추가해 주세요.</p>`}
    <dialog id="dlg" style="width:min(820px,94vw);border:1px solid var(--line);padding:0"><div class="panel-h"><span>AI 지시문</span><button type="button" class="btn line sm" data-copy>복사</button><button type="button" class="btn line sm" data-close>닫기</button></div>
      <textarea id="dlg-text" readonly style="width:100%;height:60vh;border:0;padding:14px;font-family:ui-monospace,Consolas,monospace;font-size:13px;line-height:1.55"></textarea></dialog>`;
  root.innerHTML = adminShell('contests', body, { contest: { id: c.id, name: c.name }, sub: 'rubrics' }).value;
  document.title = '관리자 · 채점 기준표';
  void bindShell(root);

  const dlg = $<HTMLDialogElement>('#dlg')!;
  $('[data-close]', dlg)!.addEventListener('click', () => dlg.close());
  $('[data-copy]', dlg)!.addEventListener('click', async () => {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>('#dlg-text')!.value);
    showToast('AI 지시문을 복사했습니다.');
  });

  for (const m of modules) {
    const sec = root.querySelector<HTMLElement>(`[data-mod="${m.id}"]`)!;
    const r = m.rubric_id ? byId.get(m.rubric_id) : undefined;

    $('[data-prompt]', sec)?.addEventListener('click', async () => {
      const { data: ps } = await supabase.from('participants').select('repo_name, students(name)').eq('contest_id', c.id);
      const participants = (ps ?? []).map((p) => ({ name: (p.students as unknown as { name: string }).name, repo: p.repo_name ?? undefined }));
      $<HTMLTextAreaElement>('#dlg-text')!.value = buildInstructionPrompt({
        contestName: c.name, moduleCode: m.code, ...(m.title ? { moduleTitle: m.title } : {}), moduleFolder: m.folder, rubric: r!.definition, participants,
      });
      dlg.showModal();
    });
    $('[data-download]', sec)?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(r!.definition, null, 2)], { type: 'application/json' }));
      a.download = `${r!.rubric_key}@${r!.version}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    const issuesEl = $('[data-issues]', sec)!;
    $<HTMLInputElement>('[data-file]', sec)!.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) $<HTMLTextAreaElement>('[data-text]', sec)!.value = await f.text();
    });
    $('[data-save]', sec)!.addEventListener('click', async () => {
      let parsed: unknown;
      try { parsed = JSON.parse($<HTMLTextAreaElement>('[data-text]', sec)!.value); }
      catch { issuesEl.innerHTML = '<p class="err" role="alert">JSON 형식이 올바르지 않습니다. 쉼표나 따옴표를 확인해 주세요.</p>'; return; }
      const issues = validateRubric(parsed);
      if (issues.length) { issuesEl.innerHTML = html`<ul class="issue-list panel" role="alert">${issues.map((i) => html`<li><b>${formatIssue(i)}</b></li>`)}</ul>`.value; return; }
      const def = parsed as Rubric;
      const { data: same } = await supabase.from('rubrics').select('version').eq('rubric_key', def.id).order('version', { ascending: false }).limit(1);
      const next = same?.length ? same[0]!.version + 1 : def.version;
      const stored: Rubric = { ...def, version: next };
      const { data: row, error } = await supabase.from('rubrics').insert({
        rubric_key: stored.id, version: next, title: stored.title, subjective_max: stored.max.subjective, objective_max: stored.max.objective, definition: stored,
      }).select('id').single();
      if (error) { issuesEl.innerHTML = '<p class="err" role="alert">저장하지 못했습니다.</p>'; return; }
      const { error: e2 } = await supabase.from('modules').update({ rubric_id: row.id }).eq('id', m.id);
      if (e2) { issuesEl.innerHTML = '<p class="err" role="alert">모듈에 연결하지 못했습니다.</p>'; return; }
      showToast(`${stored.title} 버전 ${next}을 저장하고 Module ${m.code}에 연결했습니다.`);
      void rubricsPage({ root, params, query: new URLSearchParams() });
    });
  }
  void raw;
}
