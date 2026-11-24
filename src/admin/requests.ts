import { $, fmtKst, html } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { guard } from './auth.ts';
import { codeMessage } from './people.ts';
import { adminShell, bindShell } from './shell.ts';

interface Req { id: string; name: string; requested_at: string; handled: boolean; handled_at: string | null; contests: { name: string; slug: string } }

export async function requestsPage({ root }: RouteCtx, issued: { name: string; code: string; contest: { name: string; slug: string } }[] = []) {
  if (!(await guard())) return;
  const { data } = await supabase.from('code_requests').select('id, name, requested_at, handled, handled_at, contests(name, slug)').order('requested_at', { ascending: false }).limit(100);
  const list = (data ?? []) as unknown as Req[];
  const open = list.filter((r) => !r.handled);
  const body = html`<h1>코드 분실 요청</h1>
    ${issued.map((m) => html`<section class="panel"><h2 class="panel-h">새 코드를 만들었습니다 <span class="small" style="color:var(--pen);font-weight:400">이 화면을 떠나면 다시 볼 수 없습니다</span></h2><div class="panel-b stack">
      <pre style="white-space:pre-wrap">${codeMessage(m.contest, m.name, m.code)}</pre><button class="btn sm" style="align-self:flex-start" data-copy="${codeMessage(m.contest, m.name, m.code)}">안내 복사</button></div></section>`)}
    <p class="small muted" style="margin:0">참가자가 "코드를 잃어버렸어요"로 보낸 요청입니다. 본인이 맞는지 확인한 뒤 새 코드를 발급해 메시지로 보내 주세요. 예전 코드는 바로 못 쓰게 됩니다.</p>
    <section class="panel scroll-x"><table><thead><tr><th class="th">대회</th><th class="th">이름</th><th class="th">요청 시각</th><th class="th">상태</th><th class="th"></th></tr></thead><tbody>
      ${list.length ? list.map((r) => html`<tr data-id="${r.id}"><td class="td small">${r.contests.name}</td><td class="td" style="font-weight:600">${r.name}</td><td class="td small nw">${fmtKst(r.requested_at)}</td>
        <td class="td">${r.handled ? html`<span class="tag green">처리됨 ${fmtKst(r.handled_at)}</span>` : html`<span class="tag red">대기</span>`}</td>
        <td class="td r">${r.handled ? '' : html`<button type="button" class="btn sm r-go" data-slug="${r.contests.slug}" data-cname="${r.contests.name}">새 코드 발급</button>`}</td></tr>`)
        : html`<tr><td class="td muted" colspan="5">요청이 없습니다.</td></tr>`}</tbody></table></section>
    <p class="small muted" style="margin:0">대기 ${open.length}건</p>`;
  root.innerHTML = adminShell('requests', body).value;
  document.title = '관리자 · 코드 분실 요청';
  void bindShell(root);
  root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', async () => { await navigator.clipboard.writeText(b.dataset.copy!); showToast('복사했습니다.'); }));
  root.querySelectorAll<HTMLButtonElement>('.r-go').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr')!;
    if (!confirm(`${$('td:nth-child(2)', tr)!.textContent}님이 본인인지 확인하셨나요? 새 코드를 발급하면 예전 코드는 쓸 수 없습니다.`)) return;
    const { data: out, error } = await supabase.rpc('handle_code_request', { p_request: tr.dataset.id! });
    const row = (out as { name: string; code: string }[] | null)?.[0];
    if (error || !row) { showToast(error?.message.includes('참가자가 없') ? '이 대회에 그 이름의 참가자가 없습니다.' : '발급하지 못했습니다.'); return; }
    void requestsPage({ root, params: {}, query: new URLSearchParams() }, [{ name: row.name, code: row.code, contest: { name: b.dataset.cname!, slug: b.dataset.slug! } }]);
  }));
}
