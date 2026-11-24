// 사이트용 GitHub App으로 org 저장소를 다룬다. 필요한 비밀 값: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID
import { HttpError } from './http.ts';

const API = 'https://api.github.com';

function derLen(n: number): number[] {
  if (n < 128) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 255);
  return [0x80 | bytes.length, ...bytes];
}

/** GitHub가 주는 PKCS#1 개인키를 WebCrypto가 읽는 PKCS#8로 감싼다. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(pkcs1.length)];
  const inner = [0x02, 0x01, 0x00, ...algo, ...octet];
  const total = inner.length + pkcs1.length;
  return new Uint8Array([0x30, ...derLen(total), ...inner, ...pkcs1]);
}

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function appJwt(): Promise<string> {
  const id = Deno.env.get('GITHUB_APP_ID');
  const pem = (Deno.env.get('GITHUB_APP_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n');
  if (!id || !pem) throw new HttpError(503, 'GitHub App 설정이 아직 없습니다. docs/SETUP.md를 확인해 주세요.');
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', isPkcs1 ? pkcs1ToPkcs8(der) : der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: id }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${payload}`));
  return `${head}.${payload}.${b64url(sig)}`;
}

export interface GhResponse<T = any> { status: number; data: T }

export class GitHub {
  constructor(private token: string) {}

  async req<T = any>(method: string, path: string, body?: unknown): Promise<GhResponse<T>> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'grading-region',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data: data as T };
  }

  /** 폴더 안에서 deadline 이전(없으면 가장 최근)의 마지막 커밋. 저장소가 비었거나 폴더에 커밋이 없으면 null. */
  async lastCommit(org: string, repo: string, folder: string, until?: string): Promise<{ sha: string; at: string } | null> {
    const q = `path=${encodeURIComponent(folder)}&per_page=1${until ? `&until=${encodeURIComponent(until)}` : ''}`;
    const r = await this.req<{ sha: string; commit: { committer: { date: string } } }[]>('GET', `/repos/${org}/${repo}/commits?${q}`);
    if (r.status === 404 || r.status === 409) return null;
    if (r.status !== 200) throw new HttpError(502, `GitHub 응답 오류(${r.status})`);
    const c = r.data?.[0];
    return c ? { sha: c.sha, at: c.commit.committer.date } : null;
  }
}

export async function github(): Promise<GitHub> {
  const inst = Deno.env.get('GITHUB_APP_INSTALLATION_ID');
  if (!inst) throw new HttpError(503, 'GitHub App 설정이 아직 없습니다. docs/SETUP.md를 확인해 주세요.');
  const jwt = await appJwt();
  const res = await fetch(`${API}/app/installations/${inst}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': 'grading-region' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new HttpError(502, 'GitHub App 인증에 실패했습니다. 설치 번호와 개인키를 확인해 주세요.');
  return new GitHub(data.token);
}
