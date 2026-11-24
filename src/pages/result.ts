import { $, fmt, fmtKstDate, html, raw, type Safe } from '../lib/html.ts';
import { markdown } from '../lib/markdown.ts';
import { navigate, type RouteCtx } from '../lib/router.ts';
import { cachedResult, clearCreds, refetchResult, type ViewedModule, type ViewedResult } from '../lib/session.ts';
import { supabase } from '../lib/supabase.ts';
import { openLightbox, type LightboxItem } from '../lightbox.ts';
import { publicShell } from '../shell.ts';
import { NOTE_KIND_LABEL, type ViewItem } from '../../shared/view.ts';
import { rankLines } from './board.ts';

const CIRCLE = html`<svg role="img" aria-label="만점" width="28" height="28" viewBox="0 0 28 28"><path d="M15 4 C22 4 25 10 24 15 C23 21 17 24 12 23 C6 22 3 17 4 12 C5 7 9 4 16 5" fill="none" stroke="#C62F28" stroke-width="2" stroke-linecap="round"></path></svg>`;
const IMG_ICON = html`<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 16l5-5 4 4 3-3 6 6"></path></svg>`;

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

  function itemRow(it: ViewItem, m: ViewedModule): Safe {
    const files = it.comment?.evidence ?? [];
    return html`<tr>
        <td class="td id">${it.id}</td><td class="td">${it.title}</td>
        <td class="td r nw muted">${fmt(it.points)}</td><td class="td r nw" style="font-weight:600">${fmt(it.score)}</td>
        <td class="td r nw">${it.deducted ? html`<span class="pen">−${fmt(it.points - it.score)}</span>` : CIRCLE}</td>
      </tr>
      ${it.deducted ? html`<tr><td class="note" colspan="5"><div class="note-grid">
        <div><span class="lbl">문제</span><span class="txt">${it.comment?.issue ?? '(코멘트 없음)'}</span>
          ${it.failedChecks.length ? html`<ul class="small muted" style="margin:6px 0 0;padding-left:18px">${it.failedChecks.map((c) => html`<li>${c.text}</li>`)}</ul>` : ''}</div>
        <div><span class="lbl">근거</span>${files.map((f, k) => html`<button class="file" type="button" data-open="${it.id}" data-i="${k}" aria-haspopup="dialog">${IMG_ICON}${f}</button>`)}</div>
        <div><span class="lbl">고칠 방법</span><span class="txt">${it.comment?.fix ?? ''}</span></div>
      </div></td></tr>` : ''}`;
  }

  function sheet(m: ViewedModule): Safe {
    const group = (type: 'subjective' | 'objective', label: string, got: number, max: number) => {
      const rows = m.items.filter((i) => i.type === type);
      if (!rows.length) return '';
      return html`<tr><td class="grp" colspan="4" ${raw(type === 'objective' ? 'style="border-top:1px solid var(--line)"' : '')}>${label}</td><td class="grp r" style="font-variant-numeric:tabular-nums;${type === 'objective' ? 'border-top:1px solid var(--line)' : ''}">${fmt(got)} / ${max}</td></tr>${rows.map((r) => itemRow(r, m))}`;
    };
    return html`<table><thead><tr>
      <th class="th" scope="col" style="width:64px">번호</th><th class="th" scope="col">항목</th>
      <th class="th r" scope="col" style="width:72px">배점</th><th class="th r" scope="col" style="width:72px">득점</th><th class="th r" scope="col" style="width:96px">채점</th>
    </tr></thead><tbody>${group('subjective', '주관 항목', m.scores.subjective, m.scores.maxSubjective)}${group('objective', '객관 항목', m.scores.objective, m.scores.maxObjective)}</tbody></table>`;
  }

  const imgUrl = (m: ViewedModule, f: string) => m.images[f];
  const imgFig = (m: ViewedModule, f: string, k: number) => html`<figure><button type="button" class="shot" data-note-img="${k}" data-file="${f}" aria-haspopup="dialog" style="width:150px"><div class="shot-box">${imgUrl(m, f) ? html`<img src="${imgUrl(m, f)}" alt="${f}" loading="lazy">` : ''}</div><span class="shot-name">${f}</span></button></figure>`;

  function notes(m: ViewedModule): Safe {
    const proto = m.notes.filter((n) => n.kind === 'proto');
    const others = m.notes.filter((n) => n.kind !== 'proto');
    return html`
      ${proto.length ? html`<section class="sec" aria-labelledby="proto-title"><h2 id="proto-title">프로토타입과 비교</h2><div class="panel">${proto.map((n, pi) => html`
        <div class="proto"><div class="stack" style="grid-column:1/3;gap:8px"><div class="row" style="align-items:flex-start;gap:24px">${(n.images ?? []).map((f, k) => imgFig(m, f, pi * 100 + k))}</div></div>
        <div class="stack" style="gap:10px"><h3 style="font-size:16px;font-weight:700">${n.title}</h3><div class="txt md">${markdown(n.body)}</div></div></div>`)}</div></section>` : ''}
      ${others.length ? html`<section class="sec" aria-labelledby="code-title"><h2 id="code-title">코드 리뷰와 기타 의견</h2><div class="panel">${others.map((n) => html`
        <div style="padding:20px 24px;border-bottom:1px solid var(--line2)" class="stack"><div class="row" style="gap:8px"><span class="tag">${NOTE_KIND_LABEL[n.kind]}</span><h3 style="font-size:16px;font-weight:700">${n.title}</h3></div>
        <div class="txt md">${markdown(n.body)}</div></div>`)}</div></section>` : ''}`;
  }

  function draw() {
    const m = res.modules.find((x) => x.code === current);
    const deducted = m ? m.items.filter((i) => i.deducted).length : 0;
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
          <section class="panel" aria-labelledby="sum-title"><h2 id="sum-title" class="panel-h">점수 요약</h2>
            <dl style="margin:0;display:grid;grid-template-columns:minmax(0,1fr) auto;font-variant-numeric:tabular-nums">
              <dt class="td" style="color:var(--ink2)">주관</dt><dd class="td r" style="margin:0"><b>${fmt(m.scores.subjective)}</b> / ${m.scores.maxSubjective}</dd>
              <dt class="td" style="color:var(--ink2)">객관</dt><dd class="td r" style="margin:0"><b>${fmt(m.scores.objective)}</b> / ${m.scores.maxObjective}</dd>
              <dt class="td" style="color:var(--ink2)">감점</dt><dd class="td r" style="margin:0;padding:8px 14px"><span class="pen">−${fmt(m.scores.deduction)}</span></dd>
              <dt class="td" style="color:var(--ink2);border-bottom:0">감점된 항목</dt><dd class="td r" style="margin:0;border-bottom:0">${deducted}개</dd>
            </dl></section>
          ${m.screenshots.length ? html`<section id="captures" class="panel" aria-labelledby="cap-title"><div class="panel-h"><h2 id="cap-title" style="font-size:15px">캡처</h2><span class="small" style="color:var(--ink2);font-weight:400">${m.screenshots.length}장</span></div>
            <div class="shots">${m.screenshots.slice(0, 9).map((s, k) => html`<button class="shot" type="button" data-shot="${k}" aria-haspopup="dialog"><div class="shot-box">${imgUrl(m, s.file) ? html`<img src="${imgUrl(m, s.file)}" alt="${s.caption ?? s.file}" loading="lazy">` : ''}</div><span class="shot-name">${s.file}</span></button>`)}</div>
            ${m.screenshots.length > 9 ? html`<div style="padding:0 18px 18px"><button type="button" class="btn line block" data-shot="0">캡처 ${m.screenshots.length}장 모두 보기</button></div>` : ''}
          </section>` : ''}
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
    if (!m) return;
    const list = (names: string[]): LightboxItem[] => names.map((n) => ({ name: n, url: imgUrl(m, n) }));
    root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => {
      const it = m.items.find((x) => x.id === b.dataset.open)!;
      openLightbox(list(it.comment?.evidence ?? []), Number(b.dataset.i), `${it.id} ${it.title}의 근거`);
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach((b) => b.addEventListener('click', () =>
      openLightbox(list(m.screenshots.map((s) => s.file)), Number(b.dataset.shot), `캡처 ${m.screenshots.length}장`)));
    root.querySelectorAll<HTMLButtonElement>('[data-note-img]').forEach((b) => b.addEventListener('click', () => {
      const note = m.notes.find((n) => (n.images ?? []).includes(b.dataset.file!));
      const names = note?.images ?? [b.dataset.file!];
      openLightbox(list(names), Math.max(0, names.indexOf(b.dataset.file!)), note?.title ?? '이미지');
    }));
  }

  draw();
}
