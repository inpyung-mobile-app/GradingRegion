import { html, raw, type Safe } from './lib/html.ts';

export type PublicTab = 'board' | 'me' | 'submit' | 'none';

/** 참가자 화면 공통 머리글. slug가 있으면 메뉴가 그 대회로 이어진다. */
export function publicShell(slug: string | null, active: PublicTab, body: Safe): Safe {
  const base = slug ? `/c/${encodeURIComponent(slug)}` : '';
  return html`
    <header class="top">
      <div class="top-in">
        <a class="brand" href="${base || '/'}"><b>모바일앱개발 기능반</b><span>채점 결과</span></a>
        <nav class="nav" aria-label="주 메뉴">
          <a href="${base || '/'}" ${raw(active === 'board' ? 'aria-current="page"' : '')}>순위표</a>
          <a href="${base}#lookup" id="nav-lookup" ${raw(active === 'me' ? 'aria-current="page"' : '')}>내 결과 보기</a>
          ${slug ? html`<a href="${base}/submit" ${raw(active === 'submit' ? 'aria-current="page"' : '')}>과제 제출</a>` : ''}
        </nav>
        <div class="top-side"><a href="/admin" data-admin-link>관리자 로그인</a></div>
      </div>
    </header>
    ${body}
  `;
}

export function showToast(msg: string, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
