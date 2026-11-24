import { $, html } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { publicShell } from '../shell.ts';

export async function lostPage({ root, params }: RouteCtx) {
  const slug = params.slug!;
  const body = html`<main class="wrap" style="max-width:640px">
    <section class="panel stack" style="padding:28px;gap:18px" aria-labelledby="t">
      <a href="/c/${slug}" class="small" style="color:var(--ink2)">← 순위표로</a>
      <h1 id="t" style="font-size:24px;font-weight:700">확인 코드를 잃어버렸어요</h1>
      <p class="txt" style="margin:0;color:var(--ink2);line-height:1.7">이름을 알려 주시면 관리자에게 요청이 전달됩니다. 관리자가 본인이 맞는지 확인한 뒤 <b>새 코드</b>를 메시지로 보내 드립니다. 예전 코드는 새 코드를 받는 순간부터 쓸 수 없습니다. 같은 이름은 하루 3번까지 요청할 수 있습니다.</p>
      <form id="f" class="stack" novalidate>
        <div class="field"><label for="n">이름</label><input id="n" name="name" type="text" maxlength="40" autocomplete="name" required></div>
        <p id="msg" role="status" class="ok" hidden></p>
        <button class="btn" type="submit" style="align-self:flex-start">요청 보내기</button>
      </form>
    </section></main>`;
  root.innerHTML = publicShell(slug, 'none', body).value;
  document.title = '확인 코드 분실 요청';
  $<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = ($<HTMLInputElement>('#n')!.value ?? '').trim();
    const msg = $('#msg')!;
    if (!name) return;
    const btn = (e.target as HTMLFormElement).querySelector('button')!;
    btn.disabled = true;
    await supabase.rpc('request_code', { p_slug: slug, p_name: name });
    // 등록된 이름인지 알려 주지 않고 항상 같은 문구를 보여 준다.
    msg.textContent = '요청을 전달했습니다. 관리자가 확인한 뒤 새 코드를 메시지로 보내 드립니다.';
    msg.hidden = false;
    btn.disabled = false;
  });
}
