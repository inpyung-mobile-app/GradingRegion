import { $, html, raw } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { guard } from './auth.ts';
import { adminShell, bindShell } from './shell.ts';

interface Student { id: string; name: string; github_id: string | null; short_name: string; memo: string | null }

export async function studentsPage({ root }: RouteCtx) {
  if (!(await guard())) return;
  const { data } = await supabase.from('students').select('*').order('name');
  const list = (data ?? []) as Student[];
  const inp = 'style="width:100%;min-height:34px;padding:0 8px;border:1px solid var(--line3)"';
  const body = html`<h1>학생 명단</h1>
    <p class="small muted" style="margin:0">대회와 상관없이 한 번 적어 두면, 대회마다 참가자로 불러와 쓸 수 있습니다. 약칭은 저장소 이름(예: 2026-reg-<b>lyj</b>)에 쓰이고 학생마다 달라야 합니다.</p>
    <section class="panel scroll-x"><table><thead><tr><th class="th">이름</th><th class="th">GitHub 아이디</th><th class="th">약칭</th><th class="th">메모</th><th class="th"></th></tr></thead><tbody>
      ${list.length ? list.map((s) => html`<tr data-id="${s.id}">
        <td class="td"><input class="f-name" value="${s.name}" ${raw(inp)}></td><td class="td"><input class="f-gh" value="${s.github_id ?? ''}" ${raw(inp)}></td>
        <td class="td"><input class="f-short" value="${s.short_name}" ${raw(inp)}></td><td class="td"><input class="f-memo" value="${s.memo ?? ''}" ${raw(inp)}></td>
        <td class="td nw"><button type="button" class="btn sm s-save">저장</button> <button type="button" class="btn danger sm s-del">삭제</button></td></tr>`)
        : html`<tr><td class="td muted" colspan="5">학생이 아직 없습니다.</td></tr>`}</tbody></table></section>
    <section class="panel"><h2 class="panel-h">학생 추가</h2><div class="panel-b stack">
      <form id="add" class="grid2" novalidate>
        <div class="field"><label for="n">이름</label><input id="n" required maxlength="40"></div>
        <div class="field"><label for="g">GitHub 아이디</label><input id="g" maxlength="40" placeholder="예: kerupu526"></div>
        <div class="field"><label for="s">약칭(영문 소문자, 숫자, -)</label><input id="s" required maxlength="20" placeholder="예: lyj"></div>
        <div class="field"><label for="m">메모</label><input id="m" maxlength="100"></div>
        <button class="btn" type="submit" style="align-self:end">추가</button></form>
      <details><summary style="cursor:pointer;font-weight:600">여러 명 한꺼번에 추가</summary><div class="stack" style="margin-top:12px">
        <div class="field"><label for="bulk">한 줄에 한 명: 이름, GitHub 아이디, 약칭</label><textarea id="bulk" rows="6" placeholder="이영재, lyj-gh, lyj&#10;김도윤, dy-kim, kdy"></textarea></div>
        <button type="button" class="btn line" id="bulk-add" style="align-self:flex-start">한꺼번에 추가</button></div></details>
      <p id="err" class="err" role="alert" hidden></p></div></section>`;
  root.innerHTML = adminShell('students', body).value;
  document.title = '관리자 · 학생 명단';
  void bindShell(root);
  const reload = () => void studentsPage({ root, params: {}, query: new URLSearchParams() });
  const errEl = $('#err')!;
  const fail = (e: { code?: string } | null) => {
    errEl.hidden = !e;
    if (e) errEl.textContent = e.code === '23505' ? '이름이나 약칭이 이미 있는 학생과 겹칩니다.' : e.code === '23514' ? '약칭은 영문 소문자, 숫자, -만 쓸 수 있습니다.' : '저장하지 못했습니다.';
    return !!e;
  };
  $<HTMLFormElement>('#add')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id: string) => $<HTMLInputElement>('#' + id)!.value.trim();
    const { error } = await supabase.from('students').insert({ name: v('n'), github_id: v('g') || null, short_name: v('s'), memo: v('m') || null });
    if (!fail(error)) { showToast('추가했습니다.'); reload(); }
  });
  $('#bulk-add')!.addEventListener('click', async () => {
    const rows = $<HTMLTextAreaElement>('#bulk')!.value.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((p) => p[0]);
    const bad = rows.find((p) => !p[0] || !p[2]);
    if (bad) { errEl.textContent = `"${bad.join(', ')}" 줄에 이름과 약칭이 모두 필요합니다.`; errEl.hidden = false; return; }
    const { error } = await supabase.from('students').insert(rows.map((p) => ({ name: p[0]!, github_id: p[1] || null, short_name: p[2]! })));
    if (!fail(error)) { showToast(`${rows.length}명을 추가했습니다.`); reload(); }
  });
  root.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id!;
    const val = (c: string) => $<HTMLInputElement>('.' + c, tr)!.value.trim();
    $('.s-save', tr)!.addEventListener('click', async () => {
      const { error } = await supabase.from('students').update({ name: val('f-name'), github_id: val('f-gh') || null, short_name: val('f-short'), memo: val('f-memo') || null }).eq('id', id);
      if (!fail(error)) showToast('저장했습니다.');
    });
    $('.s-del', tr)!.addEventListener('click', async () => {
      if (!confirm(`${val('f-name')} 학생을 명단에서 지울까요?`)) return;
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (error) { errEl.textContent = error.code === '23503' ? '이미 어느 대회의 참가자라서 지울 수 없습니다.' : '지우지 못했습니다.'; errEl.hidden = false; }
      else reload();
    });
  });
}
