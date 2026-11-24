// 참가자 과제 제출 현황: 저장소 주소, 마감까지 남은 시간, 마지막 push, 지각 표시, 백업 zip 올리기.
import { $, fmtKst, html, type Safe } from '../lib/html.ts';
import { onLeave, type RouteCtx } from '../lib/router.ts';
import { loadCreds, saveCreds, clearCreds } from '../lib/session.ts';
import { callPublic, supabase } from '../lib/supabase.ts';
import { publicShell, showToast } from '../shell.ts';

interface ModuleStatus {
  code: string; title: string | null; folder: string; deadline: string | null; extended: boolean;
  status: 'open' | 'closed' | 'late'; method: 'repo' | 'zip';
  lastPushAt: string | null; lastPushSha: string | null; ontimeCommit: string | null; lateSeconds: number | null;
  zip: { size: number | null; uploadedAt: string | null } | null;
}
interface Status {
  contest: { slug: string; name: string }; participant: { name: string };
  repo: { name: string; url: string; invite: string } | null; modules: ModuleStatus[];
}

const MAX_ZIP = 50 * 1024 * 1024;
const INVITE: Record<string, string> = { none: '초대 전', pending: '초대 수락 대기', accepted: '참여 중', expired: '초대 만료' };

function left(deadline: string | null, now = Date.now()): string {
  if (!deadline) return '마감 시각 없음';
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return '마감됨';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return `${d ? `${d}일 ` : ''}${h || d ? `${h}시간 ` : ''}${mm}분 남음`;
}
function lateText(sec: number): string {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}
const mb = (n: number | null) => (n ? `${(n / 1048576).toFixed(1)}MB` : '');

export async function submitPage({ root, params }: RouteCtx) {
  const slug = params.slug!;
  let timer: number | undefined;
  onLeave(() => window.clearInterval(timer));

  function frame(inner: Safe) {
    root.innerHTML = publicShell(slug, 'submit', html`<main class="wrap" style="max-width:860px">${inner}</main>`).value;
    document.title = '과제 제출';
  }

  function loginForm(msg = '') {
    const saved = loadCreds(slug);
    frame(html`<section class="panel stack" style="padding:28px;gap:18px" aria-labelledby="t">
      <h1 id="t" style="font-size:24px;font-weight:700">과제 제출 현황</h1>
      <p class="txt" style="margin:0;color:var(--ink2);line-height:1.7">이름과 확인 코드를 입력하면 내 저장소 주소와 제출 상태를 볼 수 있습니다. 결과를 볼 때 쓰는 코드와 같습니다.</p>
      <form id="f" class="stack" novalidate>
        <div class="field"><label for="n">이름</label><input id="n" maxlength="40" autocomplete="name" value="${saved?.name ?? ''}" required></div>
        <div class="field"><label for="c">확인 코드</label><input id="c" maxlength="40" autocomplete="off" spellcheck="false" value="${saved?.code ?? ''}" required></div>
        <p id="msg" class="err" role="alert" ${msg ? '' : 'hidden'}>${msg}</p>
        <button class="btn" type="submit" style="align-self:flex-start">제출 현황 보기</button>
      </form></section>`);
    $<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $<HTMLInputElement>('#n')!.value.trim();
      const code = $<HTMLInputElement>('#c')!.value.trim();
      if (!name || !code) return;
      const btn = (e.target as HTMLFormElement).querySelector('button')!;
      btn.disabled = true;
      await load(name, code, true);
      btn.disabled = false;
    });
  }

  async function load(name: string, code: string, fromForm = false) {
    try {
      const st = await callPublic<Status>('submission', { slug, name, code, action: 'status' });
      saveCreds(slug, name, code);
      draw(st, name, code);
    } catch (e) {
      if (!fromForm) { clearCreds(slug); loginForm(); return; }
      const msg = $('#msg');
      if (msg) { msg.textContent = (e as Error).message; msg.hidden = false; }
    }
  }

  function draw(st: Status, name: string, code: string) {
    const card = (m: ModuleStatus): Safe => {
      const closed = m.status !== 'open';
      return html`<section class="panel" data-code="${m.code}" aria-labelledby="m-${m.code}">
        <h2 class="panel-h" id="m-${m.code}"><span>Module ${m.code}${m.title ? ` · ${m.title}` : ''}</span>
          ${m.status === 'late' ? html`<span class="tag amber">지각 제출</span>` : closed ? html`<span class="tag">마감됨</span>` : html`<span class="tag green">제출 가능</span>`}</h2>
        <div class="panel-b stack">
          <dl class="kv">
            <dt>마감</dt><dd>${m.deadline ? fmtKst(m.deadline) : '정해지지 않음'}${m.extended ? html` <span class="tag">연장됨</span>` : ''}<br><b data-left="${m.deadline ?? ''}">${left(m.deadline)}</b></dd>
            <dt>제출 방식</dt><dd>${m.method === 'zip' ? '백업 zip' : `저장소의 ${m.folder} 폴더`}</dd>
            ${m.method === 'repo' ? html`<dt>마지막 push</dt><dd>${m.lastPushAt ? html`${fmtKst(m.lastPushAt)} <span class="small muted">(${m.lastPushSha})</span>` : '아직 없음'}</dd>` : ''}
            ${m.ontimeCommit ? html`<dt>마감 시점 커밋</dt><dd>${m.ontimeCommit}</dd>` : ''}
            ${m.lateSeconds ? html`<dt>지각</dt><dd>마감 ${lateText(m.lateSeconds)} 뒤에 올렸습니다. 점수에는 영향이 없고 표시만 됩니다.</dd>` : ''}
            ${m.zip ? html`<dt>올린 zip</dt><dd>${m.zip.uploadedAt ? fmtKst(m.zip.uploadedAt) : ''} ${mb(m.zip.size)}</dd>` : ''}
          </dl>
          <details><summary style="cursor:pointer;font-weight:600">저장소 push가 안 될 때: 백업 zip으로 올리기</summary>
            <div class="stack" style="margin-top:12px">
              <p class="small muted" style="margin:0">프로젝트 폴더를 zip으로 묶어 올려 주세요. 최대 50MB이고 build, .dart_tool 같은 폴더는 빼 주세요. ${closed ? '마감이 지났으므로 지각으로 표시됩니다.' : ''} 다시 올리면 이전 zip은 바뀝니다.</p>
              <input type="file" accept=".zip,application/zip" data-zip="${m.code}">
              <p class="err" role="alert" data-err="${m.code}" hidden></p>
              <div class="row"><button type="button" class="btn sm" data-up="${m.code}">zip 올리기</button><span class="small muted" data-state="${m.code}"></span></div>
            </div></details>
        </div></section>`;
    };
    frame(html`
      <section class="panel stack" style="padding:24px 28px;gap:10px" aria-labelledby="who">
        <span class="small muted">${st.contest.name}</span>
        <h1 id="who" style="font-size:28px;font-weight:700">${st.participant.name}님의 제출 현황</h1>
        ${st.repo ? html`<dl class="kv"><dt>내 저장소</dt><dd><a href="${st.repo.url}" target="_blank" rel="noopener noreferrer">${st.repo.url}</a></dd>
          <dt>초대 상태</dt><dd>${INVITE[st.repo.invite] ?? st.repo.invite}${st.repo.invite === 'pending' ? html`<br><span class="small muted">GitHub 알림 메일의 초대를 수락해 주세요.</span>` : ''}</dd></dl>`
          : html`<p class="muted" style="margin:0">아직 저장소가 만들어지지 않았습니다. 관리자에게 문의해 주세요.</p>`}
        <div class="row"><button type="button" class="btn line sm" id="refresh">새로 고침</button><button type="button" class="btn line sm" id="leave">조회 종료</button></div>
      </section>
      ${st.modules.length ? st.modules.map(card) : html`<p class="notice">아직 모듈이 정해지지 않았습니다.</p>`}`);

    window.clearInterval(timer);
    timer = window.setInterval(() => root.querySelectorAll<HTMLElement>('[data-left]').forEach((el) => { el.textContent = left(el.dataset.left || null); }), 30000);
    $('#refresh')!.addEventListener('click', () => void load(name, code));
    $('#leave')!.addEventListener('click', () => { clearCreds(slug); loginForm(); });
    root.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => void upload(b, name, code)));
  }

  async function upload(btn: HTMLButtonElement, name: string, code: string) {
    const mod = btn.dataset.up!;
    const input = $<HTMLInputElement>(`[data-zip="${mod}"]`)!;
    const err = $(`[data-err="${mod}"]`)!;
    const state = $(`[data-state="${mod}"]`)!;
    err.hidden = true;
    const f = input.files?.[0];
    const fail = (m: string) => { err.textContent = m; err.hidden = false; state.textContent = ''; btn.disabled = false; };
    if (!f) return fail('올릴 zip 파일을 골라 주세요.');
    if (!/\.zip$/i.test(f.name)) return fail('zip 파일만 올릴 수 있습니다.');
    if (f.size > MAX_ZIP) return fail(`파일이 너무 큽니다(${mb(f.size)}). 50MB 이하로 줄여 주세요. build, .dart_tool 폴더를 빼면 크게 줄어듭니다.`);
    btn.disabled = true;
    try {
      state.textContent = '올리는 중…';
      const signed = await callPublic<{ path: string; token: string }>('submission', { slug, name, code, action: 'sign', module: mod });
      const up = await supabase.storage.from('submissions').uploadToSignedUrl(signed.path, signed.token, f, { contentType: 'application/zip' });
      if (up.error) throw new Error('파일을 올리지 못했습니다. 잠시 뒤 다시 해 주세요.');
      const done = await callPublic<{ late: boolean }>('submission', { slug, name, code, action: 'confirm', module: mod, path: signed.path });
      showToast(done.late ? '올렸습니다. 마감이 지나 지각으로 표시됩니다.' : 'zip을 올렸습니다.');
      await load(name, code);
    } catch (e) { fail((e as Error).message); }
  }

  const saved = loadCreds(slug);
  if (saved) { frame(html`<p class="muted">불러오는 중…</p>`); await load(saved.name, saved.code); } else loginForm();
}
