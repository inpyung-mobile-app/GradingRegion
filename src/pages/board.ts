import { $, fmt, fmtKstDate, html, raw, type Safe } from '../lib/html.ts';
import { navigate, onLeave, type RouteCtx } from '../lib/router.ts';
import { cachedResult, fetchResult } from '../lib/session.ts';
import { supabase } from '../lib/supabase.ts';
import { publicShell } from '../shell.ts';

interface ContestRow { slug: string; name: string; stage: string; year: number; held_on: string | null; leaderboard_mode: string }
interface ContestInfo extends ContestRow { modules: { code: string; title: string | null; folder: string; deadline: string | null }[] }
interface ModScore { sub: number; obj: number; total: number; max: number }
interface BoardRow {
  anon_no: number; display_name: string; subjective: number; objective: number; total: number; max_total: number;
  modules: Record<string, ModScore>;
}
interface Line { anon: number; name: string; sub: number; obj: number; total: number; max: number }

/** 같은 총점이면 객관 점수가 높은 사람이 앞선다. 총점과 객관이 모두 같으면 같은 순위. */
export function rankLines(lines: Line[]): (Line & { rank: number })[] {
  const sorted = [...lines].sort((a, b) => b.total - a.total || b.obj - a.obj || a.name.localeCompare(b.name, 'ko'));
  let rank = 0;
  return sorted.map((l, i) => {
    const p = sorted[i - 1];
    if (!p || p.total !== l.total || p.obj !== l.obj) rank = i + 1;
    return { ...l, rank };
  });
}

export async function boardPage({ root, params }: RouteCtx) {
  root.innerHTML = publicShell(params.slug ?? null, 'board', html`<main class="wrap"><p class="muted">불러오는 중…</p></main>`).value;

  const { data: list, error } = await supabase.rpc('list_public_contests');
  if (error) { root.innerHTML = publicShell(null, 'board', html`<main class="wrap"><p class="err">순위표를 불러오지 못했습니다. 잠시 뒤에 다시 열어 주세요.</p></main>`).value; return; }
  const contests = (list ?? []) as ContestRow[];
  const slugOrUndef = params.slug ?? contests[0]?.slug;
  if (!slugOrUndef) {
    root.innerHTML = publicShell(null, 'board', html`<main class="wrap"><section class="panel panel-b"><h1 style="font-size:22px">공개된 대회가 아직 없습니다</h1><p class="muted">대회가 공개되면 이곳에 순위표가 나타납니다.</p></section></main>`).value;
    return;
  }
  const slug: string = slugOrUndef;
  const [{ data: infoRaw }, { data: boardRaw }] = await Promise.all([
    supabase.rpc('get_contest_public', { p_slug: slug }),
    supabase.rpc('get_leaderboard', { p_slug: slug }),
  ]);
  const info = infoRaw as ContestInfo | null;
  if (!info) {
    root.innerHTML = publicShell(null, 'board', html`<main class="wrap"><section class="panel panel-b"><h1 style="font-size:22px">대회를 찾을 수 없습니다</h1><p><a href="/">처음으로</a></p></section></main>`).value;
    return;
  }
  const board = ((boardRaw ?? []) as BoardRow[]);
  const mine = cachedResult(slug);
  const hidden = info.leaderboard_mode === 'hidden';
  let tab = 'ALL';

  const isMine = (r: { name: string; anon: number }) =>
    !!mine && (info.leaderboard_mode === 'names' ? mine.participant.name === r.name : mine.participant.anonNo === r.anon);

  function lines(): Line[] {
    if (tab === 'ALL') return board.map((r) => ({ anon: r.anon_no, name: r.display_name, sub: r.subjective, obj: r.objective, total: r.total, max: r.max_total }));
    return board.filter((r) => r.modules[tab]).map((r) => {
      const m = r.modules[tab]!;
      return { anon: r.anon_no, name: r.display_name, sub: m.sub, obj: m.obj, total: m.total, max: m.max };
    });
  }

  function boardTable(): Safe {
    if (hidden) return html`<p class="panel panel-b muted" style="margin:0">이 대회의 순위표는 공개하지 않습니다. 본인 결과는 오른쪽에서 확인할 수 있습니다.</p>`;
    const rows = rankLines(lines());
    if (!rows.length) return html`<p class="panel panel-b muted" style="margin:0">아직 공개된 결과가 없습니다.</p>`;
    const scale = Math.max(...rows.map((r) => r.max));
    return html`<div class="panel scroll-x"><table>
      <thead><tr>
        <th class="th" scope="col" style="width:56px">순위</th><th class="th" scope="col">이름</th>
        <th class="th r" scope="col">주관</th><th class="th r" scope="col">객관</th>
        <th class="th" scope="col" style="padding-left:28px">총점${scale ? ` / ${scale}` : ''}</th><th class="th r" scope="col">감점</th>
      </tr></thead>
      <tbody>${rows.map((r) => {
        const me = isMine(r);
        return html`<tr class="${me ? 'me' : ''}" ${raw(me ? 'aria-current="true"' : '')}>
          <td class="td nw" style="font-weight:700;font-size:17px">${r.rank}</td>
          <td class="td nw">${me ? html`<a href="/c/${slug}/me" style="text-decoration:none;font-weight:600"><span class="mark">${r.name}</span></a><span class="small muted" style="margin-left:8px">내 결과</span>` : html`<span style="font-weight:500">${r.name}</span>`}</td>
          <td class="td r nw">${fmt(r.sub)}</td><td class="td r nw">${fmt(r.obj)}</td>
          <td class="td nw" style="padding-left:28px"><div class="row" style="gap:14px;flex-wrap:nowrap">
            <div class="ruler" aria-hidden="true"><i style="width:${(r.max ? (r.total / r.max) * 100 : 0).toFixed(2)}%;opacity:${me ? 1 : 0.72}"></i></div>
            <b style="font-size:17px;min-width:48px;text-align:right">${fmt(r.total)}</b></div></td>
          <td class="td r nw"><span class="pen">−${fmt(Math.max(0, r.max - r.total))}</span></td>
        </tr>`;
      })}</tbody></table></div>`;
  }

  function draw() {
    const tabs = [{ code: 'ALL', label: '전체' }, ...info!.modules.map((m) => ({ code: m.code, label: `Module ${m.code}` }))];
    const people = new Set(board.map((r) => r.anon_no)).size;
    const body = html`<main class="wrap">
      <section class="panel hero" aria-labelledby="contest-title">
        <div>
          <div class="stack" style="gap:10px">
            <label for="contest" class="small muted">대회</label>
            <h1 id="contest-title">${info!.name}</h1>
          </div>
          <div class="row small" style="color:var(--ink2)">
            <select id="contest" style="height:36px;padding:0 10px;border:1px solid var(--line3);border-radius:2px;background:#fff">
              ${contests.map((c) => html`<option value="${c.slug}" ${raw(c.slug === slug ? 'selected' : '')}>${c.name}</option>`)}
            </select><span>다른 대회 결과 보기</span>
          </div>
        </div>
        <dl class="dl">
          <dt>직종</dt><dd>모바일앱개발</dd>
          <dt>과제</dt><dd>${info!.modules.length ? info!.modules.map((m) => `Module ${m.code}${m.title ? ` (${m.title})` : ''}`).join(', ') : '준비 중'}</dd>
          <dt>대회일</dt><dd>${info!.held_on ? fmtKstDate(info!.held_on) : '-'}</dd>
          <dt>공개된 결과</dt><dd>${hidden ? '비공개' : `${people}명`}</dd>
          <dt style="border-bottom:0">순위표</dt><dd style="border-bottom:0">${{ names: '이름과 점수 공개', anonymous: '익명 공개', hidden: '비공개' }[info!.leaderboard_mode] ?? ''}</dd>
        </dl>
      </section>
      <div class="cols">
        <section class="col-main" aria-labelledby="board-title" style="gap:0">
          <h2 id="board-title" style="font-size:20px;font-weight:700;margin-bottom:12px">순위표</h2>
          ${hidden ? '' : html`<div class="tabs" role="tablist" aria-label="모듈">${tabs.map((t) => html`<button type="button" class="tab" role="tab" data-tab="${t.code}" aria-selected="${t.code === tab}">${t.label}</button>`)}</div>`}
          <div id="board-body">${boardTable()}</div>
          ${hidden ? '' : html`<p class="small muted" style="margin:12px 0 0">감점은 만점에서 받은 점수를 뺀 값입니다. 점수가 같으면 객관 점수가 높은 사람이 앞섭니다.</p>`}
        </section>
        <aside id="lookup" class="panel stack" aria-labelledby="lookup-title" tabindex="-1" style="flex:1 1 300px;gap:18px;padding:24px;margin-top:40px">
          <div class="stack" style="gap:6px">
            <h2 id="lookup-title" style="font-size:18px;font-weight:700"><span class="lk-mark">내 결과 보기</span></h2>
            <p class="txt" style="margin:0;color:var(--ink2)">항목별 감점 내용과 캡처는 본인만 볼 수 있습니다. 메시지로 받은 확인 코드를 입력해 주세요.</p>
          </div>
          <form id="lookup-form" class="stack" style="gap:18px" novalidate>
            <div class="field"><label for="name">이름</label><input id="name" name="name" type="text" autocomplete="name" required maxlength="40"></div>
            <div class="field"><label for="code">확인 코드 8자리</label><input id="code" name="code" type="password" autocomplete="off" required maxlength="20" style="letter-spacing:.2em"></div>
            <p id="lookup-err" class="err" role="alert" hidden></p>
            <button class="btn block" type="submit">결과 보기</button>
          </form>
          <a class="small" href="/c/${slug}/lost" style="align-self:flex-start;color:var(--ink2)">코드를 잃어버렸어요</a>
        </aside>
      </div>
    </main>`;
    root.innerHTML = publicShell(slug, 'board', body).value;
    document.title = `${info!.name} · 순위표`;
    bind();
  }

  let scrollFrame = 0;
  let focusTimer = 0;
  let flash = 0;
  onLeave(() => { cancelAnimationFrame(scrollFrame); clearTimeout(focusTimer); });

  /** '내 결과 보기' 메뉴: 거리에 비례한 스크롤(250+8√거리 ms, 최대 0.8초) 뒤 노란 테두리가 한 번 켜졌다 꺼지고, 제목에 형광펜이 그어진 다음 이름 칸에 포커스. */
  function goLookup(e?: Event) {
    e?.preventDefault();
    const box = document.getElementById('lookup');
    if (!box) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    cancelAnimationFrame(scrollFrame);
    const rootEl = document.scrollingElement ?? document.documentElement;
    const r = box.getBoundingClientRect();
    const max = rootEl.scrollHeight - window.innerHeight;
    const target = Math.max(0, Math.min(max, rootEl.scrollTop + r.top - Math.max(0, (window.innerHeight - r.height) / 2)));
    const from = rootEl.scrollTop;
    const dist = Math.abs(target - from);
    const dur = Math.min(800, Math.round(250 + 8 * Math.sqrt(dist)));
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    if (calm || dist < 2) rootEl.scrollTop = target;
    else {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        rootEl.scrollTop = from + (target - from) * ease(t);
        if (t < 1) scrollFrame = requestAnimationFrame(step);
      };
      scrollFrame = requestAnimationFrame(step);
    }
    flash++;
    box.style.setProperty('--lk', `${dur}ms`);
    box.style.setProperty('--lkm', `${Math.round(dur * 0.8 + Math.min(250, dist / 20))}ms`);
    box.classList.remove('lk-a', 'lk-b');
    void box.offsetWidth; // 같은 애니메이션을 다시 시작하려고 A/B를 번갈아 쓴다
    box.classList.add('lk-on', flash % 2 ? 'lk-a' : 'lk-b');
    clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => $<HTMLInputElement>('#name')?.focus({ preventScroll: true }), calm ? 0 : dur + 100);
  }

  function bind() {
    $('#nav-lookup')?.addEventListener('click', goLookup);
    $<HTMLSelectElement>('#contest')?.addEventListener('change', (e) => navigate(`/c/${(e.target as HTMLSelectElement).value}`));
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.tab!;
        root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String((x as HTMLElement).dataset.tab === tab)));
        $('#board-body')!.innerHTML = boardTable().value;
      }));
    $<HTMLFormElement>('#lookup-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
      const code = (f.elements.namedItem('code') as HTMLInputElement).value.trim();
      const err = $('#lookup-err')!;
      err.hidden = true;
      if (!name || !code) { err.textContent = '이름과 확인 코드를 입력해 주세요.'; err.hidden = false; return; }
      const btn = f.querySelector<HTMLButtonElement>('button[type=submit]')!;
      btn.disabled = true;
      try {
        await fetchResult(slug!, name, code);
        navigate(`/c/${slug}/me`);
      } catch (ex) {
        err.textContent = (ex as Error).message; err.hidden = false; btn.disabled = false;
      }
    });
  }

  draw();
  if (location.hash === '#lookup') setTimeout(() => goLookup(), 60);
}
