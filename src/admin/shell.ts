import { html, raw, type Safe } from '../lib/html.ts';
import { admin, signOut } from './auth.ts';
import { $ } from '../lib/html.ts';
import { supabase } from '../lib/supabase.ts';

export type AdminTab = 'contests' | 'students' | 'requests' | 'team' | 'none';

const LABEL: Record<string, string> = { owner: 'owner', editor: 'editor' };

/** 관리자 화면 공통 틀. contest가 있으면 그 대회의 하위 메뉴가 왼쪽에 나온다. */
export function adminShell(active: AdminTab, body: Safe, opts: { contest?: { id: string; name: string }; sub?: string } = {}): Safe {
  const a = admin();
  const c = opts.contest;
  const sub = (key: string, label: string) =>
    html`<a href="/admin/c/${c!.id}${key ? `/${key}` : ''}" ${raw((opts.sub ?? '') === key ? 'aria-current="page"' : '')}>${label}</a>`;
  return html`
    <header class="top"><div class="top-in">
      <a class="brand" href="/admin"><b>모바일앱개발 기능반</b><span>관리자</span></a>
      <div class="grow"></div>
      <div class="top-side"><span class="small">${a.email} <span class="tag">${LABEL[a.role]}</span></span>
        <a href="/" >참가자 화면</a><button type="button" class="btn line sm" id="sign-out">로그아웃</button></div>
    </div></header>
    <div class="adm-shell">
      <nav class="adm-side" aria-label="관리자 메뉴">
        <a href="/admin" ${raw(active === 'contests' && !c ? 'aria-current="page"' : '')}>대회</a>
        <a href="/admin/students" ${raw(active === 'students' ? 'aria-current="page"' : '')}>학생 명단</a>
        <a href="/admin/requests" ${raw(active === 'requests' ? 'aria-current="page"' : '')}>코드 분실 요청<span id="req-badge"></span></a>
        ${a.role === 'owner' ? html`<a href="/admin/team" ${raw(active === 'team' ? 'aria-current="page"' : '')}>관리자 목록</a>` : ''}
        ${c ? html`<h3>${c.name}</h3>${sub('', '대회 설정')}${sub('rubrics', '모듈과 채점 기준표')}${sub('people', '참가자와 확인 코드')}${sub('submissions', '제출 현황')}${sub('results', '결과 올리기')}` : ''}
      </nav>
      <main class="adm-main">${body}</main>
    </div>`;
}

/** 쉘을 그린 뒤 로그아웃 버튼과 분실 요청 배지를 연결한다. */
export async function bindShell(root: HTMLElement) {
  $('#sign-out', root)?.addEventListener('click', () => void signOut());
  const { count } = await supabase.from('code_requests').select('id', { count: 'exact', head: true }).eq('handled', false);
  const badge = $('#req-badge', root);
  if (badge && count) badge.innerHTML = ` <span class="tag red">${count}</span>`;
}

export function errorBox(msg: string): Safe {
  return html`<p class="err" role="alert">${msg}</p>`;
}
