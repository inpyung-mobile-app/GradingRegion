/* 채점 결과 조회 — 순수 VanillaJS (빌드 없음, GitHub Pages 정적 배포용) */
(function () {
  'use strict';

  const MAX = { subjective: 7, objective: 28, total: 35 };
  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  const updatedEl = document.getElementById('updated');

  let items = [];
  let rankOf = new Map();
  let q = new URLSearchParams(location.search).get('q') || '';
  let sort = 'score'; // 'score' | 'name'
  let homeScroll = 0;

  /* ---------- 유틸 ---------- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }
  const svg = (d, size = 20) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = d;
    return s;
  };
  const ICON = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const fmt = (n) => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1));
  const pct = (n, max) => (n == null ? 0 : Math.max(0, Math.min(100, (n / max) * 100)));

  /* ---------- 이름 검색 (부분 일치 + 초성) ---------- */
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const cho = (s) => [...s].map((c) => {
    const n = c.charCodeAt(0) - 0xAC00;
    return n >= 0 && n < 11172 ? CHO[Math.floor(n / 588)] : c;
  }).join('');
  const norm = (s) => String(s).normalize('NFC').toLowerCase();
  const queryOf = (s) => norm(s).replace(/\s+/g, '');

  /** 일치하면 [시작, 길이], 아니면 null */
  function matchName(name, query) {
    const nq = queryOf(query);
    if (!nq) return null;
    // 이름 속 공백("김 민수")은 무시하고 비교하되, 강조 표시는 원래 위치로 되돌린다
    const nn = norm(name);
    let s = '';
    const pos = [];
    for (let k = 0; k < nn.length; k++) {
      if (/\s/.test(nn[k])) continue;
      s += nn[k]; pos.push(k);
    }
    let i = s.indexOf(nq);
    if (i < 0 && /^[ㄱ-ㅎ]+$/.test(nq)) i = cho(s).indexOf(nq);
    if (i < 0) return null;
    return [pos[i], pos[i + nq.length - 1] - pos[i] + 1];
  }
  function highlight(name, m) {
    if (!m) return name;
    return [name.slice(0, m[0]), h('mark', null, name.slice(m[0], m[0] + m[1])), name.slice(m[0] + m[1])];
  }

  /* ---------- 데이터 ---------- */
  let rankedCount = 0; // 점수가 있는 응시자 수 (순위는 점수가 있는 사람만 매긴다)
  function computeRanks() {
    const scored = items.filter((x) => x.total != null).sort((a, b) => b.total - a.total);
    rankOf = new Map();
    rankedCount = scored.length;
    let prev = null; let rank = 0;
    scored.forEach((it, i) => {
      if (it.total !== prev) { rank = i + 1; prev = it.total; }
      rankOf.set(it.id, rank);
    });
  }
  function sortedItems() {
    const list = [...items];
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    else list.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.name.localeCompare(b.name, 'ko'));
    return list;
  }
  async function load() {
    app.replaceChildren(
      h('div', { class: 'hero' }, h('div', { class: 'skeleton', style: 'height:44px;width:70%;margin-top:30px' }), h('div', { class: 'skeleton', style: 'height:60px;margin-top:24px;border-radius:99px' })),
      h('div', { class: 'skeleton', style: 'height:260px;margin-top:40px' }),
    );
    try {
      const r = await fetch('data/index.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      items = Array.isArray(j.items) ? j.items : [];
      if (j.updatedAt) {
        const d = new Date(j.updatedAt);
        updatedEl.textContent = '업데이트 ' + d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
      }
      computeRanks();
      route();
    } catch (e) {
      app.replaceChildren(h('div', { class: 'card empty rise', style: 'margin-top:40px' },
        h('b', null, '결과를 불러오지 못했어요'),
        '잠시 후 다시 시도해 주세요.',
        h('div', { style: 'margin-top:16px' }, h('button', { class: 'open-raw', onclick: load }, '다시 불러오기'))));
    }
  }

  /* ---------- 라우팅: #/  또는  #/<id> ---------- */
  function route() {
    const m = /^#\/([a-f0-9]{12})$/.exec(location.hash);
    if (m) viewDetail(m[1]); else viewHome();
  }
  addEventListener('hashchange', route);
  addEventListener('scroll', () => topbar.classList.toggle('scrolled', scrollY > 4), { passive: true });
  addEventListener('keydown', (e) => {
    const input = document.getElementById('q');
    if (e.key === '/' && input && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });

  /* ---------- 홈 ---------- */
  let refs = {};
  function viewHome() {
    document.title = '채점 결과 조회 · 지방기능경기대회 모바일앱개발';
    const input = h('input', {
      id: 'q', type: 'search', value: q, placeholder: '이름을 검색해 보세요 (예: 이영재, ㅇㅇㅈ)',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': '이름 검색',
    });
    const clear = h('button', { class: 'clear' + (q ? ' on' : ''), type: 'button', 'aria-label': '검색어 지우기', onclick: () => { input.value = ''; onInput(); input.focus(); } }, svg(ICON.x, 18));
    const box = h('div', { class: 'search' + (q ? ' has-text' : '') }, svg(ICON.search, 22), input, h('kbd', null, '/'), clear);
    const result = h('div', { id: 'result' });
    const stats = h('div', { class: 'stats' });
    const tbody = h('tbody');
    const segScore = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setSort('score') }, '점수순');
    const segName = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setSort('name') }, '이름순');
    const count = h('p', null);

    refs = { input, clear, box, result, stats, tbody, segScore, segName, count };

    app.replaceChildren(
      h('section', { class: 'hero rise' },
        h('span', { class: 'eyebrow' }, '2026 지방기능경기대회 · 모바일앱개발'),
        h('h1', null, '내 채점 결과를', h('br'), '이름으로 찾아보세요'),
        h('p', { class: 'lead' }, '검색하면 내 결과를, 아래에서는 모두의 결과를 한눈에 볼 수 있어요.'),
        box,
        h('p', { class: 'hint' }, '이름 일부나 초성만 입력해도 찾을 수 있어요.'),
      ),
      result,
      stats,
      h('section', null,
        h('div', { class: 'list-head' },
          h('div', null, h('h2', null, '전체 결과'), count),
          h('div', { class: 'seg', role: 'group', 'aria-label': '정렬' }, segScore, segName)),
        h('div', { class: 'card table-card' },
          h('table', null,
            h('thead', null, h('tr', null,
              h('th', { class: 'rank' }, '순위'),
              h('th', null, '이름'),
              h('th', { class: 'r' }, '총점'),
              h('th', { class: 'r hide-sm' }, '주관'),
              h('th', { class: 'r hide-sm' }, '객관'),
              h('th', { class: 'r hide-sm' }, '감점'))),
            tbody)),
      ),
    );
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; onInput(); } });
    renderStats();
    renderTable();
    renderResult(false);
    if (homeScroll) { scrollTo(0, homeScroll); homeScroll = 0; }
  }
  let t = 0;
  function onInput() {
    q = refs.input.value;
    refs.clear.classList.toggle('on', Boolean(q));
    refs.box.classList.toggle('has-text', Boolean(q));
    renderResult(true);
    renderTable();
    clearTimeout(t);
    t = setTimeout(() => {
      const u = new URL(location.href);
      if (q.trim()) u.searchParams.set('q', q.trim()); else u.searchParams.delete('q');
      history.replaceState(null, '', u);
    }, 300);
  }
  function setSort(s) {
    sort = s;
    refs.segScore.setAttribute('aria-pressed', String(s === 'score'));
    refs.segName.setAttribute('aria-pressed', String(s === 'name'));
    renderTable();
  }

  function renderStats() {
    const totals = items.map((i) => i.total).filter((v) => v != null);
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
    const best = totals.length ? Math.max(...totals) : null;
    const cell = (label, value, unit) => h('div', { class: 'card stat' }, h('span', null, label), h('b', { class: 'num' }, value), unit ? h('small', null, unit) : null);
    refs.stats.replaceChildren(
      cell('응시자', String(items.length), '명'),
      cell('평균', fmt(avg), '점'),
      cell('최고점', fmt(best), '점'));
    refs.count.textContent = items.length ? `총 ${items.length}명 · ${MAX.total}점 만점` : '';
  }

  function meCard(it, m, animate) {
    const rank = rankOf.get(it.id);
    const row = (label, val, max) => {
      const fill = h('div', { class: 'fill', 'data-w': pct(val, max).toFixed(1) });
      return h('div', { class: 'bar-row' },
        h('span', { class: 'lbl' }, label),
        h('div', { class: 'track' }, fill),
        h('span', { class: 'val num' }, `${fmt(val)} / ${max}`));
    };
    return h('a', { class: 'card me' + (animate ? ' rise' : ''), href: '#/' + it.id, 'aria-label': `${it.name} 채점 결과 자세히 보기` },
      h('div', { class: 'me-head' },
        h('span', { class: 'me-name' }, highlight(it.name, m)),
        rank ? h('span', { class: 'me-rank num' }, `${rankedCount}명 중 ${rank}위`) : null,
        h('span', { class: 'me-go' }, '자세히', svg(ICON.right, 18))),
      h('div', { class: 'me-score num' }, h('b', null, fmt(it.total)), h('span', null, `/ ${MAX.total}점`)),
      h('div', { class: 'bars' }, row('주관', it.subjective, MAX.subjective), row('객관', it.objective, MAX.objective)));
  }
  function renderResult(animate) {
    const query = q.trim();
    const box = refs.result;
    if (!query) { box.replaceChildren(); return; }
    const hits = items.map((it) => [it, matchName(it.name, query)]).filter((x) => x[1]);
    if (!hits.length) {
      box.replaceChildren(h('div', { class: 'card empty' }, h('b', null, `'${query}'와 일치하는 이름이 없어요`), '이름을 다시 확인하거나 아래 전체 결과에서 찾아보세요.'));
      return;
    }
    const shown = hits.slice(0, 6);
    // 글자를 한 자 칠 때마다 카드가 다시 나타나는 애니메이션이 반복되지 않도록, 처음 나타날 때만 움직인다
    const first = !box.querySelector('.me');
    box.classList.toggle('one', shown.length === 1);
    box.replaceChildren(...[
      hits.length > 1 ? h('p', { class: 'found-label' }, `${hits.length}명을 찾았어요`) : null,
      ...shown.map(([it, m]) => meCard(it, m, first)),
      hits.length > shown.length ? h('p', { class: 'found-label' }, `외 ${hits.length - shown.length}명은 아래 전체 결과에서 볼 수 있어요`) : null,
    ].filter(Boolean));
    const fills = box.querySelectorAll('.fill[data-w]');
    if (!first) { fills.forEach((f) => { f.style.transition = 'none'; f.style.width = f.dataset.w + '%'; }); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fills.forEach((f) => { f.style.width = f.dataset.w + '%'; });
    }));
  }

  function renderTable() {
    const list = sortedItems();
    if (!list.length) {
      refs.tbody.replaceChildren(h('tr', null, h('td', { colspan: 6, style: 'height:auto;padding:36px 12px;text-align:center;color:var(--ink-3)' }, '아직 등록된 채점 결과가 없어요.')));
      return;
    }
    const query = q.trim();
    refs.tbody.replaceChildren(...list.map((it) => {
      const m = query ? matchName(it.name, query) : null;
      const rank = rankOf.get(it.id);
      const tr = h('tr', { class: m ? 'hit' : '', onclick: (e) => { if (!e.target.closest('a')) location.hash = '#/' + it.id; } },
        h('td', { class: 'rank num' }, rank == null ? '—' : rank === 1 ? h('span', { class: 'top1', title: '1위' }, '1') : String(rank)),
        h('td', { class: 'name' },
          h('a', { href: '#/' + it.id }, highlight(it.name, m)),
          h('small', { class: 'num' }, `주관 ${fmt(it.subjective)} · 객관 ${fmt(it.objective)}`)),
        h('td', { class: 'r total' }, h('div', { class: 'total-cell' },
          h('div', { class: 'track' }, h('div', { class: 'fill total', style: `width:${pct(it.total, MAX.total).toFixed(1)}%;transition:none` })),
          h('b', { class: 'num' }, fmt(it.total)))),
        h('td', { class: 'r sub num hide-sm' }, fmt(it.subjective)),
        h('td', { class: 'r sub num hide-sm' }, fmt(it.objective)),
        h('td', { class: 'r neg num hide-sm' }, it.deduction == null ? '—' : '−' + fmt(it.deduction)));
      return tr;
    }));
  }

  /* ---------- 이미지 확대 보기 (바깥 페이지 기준) ---------- */
  let lb = null;
  function openLightbox(src, caption) {
    if (!lb) {
      const img = h('img', { alt: '' });
      const cap = h('p', null);
      const x = h('button', { class: 'lb-x', type: 'button', 'aria-label': '닫기' }, svg(ICON.x, 22));
      lb = h('div', { class: 'lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': '이미지 확대 보기' }, x, img, cap);
      lb.img = img; lb.cap = cap; lb.x = x;
      lb.addEventListener('click', closeLightbox);
      document.body.append(lb);
      addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
    }
    lb.img.src = src; lb.cap.textContent = caption;
    lb.classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    lb.x.focus();
  }
  function closeLightbox() {
    if (!lb || !lb.classList.contains('on')) return;
    lb.classList.remove('on');
    document.documentElement.style.overflow = '';
  }
  addEventListener('hashchange', closeLightbox);

  /* ---------- 상세 ---------- */
  function viewDetail(id) {
    const it = items.find((x) => x.id === id);
    const back = h('a', { class: 'back', href: '#/' }, svg(ICON.left, 18), '전체 결과');
    if (!it) {
      document.title = '채점 결과 조회';
      app.replaceChildren(back, h('div', { class: 'card empty rise', style: 'margin-top:18px' }, h('b', null, '찾을 수 없는 결과예요'), '삭제되었거나 주소가 잘못되었어요.'));
      scrollTo(0, 0);
      return;
    }
    if (!document.getElementById('q')) { /* 이미 상세에 있음 */ } else homeScroll = scrollY;
    document.title = `${it.name} · 채점 결과`;
    const rank = rankOf.get(it.id);
    const date = it.addedAt ? new Date(it.addedAt) : null;
    const split = (label, val, max, extra) => h('div', { class: 'bar-row' },
      h('div', { class: 'row-top' }, h('span', { class: 'lbl' }, label), h('span', { class: 'val num' }, `${fmt(val)}`, h('small', null, ` / ${max}`))),
      h('div', { class: 'track' }, h('div', { class: 'fill', 'data-w': pct(val, max).toFixed(1) })));
    const frame = h('iframe', { class: 'frame', src: `reviews/${it.id}/review.html`, title: `${it.name} 상세 채점지`, loading: 'lazy' });
    frame.addEventListener('load', () => {
      try {
        const d = frame.contentDocument;
        // 프레임이 문서 높이만큼 길어지므로, 프레임 안의 fixed 요소(진행 막대·확대 보기)는 쓸 수 없다.
        // 숨기고, 이미지 확대와 목차 이동은 바깥 페이지가 대신 처리한다.
        const st = d.createElement('style');
        st.textContent = '#bar,#lb{display:none!important}nav{position:static!important}';
        d.head.appendChild(st);
        d.addEventListener('click', (e) => {
          const img = e.target.closest && e.target.closest('figure img');
          if (img) {
            e.preventDefault(); e.stopPropagation();
            openLightbox(img.currentSrc || img.src, img.alt || '');
            return;
          }
          const a = e.target.closest && e.target.closest('a[href^="#"]');
          if (a) {
            const target = d.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
            if (target) {
              e.preventDefault();
              const y = frame.getBoundingClientRect().top + target.getBoundingClientRect().top + scrollY - 76;
              scrollTo({ top: y, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            }
          }
        }, true);
        // scrollHeight 는 프레임 자기 높이보다 작아질 수 없어서, 화면 폭이 넓어져도 줄지 않는다.
        // 내용의 실제 높이(html 요소 상자)를 재야 줄어든다.
        const fit = () => { frame.style.height = Math.ceil(d.documentElement.getBoundingClientRect().height) + 'px'; };
        fit();
        new ResizeObserver(fit).observe(d.documentElement);
      } catch (e) { frame.style.height = '90vh'; }
    });
    app.replaceChildren(
      back,
      h('div', { class: 'd-head rise' },
        h('h1', null, it.name),
        h('p', null, [it.target, date ? `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} 등록` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'd-grid rise' },
        h('div', { class: 'card d-score' },
          h('div', { class: 'big num' }, h('b', null, fmt(it.total)), h('span', null, `/ ${MAX.total}점`)),
          rank ? h('span', { class: 'me-rank pill num' }, `${rankedCount}명 중 ${rank}위`) : null),
        h('div', { class: 'card d-split' },
          split('주관', it.subjective, MAX.subjective),
          split('객관', it.objective, MAX.objective))),
      h('a', { class: 'open-raw', href: `reviews/${it.id}/review.html`, target: '_blank', rel: 'noopener' }, '상세 채점지 새 탭에서 열기', svg(ICON.out, 18)),
      h('div', { class: 'card frame-card' }, frame));
    scrollTo(0, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.querySelectorAll('.fill[data-w]').forEach((f) => { f.style.width = f.dataset.w + '%'; });
    }));
  }

  load();
})();
