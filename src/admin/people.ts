import { $, fmtKst, html, type Safe } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { guard } from './auth.ts';
import { loadContest, type Contest } from './contests.ts';
import { adminShell, bindShell } from './shell.ts';

interface Person { id: string; student_id: string; code_issued_at: string | null; repo_name: string | null; invite_status: string; students: { name: string; short_name: string; github_id: string | null } }
interface Student { id: string; name: string; short_name: string }

export function codeMessage(c: Pick<Contest, 'name' | 'slug'>, name: string, code: string): string {
  return `${name}님, ${c.name} 결과 확인 안내입니다.\n조회 주소: ${location.origin}/c/${c.slug}\n이름: ${name}\n확인 코드: ${code}\n※ 코드는 다른 사람에게 알려 주지 마세요.`;
}

export async function peoplePage({ root, params }: RouteCtx, issued: { name: string; code: string }[] = []) {
  if (!(await guard())) return;
  const c = await loadContest(params.id!);
  if (!c) return;
  const [{ data: ps }, { data: all }] = await Promise.all([
    supabase.from('participants').select('id, student_id, code_issued_at, repo_name, invite_status, students(name, short_name, github_id)').eq('contest_id', c.id),
    supabase.from('students').select('id, name, short_name').order('name'),
  ]);
  const people = ((ps ?? []) as unknown as Person[]).sort((a, b) => a.students.name.localeCompare(b.students.name, 'ko'));
  const have = new Set(people.map((p) => p.student_id));
  const candidates = ((all ?? []) as Student[]).filter((s) => !have.has(s.id));

  const msgBlock = (m: { name: string; code: string }): Safe => html`<div class="panel" style="padding:12px 14px"><pre style="border:0;background:none;padding:0;white-space:pre-wrap">${codeMessage(c, m.name, m.code)}</pre>
    <button type="button" class="btn sm" data-copy="${codeMessage(c, m.name, m.code)}">이 안내 복사</button></div>`;

  const body = html`<h1>참가자와 확인 코드</h1>
    ${issued.length ? html`<section class="panel"><h2 class="panel-h">방금 만든 확인 코드 안내 <span class="small" style="color:var(--pen);font-weight:400">이 화면을 떠나면 코드를 다시 볼 수 없습니다. 지금 복사해 메시지로 보내 주세요.</span></h2>
      <div class="panel-b stack"><div class="row"><button type="button" class="btn line sm" data-copy-all>전체 복사</button></div>${issued.map(msgBlock)}</div></section>` : ''}
    <section class="panel scroll-x"><table><thead><tr><th class="th">이름</th><th class="th">약칭</th><th class="th">저장소</th><th class="th">초대</th><th class="th">코드 발급</th><th class="th"></th></tr></thead><tbody>
      ${people.length ? people.map((p) => html`<tr data-id="${p.id}" data-name="${p.students.name}"><td class="td" style="font-weight:600">${p.students.name}</td><td class="td">${p.students.short_name}</td>
        <td class="td small">${p.repo_name ?? '-'}</td><td class="td"><span class="tag">${{ none: '아직', pending: '초대함', accepted: '수락', expired: '초대 만료' }[p.invite_status]}</span></td>
        <td class="td small nw">${fmtKst(p.code_issued_at)}</td>
        <td class="td nw"><button type="button" class="btn line sm p-new">새 코드 발급</button> <button type="button" class="btn danger sm p-del">빼기</button></td></tr>`)
        : html`<tr><td class="td muted" colspan="6">참가자가 아직 없습니다. 아래에서 학생 명단의 학생을 불러오세요.</td></tr>`}</tbody></table></section>
    <section class="panel"><h2 class="panel-h">학생 명단에서 불러오기</h2><div class="panel-b stack">
      ${candidates.length ? html`<div class="row" style="gap:8px 18px">${candidates.map((s) => html`<label class="row" style="gap:6px"><input type="checkbox" class="pick" value="${s.id}"> ${s.name} <span class="small muted">${s.short_name}</span></label>`)}</div>
        <div class="row"><button type="button" class="btn line sm" id="all">모두 선택</button><button type="button" class="btn" id="add">선택한 학생을 참가자로 불러오기</button></div>
        <p class="small muted" style="margin:0">저장소 이름은 <code>${c.year}-${c.stage}-약칭</code> 으로 정해지고, 학생마다 확인 코드가 새로 만들어집니다.</p>`
        : html`<p class="muted" style="margin:0">불러올 학생이 없습니다. <a href="/admin/students">학생 명단</a>에 먼저 추가해 주세요.</p>`}</div></section>`;
  root.innerHTML = adminShell('contests', body, { contest: { id: c.id, name: c.name }, sub: 'people' }).value;
  document.title = '관리자 · 참가자';
  void bindShell(root);

  root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', async () => { await navigator.clipboard.writeText(b.dataset.copy!); showToast('복사했습니다.'); }));
  $('[data-copy-all]')?.addEventListener('click', async () => { await navigator.clipboard.writeText(issued.map((m) => codeMessage(c, m.name, m.code)).join('\n\n---\n\n')); showToast('전체를 복사했습니다.'); });
  $('#all')?.addEventListener('click', () => root.querySelectorAll<HTMLInputElement>('.pick').forEach((x) => (x.checked = true)));
  $('#add')?.addEventListener('click', async () => {
    const ids = [...root.querySelectorAll<HTMLInputElement>('.pick:checked')].map((x) => x.value);
    if (!ids.length) { showToast('불러올 학생을 골라 주세요.'); return; }
    const { data, error } = await supabase.rpc('add_participants', { p_contest: c.id, p_students: ids });
    if (error) { showToast('불러오지 못했습니다.'); return; }
    void peoplePage({ root, params, query: new URLSearchParams() }, (data ?? []).map((r: { name: string; code: string }) => ({ name: r.name, code: r.code })));
  });
  root.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
    $('.p-new', tr)!.addEventListener('click', async () => {
      if (!confirm(`${tr.dataset.name}의 확인 코드를 새로 만들까요? 예전 코드는 바로 쓸 수 없게 됩니다.`)) return;
      const { data, error } = await supabase.rpc('issue_code', { p_participant: tr.dataset.id! });
      if (error || !data) { showToast('발급하지 못했습니다.'); return; }
      void peoplePage({ root, params, query: new URLSearchParams() }, [{ name: tr.dataset.name!, code: data as string }]);
    });
    $('.p-del', tr)!.addEventListener('click', async () => {
      if (!confirm(`${tr.dataset.name}을(를) 이 대회에서 뺄까요? 결과와 제출 기록도 함께 지워집니다.`)) return;
      const { error } = await supabase.from('participants').delete().eq('id', tr.dataset.id!);
      if (error) showToast('빼지 못했습니다.'); else void peoplePage({ root, params, query: new URLSearchParams() });
    });
  });
}
