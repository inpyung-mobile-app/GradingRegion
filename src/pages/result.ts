import { $, fmt, fmtKstDate, html, raw } from '../lib/html.ts';
import { navigate, type RouteCtx } from '../lib/router.ts';
import { cachedResult, clearCreds, refetchResult, type ViewedModule, type ViewedResult } from '../lib/session.ts';
import { supabase } from '../lib/supabase.ts';
import { publicShell } from '../shell.ts';
import { bindModule, notes, sheet, side } from './module-view.ts';
import { rankLines } from './board.ts';


interface ContestInfo { name: string; modules: { code: string; title: string | null }[] }
interface BoardRow { anon_no: number; display_name: string; subjective: number; objective: number; total: number; max_total: number; modules: Record<string, { sub: number; obj: number; total: number; max: number }> }

export async function resultPage({ root, params }: RouteCtx) {
  const slug = params.slug!;
  root.innerHTML = publicShell(slug, 'me', html`<main class="wrap"><p class="muted">불러오는 중…</p></main>`).value;

  const found: ViewedResult | null = cachedResult(slug) ?? (await refetchResult(slug));
  if (!found) { navigate(`/c/${slug}#lookup`, true); return; }
  const res: ViewedResult = found;
  const [{ data: infoRaw }, { data: boardRaw }] = await Promise.all([
    supabase.rpc('get_contest_public', { p_slug: slug }),
    supabase.rpc('get_leaderboard', { p_slug: slug }),
  ]);
  const info = (infoRaw ?? { name: res.contest.name, modules: [] }) as ContestInfo;
  const board = (boardRaw ?? []) as BoardRow[];
  const hasModule = new Set(res.modules.map((m) => m.code));
  let current = res.modules[0]?.code ?? '';

  function rankText(m: ViewedModule): string {
    const lines = board.filter((r) => r.modules[m.code]).map((r) => ({ anon: r.anon_no, name: r.display_name, sub: r.modules[m.code]!.sub, obj: r.modules[m.code]!.obj, total: r.modules[m.code]!.total, max: r.modules[m.code]!.max }));
    if (!lines.length) return `${m.scores.maxTotal}점 만점`;
    const ranked = rankLines(lines);
    const me = ranked.find((l) => l.anon === res.participant.anonNo);
    return me ? `${m.scores.maxTotal}점 만점, ${ranked.length}명 중 ${me.rank}위` : `${m.scores.maxTotal}점 만점`;
  }

  function draw() {
    const m = res.modules.find((x) => x.code === current);
    const body = html`<main class="wrap">
      <section class="panel hero" aria-labelledby="who" style="grid-template-columns:minmax(0,1fr) 340px">
        <div style="justify-content:flex-start;gap:14px">
          <a href="/c/${slug}" class="small" style="color:var(--ink2)">${info.name}</a>
          <h1 id="who" style="font-size:40px">${res.participant.name}</h1>
          ${m ? html`<div class="row small" style="gap:24px;color:var(--ink2)"><span>Module ${m.code}${m.title ? ` (${m.title})` : ''}</span>${m.graded.commit ? html`<span>채점한 커밋 ${m.graded.commit.slice(0, 7)}</span>` : m.graded.zip ? html`<span>채점한 제출물 zip</span>` : ''}${m.graded.late ? html`<span class="tag amber">지각 제출</span>` : ''}<span>채점 ${fmtKstDate(m.updatedAt)}</span></div>` : ''}
          <div class="chips" role="tablist" aria-label="모듈">${(info.modules.length ? info.modules.map((x) => x.code) : [...hasModule]).map((c) => html`<button type="button" class="chip" role="tab" data-mod="${c}" aria-selected="${c === current}" ${raw(hasModule.has(c) ? '' : 'disabled')}>Module ${c}${hasModule.has(c) ? '' : ' (채점 전)'}</button>`)}</div>
        </div>
        <div style="position:relative;padding:20px 24px 24px;align-items:center;justify-content:center;gap:6px;border-right:0">
          ${m ? html`<div style="position:relative;width:240px;height:132px;display:flex;align-items:center;justify-content:center">
            <svg aria-hidden="true" width="240" height="132" viewBox="0 0 240 132" style="position:absolute;inset:0"><path d="M46 30 C88 6 176 8 214 38 C240 60 226 104 172 118 C118 132 52 124 26 96 C6 74 18 44 60 26 C82 17 110 14 138 15" fill="none" stroke="#C62F28" stroke-width="2.6" stroke-linecap="round"></path></svg>
            <span class="pen" style="position:relative;font-size:72px" aria-label="총점 ${fmt(m.scores.total)}점">${fmt(m.scores.total)}</span></div>
            <span style="font-size:15px;color:var(--ink2)">${rankText(m)}</span>` : html`<span class="muted">공개된 결과가 아직 없습니다.</span>`}
        </div>
      </section>
      ${m ? html`<div class="cols">
        <div class="col-main">
          <section class="sec" aria-labelledby="sheet-title"><h2 id="sheet-title">채점표</h2><div class="panel scroll-x">${sheet(m)}</div></section>
          ${notes(m)}
        </div>
        <aside class="col-side" style="margin-top:40px">
          ${side(m)}
        </aside></div>` : ''}
      <div class="row"><button type="button" class="btn line" id="leave">조회 종료</button><span class="small muted">공용 컴퓨터라면 조회를 끝내 주세요. 이 탭에 저장된 확인 코드가 지워집니다.</span></div>
    </main>`;
    root.innerHTML = publicShell(slug, 'me', body).value;
    document.title = `${res.participant.name} · ${info.name}`;
    bind(m);
  }

  function bind(m: ViewedModule | undefined) {
    root.querySelectorAll<HTMLButtonElement>('[data-mod]').forEach((b) => b.addEventListener('click', () => { current = b.dataset.mod!; draw(); window.scrollTo(0, 0); }));
    $('#leave')?.addEventListener('click', () => { clearCreds(slug); navigate(`/c/${slug}`); });
    if (m) bindModule(root, m);
  }

  draw();
}
