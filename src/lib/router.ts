export interface RouteCtx {
  root: HTMLElement;
  params: Record<string, string>;
  query: URLSearchParams;
}
export type RouteHandler = (ctx: RouteCtx) => void | Promise<void>;

interface Route {
  re: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];
let notFound: RouteHandler = ({ root }) => {
  root.textContent = '페이지를 찾을 수 없습니다.';
};
let cleanup: (() => void) | null = null;

export function route(pattern: string, handler: RouteHandler) {
  const keys: string[] = [];
  const re = new RegExp(
    '^' + pattern.replace(/\/:([a-z]+)/gi, (_m, k: string) => (keys.push(k), '/([^/]+)')).replace(/\/$/, '') + '/?$',
  );
  routes.push({ re, keys, handler });
}
export function setNotFound(h: RouteHandler) {
  notFound = h;
}
/** 페이지가 떠날 때 정리할 일(타이머, 이벤트)을 등록한다. */
export function onLeave(fn: () => void) {
  cleanup = fn;
}

export async function render() {
  const root = document.getElementById('app')!;
  cleanup?.();
  cleanup = null;
  const url = new URL(location.href);
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    await r.handler({ root, params, query: url.searchParams });
    return;
  }
  await notFound({ root, params: {}, query: url.searchParams });
}

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.scrollTo(0, 0);
  void render();
}

/** 같은 사이트 안의 링크는 새로 불러오지 않고 라우터로 이동한다. */
export function installLinkHandler() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.target || a.hasAttribute('download') || a.dataset.native !== undefined) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) return;
    e.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => void render());
}
