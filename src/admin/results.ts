// 결과 올리기: 폴더(result.json + 캡처)를 끌어다 놓으면 브라우저에서 먼저 검사하고, 미리 본 뒤 올린다.
import { $, esc, fmt, fmtKst, html, type Safe } from '../lib/html.ts';
import type { RouteCtx } from '../lib/router.ts';
import { callAdmin, supabase } from '../lib/supabase.ts';
import { showToast } from '../shell.ts';
import { buildModuleView } from '../../shared/view.ts';
import type { GradingResult, Rubric, ValidationIssue } from '../../shared/types.ts';
import { formatIssue, referencedFiles, validateResult } from '../../shared/validate.ts';
import { bindModule, notes, sheet, side, type ShownModule } from '../pages/module-view.ts';
import { guard } from './auth.ts';
import { loadContest, type Contest, type Module } from './contests.ts';
import { adminShell, bindShell } from './shell.ts';

interface ResultRow { id: string; module_id: string; subjective_score: number; objective_score: number; is_public: boolean; updated_at: string; participants: { students: { name: string } | null } | null }
interface Picked { path: string; file: File }

const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i;
const MAX_IMAGE = 10 * 1024 * 1024;

/** 폴더 input에서 고른 파일: 맨 앞 폴더 이름을 떼고 상대 경로로 만든다. */
function fromInput(files: FileList): Picked[] {
  return [...files].map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/');
    return { path: parts.length > 1 ? parts.slice(1).join('/') : rel, file: f };
  });
}

/** 끌어다 놓은 폴더를 끝까지 읽는다. */
async function fromDrop(dt: DataTransfer): Promise<Picked[]> {
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, prefix + entry.name + '/');
      }
    }
  };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 1 && entries[0]!.isDirectory) {
    // 폴더 하나를 놓았으면 그 폴더 안을 뿌리로 본다.
    const reader = (entries[0] as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, '');
    }
  } else {
    for (const e of entries) await walk(e, '');
  }
  return out;
}

export async function resultsPage({ root, params }: RouteCtx) {
  if (!(await guard())) return;
  const c = await loadContest(params.id!);
  if (!c) { root.innerHTML = adminShell('contests', html`<h1>대회를 찾을 수 없습니다</h1>`).value; return; }
  await draw(root, c);
}

async function draw(root: HTMLElement, c: Contest) {
  const [{ data: mods }, { data: res }, { data: parts }, { data: usage }] = await Promise.all([
    supabase.from('modules').select('*, rubrics(id, title, version, definition)').eq('contest_id', c.id).order('code'),
    supabase.from('results').select('id, module_id, subjective_score, objective_score, is_public, updated_at, participants!inner(contest_id, students(name))').eq('participants.contest_id', c.id).order('updated_at', { ascending: false }),
    supabase.from('participants').select('id, students(name)').eq('contest_id', c.id),
    supabase.rpc('storage_usage'),
  ]);
  type ModRow = Module & { rubrics: { id: string; title: string; version: number; definition: Rubric } | null };
  const modules = (mods ?? []) as unknown as ModRow[];
  const results = (res ?? []) as unknown as ResultRow[];
  const names = ((parts ?? []) as unknown as { students: { name: string } | null }[]).map((p) => p.students?.name).filter((n): n is string => !!n);
  const mb = (b: number) => `${(b / 1048576).toFixed(1)}MB`;
  const usageText = ((usage ?? []) as { bucket: string; bytes: number; files: number }[])
    .map((u) => `${u.bucket === 'grading' ? '캡처' : '제출 zip'} ${mb(Number(u.bytes))} (${u.files}개)`).join(' · ') || '아직 없음';

  const modPanel = (m: ModRow): Safe => {
    const rows = results.filter((r) => r.module_id === m.id);
    const pub = rows.filter((r) => r.is_public).length;
    return html`<section class="panel" data-mod="${m.id}"><h2 class="panel-h"><span>Module ${m.code}${m.title ? ` · ${m.title}` : ''}</span>
      <span class="small" style="font-weight:400">${rows.length}명 채점 · ${pub}명 공개</span></h2>
      ${rows.length ? html`<div class="scroll-x"><table><thead><tr><th class="th">참가자</th><th class="th r">주관</th><th class="th r">객관</th><th class="th r">합계</th><th class="th">공개</th><th class="th">올린 때</th><th class="th"></th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td class="td">${r.participants?.students?.name ?? '(알 수 없음)'}</td>
          <td class="td r">${fmt(r.subjective_score)}</td><td class="td r">${fmt(r.objective_score)}</td><td class="td r"><b>${fmt(r.subjective_score + r.objective_score)}</b></td>
          <td class="td">${r.is_public ? html`<span class="tag green">공개</span>` : html`<span class="tag">비공개</span>`}</td>
          <td class="td small nw">${fmtKst(r.updated_at)}</td>
          <td class="td r"><button type="button" class="btn line sm danger" data-del="${r.id}" data-name="${r.participants?.students?.name ?? ''}">지우기</button></td></tr>`)}
      </tbody></table></div>
      <div class="panel-b row"><button type="button" class="btn sm" data-pub="${m.id}" data-to="true" ${pub === rows.length ? 'disabled' : ''}>이 모듈 전체 공개</button>
        <button type="button" class="btn line sm" data-pub="${m.id}" data-to="false" ${pub === 0 ? 'disabled' : ''}>이 모듈 전체 비공개로</button></div>`
        : html`<p class="panel-b muted" style="margin:0">아직 올린 결과가 없습니다.</p>`}
    </section>`;
  };

  const ready = modules.filter((m) => m.rubrics);
  const body = html`<h1>결과 올리기</h1>
    <p class="small muted" style="margin:0 0 12px">저장 공간 사용량: ${usageText}</p>
    ${modules.length ? '' : html`<p class="notice">먼저 <a href="/admin/c/${c.id}">대회 설정</a>에서 모듈을 추가하고 채점 기준표를 연결해 주세요.</p>`}
    ${ready.length ? html`<section class="panel"><h2 class="panel-h">새 결과 올리기</h2><div class="panel-b stack">
      <div class="field"><label for="mod">모듈</label><select id="mod">${ready.map((m) => html`<option value="${m.id}">Module ${m.code}${m.title ? ` · ${m.title}` : ''}</option>`)}</select></div>
      <div class="drop" id="drop" tabindex="0" role="button" aria-label="결과 폴더를 끌어다 놓거나 눌러서 고르기">
        결과 폴더(result.json과 캡처 이미지)를 여기에 끌어다 놓으세요<br><span class="small">또는 눌러서 폴더 고르기</span></div>
      <input type="file" id="pick" webkitdirectory multiple hidden>
      <div id="check"></div>
    </div></section>` : ''}
    ${modules.map(modPanel)}`;
  root.innerHTML = adminShell('contests', body, { contest: { id: c.id, name: c.name }, sub: 'results' }).value;
  document.title = '관리자 · 결과 올리기';
  void bindShell(root);

  // 올리기가 끝나면 목록을 새로 그린다.
  const redraw = () => void draw(root, c);

  root.querySelectorAll<HTMLButtonElement>('[data-pub]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const { data, error } = await supabase.rpc('set_module_public', { p_module: b.dataset.pub!, p_public: b.dataset.to === 'true' });
    if (error) { showToast('바꾸지 못했습니다.'); b.disabled = false; return; }
    showToast(`${data}명의 공개 상태를 바꿨습니다.`);
    redraw();
  }));

  root.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`${b.dataset.name}의 이 결과를 지울까요? 되돌릴 수 없습니다.`)) return;
    b.disabled = true;
    const { data: imgs } = await supabase.from('result_images').select('storage_path').eq('result_id', b.dataset.del!);
    const { error } = await supabase.from('results').delete().eq('id', b.dataset.del!);
    if (error) { showToast('지우지 못했습니다.'); b.disabled = false; return; }
    const paths = (imgs ?? []).map((i) => i.storage_path as string);
    if (paths.length) await supabase.storage.from('grading').remove(paths);
    showToast('지웠습니다.');
    redraw();
  }));

  const drop = $('#drop', root);
  const pick = $<HTMLInputElement>('#pick', root);
  if (!drop || !pick) return;
  const modSel = $<HTMLSelectElement>('#mod', root)!;
  const setFiles = (files: Picked[]) => void check(root, c, ready.find((m) => m.id === modSel.value)!, names, files, redraw);
  drop.addEventListener('click', () => pick.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer) setFiles(await fromDrop(e.dataTransfer));
  });
  pick.addEventListener('change', () => { if (pick.files?.length) setFiles(fromInput(pick.files)); pick.value = ''; });
}

/** 고른 파일을 읽어 검사하고, 문제가 없으면 미리보기와 올리기 버튼을 보여 준다. */
async function check(root: HTMLElement, c: Contest, m: Module & { rubrics: { definition: Rubric } | null }, names: string[], files: Picked[], redraw: () => void) {
  const box = $('#check', root)!;
  const rubric = m.rubrics!.definition;
  const fail = (msgs: string[]) => { box.innerHTML = html`<div class="err" role="alert"><b>올릴 수 없습니다.</b><ul>${msgs.map((x) => html`<li>${x}</li>`)}</ul></div>`.value; };

  const jsons = files.filter((f) => f.path.toLowerCase().endsWith('.json'));
  const main = jsons.find((f) => f.path.toLowerCase() === 'result.json') ?? (jsons.length === 1 ? jsons[0] : undefined);
  if (!main) return fail([jsons.length ? '결과 파일이 여러 개입니다. 이름을 result.json으로 해 주세요.' : '폴더에 result.json 파일이 없습니다.']);

  let parsed: unknown;
  try { parsed = JSON.parse(await main.file.text()); } catch { return fail(['result.json을 읽을 수 없습니다. 파일 내용이 올바른 형식인지 확인해 주세요.']); }

  const imgs = files.filter((f) => IMG_EXT.test(f.path));
  const tooBig = imgs.filter((f) => f.file.size > MAX_IMAGE);
  const have = new Set(imgs.map((f) => f.path));
  const issues: ValidationIssue[] = validateResult(parsed, { rubric, uploadedFiles: have, participantNames: names });
  const msgs = issues.map(formatIssue);
  for (const f of tooBig) msgs.push(`${f.path}: 이미지는 10MB 이하여야 합니다.`);
  if (msgs.length) return fail(msgs);

  const result = parsed as GradingResult;
  const used = referencedFiles(result);
  const byPath = new Map(imgs.map((f) => [f.path, f.file]));
  const urls: Record<string, string> = {};
  for (const f of used) urls[f] = URL.createObjectURL(byPath.get(f)!);
  const shown: ShownModule = { ...buildModuleView(rubric, result), images: urls };
  const unused = imgs.length - used.length;

  box.innerHTML = html`<div class="stack">
    <p class="notice"><b>${result.participant}</b>의 Module ${m.code} 결과입니다. 검사를 통과했습니다. 아래는 참가자에게 보일 화면입니다.${unused > 0 ? ` 쓰이지 않은 이미지 ${unused}장은 올리지 않습니다.` : ''}</p>
    <div class="cols"><div class="col-main"><section class="sec"><h2>채점표</h2><div class="panel scroll-x">${sheet(shown)}</div></section>${notes(shown)}</div>
    <aside class="col-side" style="margin-top:40px">${side(shown)}</aside></div>
    <p id="up-err" class="err" role="alert" hidden></p>
    <div class="row"><button type="button" class="btn" id="up">이 결과 올리기</button><span class="small muted" id="up-state"></span></div></div>`.value;
  bindModule(box, shown);

  const btn = $<HTMLButtonElement>('#up', box)!;
  const state = $('#up-state', box)!;
  const errEl = $('#up-err', box)!;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    errEl.hidden = true;
    const resultId = crypto.randomUUID();
    const prefix = `${c.slug}/${m.code}/${resultId}/`;
    try {
      let n = 0;
      for (const f of used) {
        state.textContent = `캡처 올리는 중 ${++n}/${used.length}`;
        const { error } = await supabase.storage.from('grading').upload(prefix + f, byPath.get(f)!, { upsert: true, contentType: byPath.get(f)!.type || undefined });
        if (error) throw new Error(`${f} 파일을 올리지 못했습니다.`);
      }
      state.textContent = '검사하고 저장하는 중…';
      const send = (replace: boolean) => callAdmin<{ replaced: boolean }>('submit-result', { module_id: m.id, result_id: resultId, result, replace });
      let out;
      try { out = await send(false); } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 409) {
          if (!confirm(`${result.participant}의 Module ${m.code} 결과가 이미 있습니다. 새 결과로 바꿀까요?`)) throw new Error('올리기를 취소했습니다. 이미 올라간 캡처는 정리됩니다.');
          out = await send(true);
        } else throw e;
      }
      showToast(out.replaced ? '기존 결과를 바꿨습니다.' : '결과를 올렸습니다. 비공개 상태입니다.');
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
      redraw();
    } catch (e) {
      const err = e as Error & { data?: { messages?: string[] } };
      errEl.innerHTML = esc(err.message) + (err.data?.messages?.length ? `<ul>${err.data.messages.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
      errEl.hidden = false;
      state.textContent = '';
      btn.disabled = false;
      // 실패하거나 취소했으면 올려 둔 캡처를 지운다.
      const { data: list } = await supabase.storage.from('grading').list(prefix.replace(/\/$/, ''));
      if (list?.length) void supabase.storage.from('grading').remove(list.map((x) => prefix + x.name));
    }
  });
}
