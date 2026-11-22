/* 관리자 화면 (로컬 전용) */
(function () {
  'use strict';
  const root = document.getElementById('root');
  const logoutBtn = document.getElementById('logout');
  const ALLOWED = /\.(html|png|jpe?g|gif|webp|svg|ico|css|js|json|ttf|otf|woff2?|txt|md)$/i;
  const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
    return e;
  }
  async function api(url, opt = {}) {
    const r = await fetch(url, { credentials: 'same-origin', ...opt });
    let j = null;
    try { j = await r.json(); } catch { /* 본문 없음 */ }
    if (!r.ok) throw Object.assign(new Error((j && j.error) || r.statusText), { status: r.status, data: j });
    return j;
  }
  const fmt = (n) => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1));
  const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.ceil(b / 1024) + 'KB');

  /* ---------- 로그인 ---------- */
  function viewLogin(err) {
    logoutBtn.hidden = true;
    const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', autofocus: true });
    const msg = h('p', { class: 'msg err', role: 'alert' }, err || '');
    const form = h('form', { class: 'card sec', style: 'margin-top:40px', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
        viewMain();
      } catch (er) { msg.textContent = er.message; pw.select(); }
    } },
      h('h2', null, '관리자 로그인'),
      h('p', { class: 'desc' }, '처음 실행하면 비밀번호가 터미널에 표시되고 admin.config.json 에 저장돼요.'),
      h('div', { class: 'field' }, h('label', { for: 'pw' }, '비밀번호'), pw),
      msg,
      h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn', type: 'submit' }, '로그인')));
    root.replaceChildren(form);
    pw.focus();
  }
  logoutBtn.addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* 무시 */ } viewLogin(); });

  /* ---------- 메인 ---------- */
  let picked = null; // { files:[{file,rel}], total, review }

  async function viewMain() {
    logoutBtn.hidden = false;
    let data;
    try { data = await api('/api/reviews'); } catch (e) { if (e.status === 401) return viewLogin(); throw e; }
    picked = null;
    root.replaceChildren(addSection(data.items), listSection(data.items), publishSection());
  }

  /* 채점지 추가 */
  function addSection(existing) {
    const picker = h('input', { type: 'file', webkitdirectory: true, directory: true, multiple: true, hidden: true });
    const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': '탐색기에서 채점 폴더 선택' },
      h('b', null, '탐색기 열기'), h('span', null, '채점 폴더(review)를 선택하거나 여기로 끌어다 놓으세요'));
    const detail = h('div');
    const open = () => picker.click();
    drop.addEventListener('click', open);
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    picker.addEventListener('change', () => {
      const list = [...picker.files].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name }));
      onPicked(list);
      picker.value = '';
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      const list = [];
      for (const en of entries) await walk(en, '', list);
      onPicked(list);
    });

    async function walk(entry, prefix, out) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push({ file, rel: prefix + entry.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const c of batch) await walk(c, prefix + entry.name + '/', out);
        } while (batch.length);
      }
    }

    async function onPicked(list) {
      list = list.filter((x) => !SKIP.test(x.rel));
      // review.html 이 가장 얕은 위치에 있는 폴더를 채점지 루트로 본다
      const cands = list.filter((x) => /(^|\/)review\.html$/i.test(x.rel)).sort((a, b) => a.rel.split('/').length - b.rel.split('/').length);
      if (!cands.length) {
        picked = null;
        detail.replaceChildren(h('div', { class: 'found' }, h('span', { class: 'bad' }, '선택한 폴더에서 review.html 을 찾지 못했어요.'), h('span', null, '채점 폴더(review.html, screenshot/, prototype/ 이 들어 있는 폴더)를 선택해 주세요.')));
        return;
      }
      const base = cands[0].rel.replace(/review\.html$/i, '');
      const files = list.filter((x) => x.rel.startsWith(base)).map((x) => ({ file: x.file, rel: x.rel.slice(base.length) }));
      const usable = files.filter((x) => ALLOWED.test(x.rel));
      const skipped = files.length - usable.length;
      const total = usable.reduce((s, x) => s + x.file.size, 0);
      const html = await usable.find((x) => x.rel.toLowerCase() === 'review.html').file.text();
      const nums = [...html.matchAll(/data-count="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
      const target = (html.match(/대상:\s*<code>([^<]+)<\/code>/) || [])[1];
      picked = { files: usable };

      const nameIn = h('input', { id: 'nm', maxlength: '30', placeholder: '예: 이영재', autocomplete: 'off' });
      const msg = h('p', { class: 'msg', role: 'status' });
      const bar = h('i'); const prog = h('div', { class: 'prog', hidden: true }, bar);
      const go = h('button', { class: 'btn', type: 'submit' }, '채점지 추가');
      const form = h('form', { onsubmit: (ev) => { ev.preventDefault(); submit(); } },
        h('div', { class: 'field' }, h('label', { for: 'nm' }, '채점지 이름 (참가자 이름)'), nameIn),
        h('div', { style: 'margin-top:16px;display:flex;gap:10px;flex-wrap:wrap' }, go, h('button', { class: 'btn sub', type: 'button', onclick: () => { picked = null; detail.replaceChildren(); } }, '취소')),
        prog, msg);
      detail.replaceChildren(
        h('div', { class: 'found' },
          h('span', { class: 'ok' }, 'review.html 확인됨'),
          h('span', null, `파일 ${usable.length}개 · ${size(total)}${skipped ? ` · 제외된 파일 ${skipped}개(허용하지 않는 형식)` : ''}`),
          h('span', null, nums.length >= 3 ? `인식한 점수  총점 ${fmt(nums[0])} · 주관 ${fmt(nums[1])} · 객관 ${fmt(nums[2])}${target ? ' · ' + target : ''}` : '점수를 자동으로 읽지 못했어요 (목록에 — 로 표시돼요).')),
        form);
      nameIn.focus();

      async function submit(replace = false) {
        const name = nameIn.value.trim();
        if (!name) { msg.className = 'msg err'; msg.textContent = '이름을 입력해 주세요.'; nameIn.focus(); return; }
        const dup = existing.find((x) => x.name.normalize('NFC').replace(/\s+/g, '') === name.normalize('NFC').replace(/\s+/g, ''));
        if (dup && !replace && !confirm(`'${dup.name}' 은(는) 이미 등록돼 있어요. 새 채점지로 바꿀까요?`)) return;
        go.disabled = true; prog.hidden = false; msg.className = 'msg'; msg.textContent = '업로드 중…';
        let uploadId = null;
        try {
          ({ uploadId } = await api('/api/upload/begin', { method: 'POST' }));
          let done = 0;
          for (const { file, rel } of picked.files) {
            await api(`/api/upload/${uploadId}/file?path=${encodeURIComponent(rel)}`, { method: 'POST', body: file });
            done += 1; bar.style.width = (done / picked.files.length * 100).toFixed(1) + '%';
            msg.textContent = `업로드 중… ${done} / ${picked.files.length}`;
          }
          const r = await api(`/api/upload/${uploadId}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, replace: Boolean(dup) }) });
          msg.className = 'msg okm';
          msg.textContent = r.replaced ? `'${name}' 채점지를 바꿨어요.` : `'${name}' 채점지를 추가했어요.`;
          if (r.missingCount) {
            msg.textContent += `\n다만 review.html 이 가리키는 파일 ${r.missingCount}개가 폴더에 없어요 (이미지가 깨질 수 있어요): ${r.missing.join(', ')}`;
            msg.style.whiteSpace = 'pre-line';
          }
          setTimeout(viewMain, r.missingCount ? 6000 : 700);
        } catch (er) {
          if (uploadId) api(`/api/upload/${uploadId}`, { method: 'DELETE' }).catch(() => {});
          if (er.status === 401) return viewLogin('로그인이 만료됐어요.');
          msg.className = 'msg err'; msg.style.whiteSpace = 'pre-line'; msg.textContent = er.message; go.disabled = false; prog.hidden = true; bar.style.width = '0';
        }
      }
    }

    return h('section', { class: 'card sec' },
      h('h2', null, '채점지 추가'),
      h('p', { class: 'desc' }, '폴더를 올리고 이름을 입력하면 서버 폴더(docs/reviews)에 저장되고 목록에 반영돼요.'),
      picker, drop, detail);
  }

  /* 등록된 채점지 */
  function listSection(items) {
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return h('section', { class: 'card sec' },
      h('h2', null, `등록된 채점지 (${items.length})`),
      sorted.length ? h('div', { class: 'rows' }, sorted.map((it) =>
        h('div', { class: 'rrow' },
          h('div', { class: 'who' }, h('b', null, it.name), h('small', null, [it.target, it.addedAt ? new Date(it.addedAt).toLocaleString('ko-KR') : null].filter(Boolean).join(' · '))),
          h('span', { class: 'sc num' }, `${fmt(it.total)}점`),
          h('a', { class: 'view', href: `/site/#/${it.id}`, target: '_blank', rel: 'noopener' }, '보기 ↗'),
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!confirm(`'${it.name}' 채점지를 삭제할까요? 서버 폴더의 파일도 함께 지워져요.`)) return;
            try { await api(`/api/reviews/${it.id}`, { method: 'DELETE' }); viewMain(); } catch (e) { alert(e.message); }
          } }, '삭제'))))
        : h('p', { class: 'desc', style: 'margin:0' }, '아직 없어요. 위에서 채점 폴더를 추가해 보세요.'));
  }

  /* 배포 */
  function publishSection() {
    const log = h('pre', { class: 'log', hidden: true });
    const btn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!confirm('지금 상태를 GitHub 에 올릴까요? 올리면 공개 사이트에 반영돼요.')) return;
      btn.disabled = true; btn.textContent = '배포 중…'; log.hidden = true;
      try {
        const r = await api('/api/publish', { method: 'POST' });
        log.textContent = r.log; log.hidden = false;
      } catch (e) {
        log.textContent = e.message; log.hidden = false;
      } finally { btn.disabled = false; btn.textContent = 'GitHub에 배포 (git push)'; }
    } }, 'GitHub에 배포 (git push)');
    return h('section', { class: 'card sec' },
      h('h2', null, '배포'),
      h('p', { class: 'desc' }, 'docs 폴더의 변경을 commit 하고 push 해요. GitHub Pages 가 1~2분 안에 반영해요.'),
      btn, log);
  }

  (async () => {
    try { await api('/api/me'); viewMain(); } catch { viewLogin(); }
  })();
})();
