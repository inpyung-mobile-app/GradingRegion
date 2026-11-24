// 캡처 이미지 팝업. 확정한 동작: 줌 인/아웃으로 열고 닫기, 이미지 넘김은 페이드 없는 0.4초 슬라이드, 처음과 끝에서 버튼 비활성.
import { esc } from './lib/html.ts';

export interface LightboxItem { name: string; url?: string }

const SLIDE = 340;

export function openLightbox(items: LightboxItem[], start: number, context: string) {
  if (!items.length) return;
  let i = Math.max(0, Math.min(items.length - 1, start));
  let tick = 0;
  let closing = false;
  const opener = document.activeElement as HTMLElement | null;

  const ov = document.createElement('div');
  ov.className = 'lb-ov';
  ov.innerHTML = `
    <div class="lb-box" role="dialog" aria-modal="true" aria-labelledby="lb-title">
      <div style="display:flex;align-items:center;gap:16px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--head)">
        <div style="display:flex;flex-direction:column;gap:2px;flex-grow:1;min-width:0">
          <h2 id="lb-title" style="font-size:16px;font-weight:700;word-break:break-all"></h2>
          <svg class="lb-pen" aria-hidden="true" width="140" height="8" viewBox="0 0 140 8" style="display:block;margin:1px 0 3px"><path d="M2 5 C24 2 48 6 72 4 S118 2 138 5" fill="none" stroke="#C62F28" stroke-width="2" stroke-linecap="round"></path></svg>
          <span class="small" style="color:var(--ink2)">${esc(context)}</span>
        </div>
        <button type="button" class="lb-btn" data-close aria-label="닫기" style="width:40px;padding:0"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:20px;padding:28px;background:var(--bg);min-height:0">
        ${items.length > 1 ? `<button type="button" class="lb-btn" data-prev aria-label="이전 이미지" style="width:44px;height:44px;padding:0"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"></path></svg></button>` : ''}
        <div class="lb-view"><div class="lb-track">${items
          .map((it) => `<div class="lb-slide">${it.url ? `<img src="${esc(it.url)}" alt="${esc(it.name)}" loading="lazy">` : `<div class="ph" role="img" aria-label="${esc(it.name)} 이미지 없음"></div>`}</div>`)
          .join('')}</div></div>
        ${items.length > 1 ? `<button type="button" class="lb-btn" data-next aria-label="다음 이미지" style="width:44px;height:44px;padding:0"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"></path></svg></button>` : ''}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-top:1px solid var(--line);font-size:14px">
        <span data-pos style="color:var(--ink2);font-variant-numeric:tabular-nums"></span>
        <a data-orig target="_blank" rel="noopener noreferrer" style="font-size:14px">원본 크기로 새 탭에서 열기</a>
      </div>
    </div>`;
  const q = <T extends HTMLElement>(s: string) => ov.querySelector<T>(s);
  const track = q('.lb-track')!;
  const title = q('#lb-title')!;
  const pen = q('.lb-pen')!;
  const pos = q('[data-pos]')!;
  const orig = q<HTMLAnchorElement>('[data-orig]')!;
  const prev = q<HTMLButtonElement>('[data-prev]');
  const next = q<HTMLButtonElement>('[data-next]');

  function paint(first = false) {
    track.style.transform = `translateX(${-SLIDE * i}px)`;
    title.textContent = items[i]!.name;
    pos.textContent = `${i + 1} / ${items.length}`;
    const url = items[i]!.url;
    if (url) { orig.href = url; orig.style.visibility = 'visible'; } else { orig.removeAttribute('href'); orig.style.visibility = 'hidden'; }
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === items.length - 1;
    // 제목 밑 빨간 펜 밑줄: 넘길 때마다 다시 그어진다(A/B 번갈아 애니메이션을 다시 시작)
    pen.setAttribute('class', `lb-pen ${first ? 'lb-pen-a' : tick % 2 ? 'lb-pen-a' : 'lb-pen-b'}`);
    ov.querySelectorAll('.lb-slide').forEach((s, k) => s.setAttribute('aria-hidden', String(k !== i)));
  }
  function go(d: number) {
    const to = i + d;
    if (to < 0 || to >= items.length) return;
    i = to; tick++; paint();
  }
  function close() {
    if (closing) return;
    closing = true;
    document.removeEventListener('keydown', onKey);
    ov.classList.add('lb-out');
    setTimeout(() => { ov.remove(); opener?.focus?.(); }, 180);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'Tab') {
      const f = [...ov.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
      if (!f.length) return;
      const idx = f.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      f[(idx + (e.shiftKey ? -1 : 1) + f.length) % f.length]!.focus();
    }
  }
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  q('[data-close]')!.addEventListener('click', close);
  prev?.addEventListener('click', () => go(-1));
  next?.addEventListener('click', () => go(1));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  paint(true);
  q<HTMLButtonElement>('[data-close]')!.focus();
}
