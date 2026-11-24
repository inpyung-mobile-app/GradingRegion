// 한 모듈의 결과를 그리는 부분. 참가자 화면과 관리자 미리보기가 같은 코드를 쓴다.
import { fmt, html, raw, type Safe } from '../lib/html.ts';
import { markdown } from '../lib/markdown.ts';
import { openLightbox, type LightboxItem } from '../lightbox.ts';
import { NOTE_KIND_LABEL, type ModuleView, type ViewItem } from '../../shared/view.ts';

export interface ShownModule extends ModuleView {
  images: Record<string, string>;
}

const CIRCLE = html`<svg role="img" aria-label="만점" width="28" height="28" viewBox="0 0 28 28"><path d="M15 4 C22 4 25 10 24 15 C23 21 17 24 12 23 C6 22 3 17 4 12 C5 7 9 4 16 5" fill="none" stroke="#C62F28" stroke-width="2" stroke-linecap="round"></path></svg>`;
const IMG_ICON = html`<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 16l5-5 4 4 3-3 6 6"></path></svg>`;

function itemRow(it: ViewItem): Safe {
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

export function sheet(m: ShownModule): Safe {
  const group = (type: 'subjective' | 'objective', label: string, got: number, max: number) => {
    const rows = m.items.filter((i) => i.type === type);
    if (!rows.length) return '';
    return html`<tr><td class="grp" colspan="4" ${raw(type === 'objective' ? 'style="border-top:1px solid var(--line)"' : '')}>${label}</td><td class="grp r" style="font-variant-numeric:tabular-nums;${type === 'objective' ? 'border-top:1px solid var(--line)' : ''}">${fmt(got)} / ${max}</td></tr>${rows.map(itemRow)}`;
  };
  return html`<table><thead><tr>
    <th class="th" scope="col" style="width:64px">번호</th><th class="th" scope="col">항목</th>
    <th class="th r" scope="col" style="width:72px">배점</th><th class="th r" scope="col" style="width:72px">득점</th><th class="th r" scope="col" style="width:96px">채점</th>
  </tr></thead><tbody>${group('subjective', '주관 항목', m.scores.subjective, m.scores.maxSubjective)}${group('objective', '객관 항목', m.scores.objective, m.scores.maxObjective)}</tbody></table>`;
}

function imgFig(m: ShownModule, f: string, k: number): Safe {
  const url = m.images[f];
  return html`<figure><button type="button" class="shot" data-note-img="${k}" data-file="${f}" aria-haspopup="dialog" style="width:150px"><div class="shot-box">${url ? html`<img src="${url}" alt="${f}" loading="lazy">` : ''}</div><span class="shot-name">${f}</span></button></figure>`;
}

export function notes(m: ShownModule): Safe {
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

/** 점수 요약과 캡처 목록(오른쪽 칸) */
export function side(m: ShownModule): Safe {
  const deducted = m.items.filter((i) => i.deducted).length;
  return html`
    <section class="panel" aria-labelledby="sum-title"><h2 id="sum-title" class="panel-h">점수 요약</h2>
      <dl style="margin:0;display:grid;grid-template-columns:minmax(0,1fr) auto;font-variant-numeric:tabular-nums">
        <dt class="td" style="color:var(--ink2)">주관</dt><dd class="td r" style="margin:0"><b>${fmt(m.scores.subjective)}</b> / ${m.scores.maxSubjective}</dd>
        <dt class="td" style="color:var(--ink2)">객관</dt><dd class="td r" style="margin:0"><b>${fmt(m.scores.objective)}</b> / ${m.scores.maxObjective}</dd>
        <dt class="td" style="color:var(--ink2)">감점</dt><dd class="td r" style="margin:0;padding:8px 14px"><span class="pen">−${fmt(m.scores.deduction)}</span></dd>
        <dt class="td" style="color:var(--ink2);border-bottom:0">감점된 항목</dt><dd class="td r" style="margin:0;border-bottom:0">${deducted}개</dd>
      </dl></section>
    ${m.screenshots.length ? html`<section id="captures" class="panel" aria-labelledby="cap-title"><div class="panel-h"><h2 id="cap-title" style="font-size:15px">캡처</h2><span class="small" style="color:var(--ink2);font-weight:400">${m.screenshots.length}장</span></div>
      <div class="shots">${m.screenshots.slice(0, 9).map((s, k) => html`<button class="shot" type="button" data-shot="${k}" aria-haspopup="dialog"><div class="shot-box">${m.images[s.file] ? html`<img src="${m.images[s.file]}" alt="${s.caption ?? s.file}" loading="lazy">` : ''}</div><span class="shot-name">${s.file}</span></button>`)}</div>
      ${m.screenshots.length > 9 ? html`<div style="padding:0 18px 18px"><button type="button" class="btn line block" data-shot="0">캡처 ${m.screenshots.length}장 모두 보기</button></div>` : ''}
    </section>` : ''}`;
}

/** sheet/notes/side를 그린 영역 안의 이미지 버튼들을 팝업에 연결한다. */
export function bindModule(root: ParentNode, m: ShownModule) {
  const list = (names: string[]): LightboxItem[] => names.map((n) => ({ name: n, url: m.images[n] }));
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
