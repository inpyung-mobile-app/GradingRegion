import { $, fmtKst, html } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { callAdmin, supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { admin, guard } from './auth.ts';
import { adminShell, bindShell } from './shell.ts';

interface Row { user_id: string; email: string; role: 'owner' | 'editor'; created_at: string }

export async function teamPage({ root }: RouteCtx) {
  const me = await guard();
  if (!me) return;
  if (me.role !== 'owner') { root.innerHTML = adminShell('team', html`<h1>관리자 목록</h1><p class="notice">관리자를 초대하고 바꾸는 일은 owner만 할 수 있습니다.</p>`).value; return; }
  const { data } = await supabase.from('admins').select('user_id, email, role, created_at').order('created_at');
  const list = (data ?? []) as Row[];
  const body = html`<h1>관리자 목록과 초대</h1>
    <section class="panel scroll-x"><table><thead><tr><th class="th">이메일</th><th class="th">역할</th><th class="th">등록</th><th class="th"></th></tr></thead><tbody>
      ${list.map((a) => html`<tr data-id="${a.user_id}" data-email="${a.email}"><td class="td" style="font-weight:600">${a.email} ${a.user_id === admin().userId ? html`<span class="tag">나</span>` : ''}</td>
        <td class="td"><select class="role" style="min-height:34px"><option value="owner" ${a.role === 'owner' ? 'selected' : ''}>owner</option><option value="editor" ${a.role === 'editor' ? 'selected' : ''}>editor</option></select></td>
        <td class="td small nw">${fmtKst(a.created_at)}</td>
        <td class="td nw">${a.user_id === admin().userId ? '' : html`<button type="button" class="btn line sm revoke">로그인 세션 끊기</button> <button type="button" class="btn danger sm rm">관리자에서 빼기</button>`}</td></tr>`)}</tbody></table></section>
    <section class="panel"><h2 class="panel-h">관리자 초대</h2><form id="inv" class="panel-b stack" novalidate>
      <div class="grid2"><div class="field"><label for="email">이메일</label><input id="email" type="email" required></div>
        <div class="field"><label for="role">역할</label><select id="role"><option value="editor">editor — 대회, 참가자, 결과를 관리</option><option value="owner">owner — 관리자 초대와 삭제까지</option></select></div></div>
      <p class="small muted" style="margin:0">초대하면 계정이 만들어집니다. 초대받은 사람은 <a href="/admin/login">관리자 로그인</a>에서 그 이메일로 로그인 링크를 받으면 됩니다.</p>
      <p id="err" class="err" role="alert" hidden></p><button class="btn" type="submit" style="align-self:flex-start">초대</button></form></section>`;
  root.innerHTML = adminShell('team', body).value;
  document.title = '관리자 · 관리자 목록';
  void bindShell(root);
  const again = () => void teamPage({ root, params: {}, query: new URLSearchParams() });
  $<HTMLFormElement>('#inv')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err')!;
    try {
      await callAdmin('invite-admin', { action: 'invite', email: $<HTMLInputElement>('#email')!.value, role: $<HTMLSelectElement>('#role')!.value });
      showToast('초대했습니다.'); again();
    } catch (ex) { err.textContent = (ex as Error).message; err.hidden = false; }
  });
  root.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id!;
    $<HTMLSelectElement>('.role', tr)!.addEventListener('change', async (e) => {
      const { error } = await supabase.from('admins').update({ role: (e.target as HTMLSelectElement).value }).eq('user_id', id);
      if (error) { showToast(error.message.includes('마지막 owner') ? '마지막 owner는 editor로 바꿀 수 없습니다.' : '바꾸지 못했습니다.'); again(); } else showToast('역할을 바꿨습니다.');
    });
    $('.revoke', tr)?.addEventListener('click', async () => {
      if (!confirm(`${tr.dataset.email}의 로그인을 모두 끊을까요?`)) return;
      try { await callAdmin('invite-admin', { action: 'revoke_sessions', user_id: id }); showToast('세션을 끊었습니다.'); } catch (ex) { showToast((ex as Error).message); }
    });
    $('.rm', tr)?.addEventListener('click', async () => {
      if (!confirm(`${tr.dataset.email}을(를) 관리자에서 뺄까요?`)) return;
      try { await callAdmin('invite-admin', { action: 'revoke_sessions', user_id: id }); } catch { /* 세션 끊기 실패해도 빼기는 진행 */ }
      const { error } = await supabase.from('admins').delete().eq('user_id', id);
      if (error) showToast(error.message.includes('마지막 owner') ? '마지막 owner는 뺄 수 없습니다.' : '빼지 못했습니다.'); else again();
    });
  });
}
