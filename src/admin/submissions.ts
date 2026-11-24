// 제출 현황: 저장소 만들기와 초대, 모듈별 제출 상태, 학생별 마감 연장, 백업 zip 내려받기.
import { $, fmtKst, html, isoToKstInput, kstInputToIso, type Safe } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { callAdmin, supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { admin, guard } from './auth.ts';
import { loadContest, type Contest, type Module } from './contests.ts';
import { adminShell, bindShell } from './shell.ts';

interface Part { id: string; repo_name: string | null; invite_status: string; students: { name: string; github_id: string | null } }
interface Sub { participant_id: string; module_id: string; method: 'repo' | 'zip'; status: 'open' | 'closed' | 'late'; last_push_at: string | null; ontime_commit: string | null; late_seconds: number | null; zip_path: string | null; zip_size: number | null; zip_purged_at: string | null }
interface Ext { id: string; participant_id: string; module_id: string; extended_until: string; reason: string | null }

const INVITE: Record<string, string> = { none: '초대 전', pending: '수락 대기', accepted: '참여 중', expired: '만료' };
const INVITE_TAG: Record<string, string> = { none: '', pending: 'amber', accepted: 'green', expired: 'red' };

export async function submissionsPage({ root, params }: RouteCtx) {
  if (!(await guard())) return;
  const c = await loadContest(params.id!);
  if (!c) return;
  await draw(root, c);
}

async function draw(root: HTMLElement, c: Contest) {
  const [{ data: ps }, { data: ms }] = await Promise.all([
    supabase.from('participants').select('id, repo_name, invite_status, students(name, github_id)').eq('contest_id', c.id),
    supabase.from('modules').select('*').eq('contest_id', c.id).order('code'),
  ]);
  const parts = ((ps ?? []) as unknown as Part[]).sort((a, b) => a.students.name.localeCompare(b.students.name, 'ko'));
  const mods = (ms ?? []) as Module[];
  const ids = parts.map((p) => p.id);
  const [{ data: ss }, { data: es }] = ids.length ? await Promise.all([
    supabase.from('submissions').select('participant_id, module_id, method, status, last_push_at, ontime_commit, late_seconds, zip_path, zip_size, zip_purged_at').in('participant_id', ids),
    supabase.from('deadline_extensions').select('id, participant_id, module_id, extended_until, reason').in('participant_id', ids),
  ]) : [{ data: [] }, { data: [] }];
  const subs = new Map(((ss ?? []) as Sub[]).map((s) => [`${s.participant_id}:${s.module_id}`, s]));
  const exts = new Map(((es ?? []) as Ext[]).map((e) => [`${e.participant_id}:${e.module_id}`, e]));

  const cell = (p: Part, m: Module): Safe => {
    const s = subs.get(`${p.id}:${m.id}`);
    const e = exts.get(`${p.id}:${m.id}`);
    const status = s?.status ?? 'open';
    return html`<td class="td" style="min-width:170px">
      ${status === 'late' ? html`<span class="tag amber">지각${s?.late_seconds ? ` ${Math.max(1, Math.round(s.late_seconds / 60))}분` : ''}</span>` : status === 'closed' ? html`<span class="tag">마감됨</span>` : html`<span class="tag green">진행 중</span>`}
      ${s?.method === 'zip' ? html`<span class="tag">zip</span>` : ''}
      <div class="small muted">${s?.last_push_at ? `push ${fmtKst(s.last_push_at)}` : s?.method === 'zip' ? '' : 'push 없음'}${s?.ontime_commit ? ` · ${s.ontime_commit.slice(0, 7)}` : ''}</div>
      ${s?.zip_path && !s.zip_purged_at ? html`<button type="button" class="btn line sm" data-zip="${s.zip_path}" style="margin-top:4px">zip ${s.zip_size ? `${(s.zip_size / 1048576).toFixed(1)}MB` : ''} 받기</button>` : s?.zip_purged_at ? html`<div class="small muted">zip 정리됨</div>` : ''}
      <div class="small" style="margin-top:4px">${e ? html`<span class="tag">연장 ${fmtKst(e.extended_until)}</span> <button type="button" class="btn line sm" data-ext-del="${e.id}">취소</button>`
        : html`<button type="button" class="btn line sm" data-ext="${p.id}" data-m="${m.id}" data-name="${p.students.name}" data-code="${m.code}" data-dl="${m.deadline ?? ''}">마감 연장</button>`}</div>
    </td>`;
  };

  const body = html`<h1>제출 현황</h1>
    <section class="panel"><div class="panel-b row">
      <button type="button" class="btn" id="mk" ${parts.length ? '' : 'disabled'}>저장소 만들고 학생 초대</button>
      <button type="button" class="btn line" id="inv" ${parts.length ? '' : 'disabled'}>초대 상태 확인</button>
      <button type="button" class="btn line" id="sync" ${parts.length ? '' : 'disabled'}>제출 현황 새로 고침</button>
      <span class="small muted" id="busy" role="status"></span></div>
      <p class="panel-b small muted" style="margin:0;padding-top:0">저장소는 ${c.github_org} 조직에 비공개로 만들어지고, 모듈 폴더(${mods.map((m) => m.folder).join(', ') || '모듈을 먼저 추가하세요'})가 들어 있습니다. 마감 시각은 1분마다 확인해 마지막 커밋을 기록하고, 마감 뒤 push는 지각으로 표시합니다.</p></section>
    ${mods.some((m) => !m.deadline) ? html`<p class="notice">마감 시각이 없는 모듈이 있습니다. <a href="/admin/c/${c.id}">대회 설정</a>에서 정해 주세요. 마감이 없으면 기록과 지각 표시가 이뤄지지 않습니다.</p>` : ''}
    <section class="panel scroll-x"><table><thead><tr><th class="th">참가자</th><th class="th">저장소</th>${mods.map((m) => html`<th class="th">Module ${m.code}<div class="small muted" style="font-weight:400">${m.deadline ? fmtKst(m.deadline) : '마감 없음'}</div></th>`)}</tr></thead><tbody>
      ${parts.length ? parts.map((p) => html`<tr><td class="td nw"><b>${p.students.name}</b><div class="small muted">${p.students.github_id ?? 'GitHub 아이디 없음'}</div></td>
        <td class="td nw">${p.repo_name ? html`<a href="https://github.com/${c.github_org}/${p.repo_name}" target="_blank" rel="noopener noreferrer">${p.repo_name}</a>` : '-'}<div><span class="tag ${INVITE_TAG[p.invite_status] ?? ''}">${INVITE[p.invite_status] ?? p.invite_status}</span></div></td>
        ${mods.map((m) => cell(p, m))}</tr>`) : html`<tr><td class="td muted" colspan="${2 + mods.length}">참가자가 없습니다. <a href="/admin/c/${c.id}/people">참가자와 확인 코드</a>에서 먼저 불러와 주세요.</td></tr>`}
    </tbody></table></section>
    <dialog id="dlg" style="width:min(440px,94vw);border:1px solid var(--line);padding:0"><form method="dialog" id="ext-form" class="stack" style="padding:20px"><h2 id="ext-title" style="font-size:18px;font-weight:700"></h2>
      <div class="field"><label for="ext-at">새 마감 시각(한국 시간)</label><input type="datetime-local" id="ext-at" required></div>
      <div class="field"><label for="ext-why">사유(선택)</label><input id="ext-why" maxlength="100"></div>
      <div class="row"><button class="btn" type="submit" value="ok">연장하기</button><button class="btn line" type="submit" value="cancel" formnovalidate>닫기</button></div></form></dialog>`;
  root.innerHTML = adminShell('contests', body, { contest: { id: c.id, name: c.name }, sub: 'submissions' }).value;
  document.title = '관리자 · 제출 현황';
  void bindShell(root);

  const busy = $('#busy', root)!;
  const run = async (btn: HTMLButtonElement, label: string, fn: () => Promise<string>) => {
    root.querySelectorAll<HTMLButtonElement>('#mk, #inv, #sync').forEach((b) => (b.disabled = true));
    busy.textContent = `${label} 중… (몇십 초 걸릴 수 있습니다)`;
    try { showToast(await fn()); } catch (e) { showToast((e as Error).message); }
    await draw(root, c);
  };
  const summarize = (r: { report: { name: string; status: string; note?: string }[] }) => {
    const bad = r.report.filter((x) => x.status === 'error' || x.status === 'no-github' || x.status === 'skipped');
    return bad.length ? `${r.report.length - bad.length}명 처리, ${bad.length}명 확인 필요: ${bad.map((b) => `${b.name}(${b.note ?? b.status})`).join(', ')}` : `${r.report.length}명 처리했습니다.`;
  };
  $<HTMLButtonElement>('#mk', root)!.addEventListener('click', (e) => {
    if (!confirm(`${parts.length}명의 저장소를 ${c.github_org} 조직에 만들고 학생을 초대할까요? 이미 있는 저장소는 그대로 둡니다.`)) return;
    void run(e.currentTarget as HTMLButtonElement, '저장소 만드는', async () => summarize(await callAdmin('create-repos', { action: 'create', contest_id: c.id })));
  });
  $<HTMLButtonElement>('#inv', root)!.addEventListener('click', (e) =>
    void run(e.currentTarget as HTMLButtonElement, '초대 상태 확인하는', async () => summarize(await callAdmin('create-repos', { action: 'refresh', contest_id: c.id }))));
  $<HTMLButtonElement>('#sync', root)!.addEventListener('click', (e) =>
    void run(e.currentTarget as HTMLButtonElement, 'GitHub에서 읽어 오는', async () => { const r = await callAdmin<{ updated: number; errors?: number }>('close-submissions', { contest_id: c.id, refresh: true }); return `${r.updated}건 갱신했습니다.${r.errors ? ` 오류 ${r.errors}건` : ''}`; }));

  root.querySelectorAll<HTMLButtonElement>('[data-zip]').forEach((b) => b.addEventListener('click', async () => {
    const { data, error } = await supabase.storage.from('submissions').createSignedUrl(b.dataset.zip!, 120, { download: true });
    if (error || !data) showToast('내려받기 주소를 만들지 못했습니다.'); else location.href = data.signedUrl;
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-ext-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 연장을 취소할까요? 원래 마감 시각으로 돌아갑니다.')) return;
    const { error } = await supabase.from('deadline_extensions').delete().eq('id', b.dataset.extDel!);
    if (error) { showToast('취소하지 못했습니다.'); return; }
    // 이미 마감 처리된 행이 있으면 다시 열어야 하므로 서버에서 한 번 계산하게 한다.
    void callAdmin('close-submissions', { contest_id: c.id, refresh: true }).catch(() => undefined);
    await draw(root, c);
  }));

  const dlg = $<HTMLDialogElement>('#dlg', root)!;
  let target: { p: string; m: string } | null = null;
  root.querySelectorAll<HTMLButtonElement>('[data-ext]').forEach((b) => b.addEventListener('click', () => {
    target = { p: b.dataset.ext!, m: b.dataset.m! };
    $('#ext-title', root)!.textContent = `${b.dataset.name} · Module ${b.dataset.code} 마감 연장`;
    $<HTMLInputElement>('#ext-at', root)!.value = isoToKstInput(b.dataset.dl || new Date().toISOString());
    $<HTMLInputElement>('#ext-why', root)!.value = '';
    dlg.showModal();
  }));
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok' || !target) return;
    const at = kstInputToIso($<HTMLInputElement>('#ext-at', root)!.value);
    if (!at) return;
    const { error } = await supabase.from('deadline_extensions').upsert(
      { participant_id: target.p, module_id: target.m, extended_until: at, reason: $<HTMLInputElement>('#ext-why', root)!.value.trim() || null, extended_by: admin().userId },
      { onConflict: 'participant_id,module_id' });
    if (error) { showToast('연장하지 못했습니다.'); return; }
    void callAdmin('close-submissions', { contest_id: c.id, refresh: true }).catch(() => undefined);
    showToast('연장했습니다.');
    await draw(root, c);
  });
}
