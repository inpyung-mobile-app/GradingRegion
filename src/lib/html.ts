// 이스케이프가 기본인 HTML 템플릿. 값은 모두 이스케이프되고, raw()로 감싼 것만 그대로 들어간다.
export class Safe {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const raw = (s: string) => new Safe(s);

function part(v: unknown): string {
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false || v === true) return '';
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...vals: unknown[]): Safe {
  let out = strings[0] ?? '';
  vals.forEach((v, i) => {
    out += part(v) + (strings[i + 1] ?? '');
  });
  return new Safe(out);
}

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function $$<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel)];
}

/** 숫자를 소수 둘째 자리까지 보여 준다. */
export function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return n.toFixed(digits);
}

const kst = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
export function fmtKst(iso: string | null | undefined): string {
  if (!iso) return '-';
  return kst.format(new Date(iso));
}
const kstDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
export function fmtKstDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return kstDate.format(new Date(iso.length === 10 ? `${iso}T00:00:00+09:00` : iso));
}

/** datetime-local 입력값(KST로 해석)을 ISO 문자열로 */
export function kstInputToIso(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00+09:00`).toISOString();
}
/** ISO 문자열을 KST 기준 datetime-local 입력값으로 */
export function isoToKstInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
