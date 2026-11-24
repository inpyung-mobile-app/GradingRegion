import { $, fmtKst, html, isoToKstInput, kstInputToIso, raw, type Safe } from '../lib/html.ts';
import { navigate, type RouteCtx } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { guard } from './auth.ts';
import { adminShell, bindShell, errorBox } from './shell.ts';

export interface Contest {
  id: string; slug: string; name: string; stage: 'reg' | 'nat'; year: number; held_on: string | null;
  leaderboard_mode: 'hidden' | 'anonymous' | 'names'; is_public: boolean; zip_retention_days: number; github_org: string;
}
export interface Module { id: string; contest_id: string; code: 'A' | 'B' | 'C'; title: string | null; rubric_id: string | null; folder: string; deadline: string | null }

export async function loadContest(id: string): Promise<Contest | null> {
  const { data } = await supabase.from('contests').select('*').eq('id', id).maybeSingle();
  return (data as Contest | null) ?? null;
}

const STAGE = { reg: '지방', nat: '전국' } as const;

export async function contestsPage({ root }: RouteCtx) {
  if (!(await guard())) return;
  const { data, error } = await supabase.from('contests').select('*').order('year', { ascending: false }).order('created_at', { ascending: false });
  const list = (data ?? []) as Contest[];
  const body = html`<h1>대회</h1>
    ${error ? errorBox('대회 목록을 불러오지 못했습니다.') : ''}
    <section class="panel scroll-x"><table><thead><tr><th class="th">대회</th><th class="th">단계</th><th class="th">대회일</th><th class="th">공개</th><th class="th">순위표</th><th class="th"></th></tr></thead><tbody>
      ${list.length ? list.map((c) => html`<tr><td class="td"><a href="/admin/c/${c.id}" style="font-weight:600">${c.name}</a><div class="small muted">${c.slug}</div></td>
        <td class="td nw">${c.year} ${STAGE[c.stage]}</td><td class="td nw">${c.held_on ?? '-'}</td>
        <td class="td">${c.is_public ? html`<span class="tag green">공개</span>` : html`<span class="tag">비공개</span>`}</td>
        <td class="td nw">${{ names: '이름 공개', anonymous: '익명', hidden: '숨김' }[c.leaderboard_mode]}</td>
        <td class="td r"><a class="btn line sm" href="/admin/c/${c.id}">열기</a></td></tr>`) : html`<tr><td class="td muted" colspan="6">아직 대회가 없습니다. 아래에서 만들어 주세요.</td></tr>`}
    </tbody></table></section>
    <section class="panel"><h2 class="panel-h">새 대회 만들기</h2><form id="new" class="panel-b stack" novalidate>
      <div class="grid2">
        <div class="field"><label for="name">대회 이름</label><input id="name" required maxlength="80" placeholder="2026 지방기능경기대회 대비 모의평가"></div>
        <div class="field"><label for="slug">주소 이름(영문 소문자, 숫자, -)</label><input id="slug" required maxlength="40" pattern="[a-z0-9][a-z0-9-]*" placeholder="2026-reg-mock"><span class="hint">참가자 주소는 /c/이 이름 이 됩니다.</span></div>
        <div class="field"><label for="stage">단계</label><select id="stage"><option value="reg">지방</option><option value="nat">전국</option></select><span class="hint">학생 저장소 이름(2026-reg-lyj)에 쓰입니다.</span></div>
        <div class="field"><label for="year">연도</label><input id="year" type="number" value="${new Date().getFullYear()}" min="2000" max="2100"></div>
      </div><p id="err" class="err" role="alert" hidden></p>
      <button class="btn" type="submit" style="align-self:flex-start">대회 만들기</button></form></section>`;
  root.innerHTML = adminShell('contests', body).value;
  document.title = '관리자 · 대회';
  void bindShell(root);
  $<HTMLFormElement>('#new')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id: string) => $<HTMLInputElement>('#' + id)!.value.trim();
    const err = $('#err')!;
    const slug = v('slug');
    if (!v('name') || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) { err.textContent = '이름과 주소 이름(영문 소문자, 숫자, -)을 확인해 주세요.'; err.hidden = false; return; }
    const { data: row, error: e2 } = await supabase.from('contests').insert({ name: v('name'), slug, stage: v('stage'), year: Number(v('year')) }).select('id').single();
    if (e2) { err.textContent = e2.code === '23505' ? '같은 주소 이름의 대회가 이미 있습니다.' : '만들지 못했습니다.'; err.hidden = false; return; }
    navigate(`/admin/c/${row.id}`);
  });
}

export async function contestSettingsPage({ root, params }: RouteCtx) {
  if (!(await guard())) return;
  const c = await loadContest(params.id!);
  if (!c) { root.innerHTML = adminShell('contests', html`<h1>대회를 찾을 수 없습니다</h1>`).value; return; }
  const { data: mods } = await supabase.from('modules').select('*').eq('contest_id', c.id).order('code');
  const byCode = new Map(((mods ?? []) as Module[]).map((m) => [m.code, m]));

  const modRow = (code: 'A' | 'B' | 'C'): Safe => {
    const m = byCode.get(code);
    return html`<tr data-code="${code}"><td class="td" style="font-weight:600">Module ${code}</td>
      <td class="td"><input class="m-title" value="${m?.title ?? ''}" maxlength="60" placeholder="예: Vinyl Groove" style="width:100%;min-height:36px;padding:0 8px;border:1px solid var(--line3)"></td>
      <td class="td"><input class="m-folder" value="${m?.folder ?? `module-${code.toLowerCase()}`}" style="width:120px;min-height:36px;padding:0 8px;border:1px solid var(--line3)"></td>
      <td class="td"><input class="m-deadline" type="datetime-local" value="${isoToKstInput(m?.deadline)}" style="min-height:36px;padding:0 8px;border:1px solid var(--line3)"></td>
      <td class="td nw"><button type="button" class="btn sm m-save">${m ? '저장' : '추가'}</button></td></tr>`;
  };

  const body = html`<h1>대회 설정</h1>
    <section class="panel"><h2 class="panel-h">기본 정보</h2><form id="f" class="panel-b stack" novalidate>
      <div class="grid2">
        <div class="field"><label for="name">대회 이름</label><input id="name" value="${c.name}" maxlength="80" required></div>
        <div class="field"><label for="held">대회일</label><input id="held" type="date" value="${c.held_on ?? ''}"></div>
        <div class="field"><label for="stage">단계</label><select id="stage"><option value="reg" ${raw(c.stage === 'reg' ? 'selected' : '')}>지방</option><option value="nat" ${raw(c.stage === 'nat' ? 'selected' : '')}>전국</option></select></div>
        <div class="field"><label for="year">연도</label><input id="year" type="number" value="${c.year}"></div>
        <div class="field"><label for="mode">순위표 공개 방식</label><select id="mode">
          <option value="names" ${raw(c.leaderboard_mode === 'names' ? 'selected' : '')}>이름과 점수 공개(기본)</option>
          <option value="anonymous" ${raw(c.leaderboard_mode === 'anonymous' ? 'selected' : '')}>익명(참가자 3 처럼)</option>
          <option value="hidden" ${raw(c.leaderboard_mode === 'hidden' ? 'selected' : '')}>숨김(본인 결과만)</option></select></div>
        <div class="field"><label for="ret">제출 zip 보관 기간(공개 뒤 며칠)</label><input id="ret" type="number" min="0" max="365" value="${c.zip_retention_days}"><span class="hint">기간이 지나면 제출 zip만 자동으로 지웁니다. 결과와 캡처는 지우지 않습니다.</span></div>
      </div>
      <label class="row" style="gap:8px"><input id="pub" type="checkbox" ${raw(c.is_public ? 'checked' : '')}> <span><b>대회 공개</b> — 켜면 참가자 화면의 대회 목록과 순위표에 나타납니다. 결과는 모듈별로 따로 공개합니다.</span></label>
      <p class="small muted" style="margin:0">주소: <code>/c/${c.slug}</code> · 저장소 이름 규칙: <code>${c.year}-${c.stage}-약칭</code> · GitHub 조직: <code>${c.github_org}</code></p>
      <p id="err" class="err" role="alert" hidden></p>
      <button class="btn" type="submit" style="align-self:flex-start">저장</button></form></section>
    <section class="panel"><h2 class="panel-h">모듈과 제출 마감 <span class="small muted" style="font-weight:400">시각은 모두 한국 시간(KST)</span></h2>
      <div class="scroll-x"><table><thead><tr><th class="th">모듈</th><th class="th">제목</th><th class="th">저장소 폴더</th><th class="th">제출 마감(KST)</th><th class="th"></th></tr></thead>
      <tbody id="mods">${(['A', 'B', 'C'] as const).map(modRow)}</tbody></table></div>
      <p class="small muted panel-b" style="margin:0">모듈 마감 시각이 되면 그 폴더의 마지막 커밋을 기록하고 제출 zip을 보관합니다. 마감 뒤에 올라온 푸시는 지각으로 표시만 합니다. 학생별 마감 연장은 <a href="/admin/c/${c.id}/submissions">제출 현황</a>에서 합니다.</p></section>`;
  root.innerHTML = adminShell('contests', body, { contest: { id: c.id, name: c.name }, sub: '' }).value;
  document.title = `관리자 · ${c.name}`;
  void bindShell(root);

  $<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err')!;
    const g = (id: string) => $<HTMLInputElement>('#' + id)!;
    const { error } = await supabase.from('contests').update({
      name: g('name').value.trim(), held_on: g('held').value || null, stage: g('stage').value, year: Number(g('year').value),
      leaderboard_mode: g('mode').value, zip_retention_days: Number(g('ret').value), is_public: g('pub').checked,
    }).eq('id', c.id);
    err.hidden = !error;
    if (error) err.textContent = '저장하지 못했습니다. 입력값을 확인해 주세요.';
    else showToast('저장했습니다.');
  });

  root.querySelectorAll<HTMLButtonElement>('.m-save').forEach((btn) => btn.addEventListener('click', async () => {
    const tr = btn.closest('tr')!;
    const code = tr.dataset.code as 'A' | 'B' | 'C';
    const folder = $<HTMLInputElement>('.m-folder', tr)!.value.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(folder)) { showToast('폴더 이름은 영문 소문자, 숫자, -만 쓸 수 있습니다.'); return; }
    const row = { contest_id: c.id, code, title: $<HTMLInputElement>('.m-title', tr)!.value.trim() || null, folder, deadline: kstInputToIso($<HTMLInputElement>('.m-deadline', tr)!.value) };
    const { error } = await supabase.from('modules').upsert(row, { onConflict: 'contest_id,code' });
    if (error) showToast('저장하지 못했습니다.');
    else { showToast(`Module ${code}를 저장했습니다.`); btn.textContent = '저장'; }
  }));
  void fmtKst;
}
