import { $, html } from '../lib/html.ts';
import { navigate, type RouteCtx } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { loadAdmin } from './auth.ts';

export async function loginPage({ root, query }: RouteCtx) {
  // 매직 링크로 돌아온 경우(?code=...)에는 supabase-js가 세션을 만들 때까지 잠깐 기다린다.
  if (query.get('code')) {
    root.innerHTML = '<main class="wrap"><p class="muted">로그인하는 중…</p></main>';
    await new Promise<void>((resolve) => {
      const { data } = supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN') { data.subscription.unsubscribe(); resolve(); } });
      setTimeout(() => { data.subscription.unsubscribe(); resolve(); }, 6000);
    });
  }
  if (await loadAdmin(true)) { navigate('/admin', true); return; }

  root.innerHTML = html`
    <header class="top"><div class="top-in"><a class="brand" href="/"><b>모바일앱개발 기능반</b><span>관리자</span></a></div></header>
    <main class="wrap" style="max-width:560px">
      <section class="panel stack" style="padding:32px;gap:18px" aria-labelledby="t">
        <h1 id="t" style="font-size:24px;font-weight:700">관리자 로그인</h1>
        <p class="txt" style="margin:0;color:var(--ink2);line-height:1.7">등록된 관리자 이메일로 로그인 링크를 보내 드립니다. 메일의 링크를 누르면 이 브라우저에서 바로 로그인되고, 같은 브라우저에서는 다시 로그인하지 않아도 됩니다.</p>
        ${query.get('error_code') === 'otp_expired' ? html`<p class="err" role="alert">로그인 링크가 만료되었거나 이미 한 번 사용되었습니다. 아래에서 새 링크를 받아 주세요. 메일 보안 프로그램이 링크를 먼저 열어 버리는 경우에도 이렇게 됩니다.</p>`
          : query.get('error_description') ? html`<p class="err" role="alert">${query.get('error_description')}</p>` : ''}
        <form id="f" class="stack" novalidate>
          <div class="field"><label for="email">이메일</label><input id="email" type="email" autocomplete="email" required></div>
          <p id="msg" class="small" role="status" hidden></p>
          <button class="btn" type="submit">로그인 링크 받기</button>
        </form>
        <details ${query.get('pw') !== null || query.get('error_code') ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">메일이 안 올 때: 비밀번호로 로그인</summary>
          <form id="pf" class="stack" style="margin-top:12px" novalidate>
            <div class="field"><label for="pe">이메일</label><input id="pe" type="email" autocomplete="username" required></div>
            <div class="field"><label for="pw">비밀번호</label><input id="pw" type="password" autocomplete="current-password" required></div>
            <p id="pmsg" class="err" role="alert" hidden></p>
            <button class="btn line" type="submit">비밀번호로 로그인</button>
          </form></details>
        <p class="small muted" style="margin:0">공용 컴퓨터에서는 끝난 뒤 반드시 로그아웃해 주세요.</p>
      </section></main>`.value;
  document.title = '관리자 로그인';
  $<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('#email')!.value.trim().toLowerCase();
    const msg = $('#msg')!;
    if (!email) return;
    const btn = (e.target as HTMLFormElement).querySelector('button')!;
    btn.disabled = true;
    // 새 계정은 만들지 않는다: 초대받은(이미 만들어진) 계정만 로그인된다.
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/admin/login` } });
    msg.hidden = false;
    // 등록 여부를 알려 주지 않도록 성공 문구를 같게 쓴다(요청이 너무 잦을 때만 따로 안내).
    if (error && /rate|seconds|too many/i.test(error.message)) { msg.className = 'err'; msg.textContent = '요청이 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요.'; }
    else { msg.className = 'ok'; msg.textContent = '등록된 이메일이라면 로그인 링크를 보냈습니다. 메일함을 확인해 주세요.'; }
    btn.disabled = false;
  });
  $<HTMLFormElement>('#pf')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('#pe')!.value.trim().toLowerCase();
    const password = $<HTMLInputElement>('#pw')!.value;
    const msg = $('#pmsg')!;
    if (!email || !password) return;
    const btn = (e.target as HTMLFormElement).querySelector('button')!;
    btn.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = '이메일 또는 비밀번호가 맞지 않습니다.'; msg.hidden = false; btn.disabled = false; return; }
    if (await loadAdmin(true)) navigate('/admin', true);
    else { await supabase.auth.signOut(); msg.textContent = '관리자로 등록된 계정이 아닙니다.'; msg.hidden = false; btn.disabled = false; }
  });
}
