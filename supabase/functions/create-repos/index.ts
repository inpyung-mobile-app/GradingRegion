// 참가자별 저장소를 만들고 학생을 초대한다. 초대 상태도 다시 확인한다.
import { HttpError, json, serve, str } from '../_shared/http.ts';
import { requireAdmin, serviceClient } from '../_shared/supabase.ts';
import { github, type GitHub } from '../_shared/github.ts';

type Row = { id: string; repo_name: string | null; invite_status: string; students: { name: string; github_id: string | null } };

/** 학생이 저장소에 들어와 있는지(accepted), 초대만 간 상태인지(pending) 본다. */
async function inviteState(gh: GitHub, org: string, repo: string, user: string): Promise<'accepted' | 'pending' | 'expired' | 'none'> {
  const r = await gh.req('GET', `/repos/${org}/${repo}/collaborators/${encodeURIComponent(user)}`);
  if (r.status === 204) return 'accepted';
  const inv = await gh.req<{ invitee: { login: string }; expired: boolean }[]>('GET', `/repos/${org}/${repo}/invitations?per_page=100`);
  const mine = (inv.data ?? []).find((i) => i.invitee.login.toLowerCase() === user.toLowerCase());
  if (mine) return mine.expired ? 'expired' : 'pending';
  return 'none';
}

serve(async (req, body) => {
  const db = serviceClient();
  await requireAdmin(req, db);
  const action = str(body.action, 20) || 'create';
  const contestId = str(body.contest_id, 40);
  const { data: contest } = await db.from('contests').select('id, github_org').eq('id', contestId).maybeSingle();
  if (!contest) throw new HttpError(404, '대회를 찾을 수 없습니다.');
  const org = contest.github_org as string;

  const only = Array.isArray(body.participant_ids) ? (body.participant_ids as unknown[]).filter((x): x is string => typeof x === 'string') : null;
  let q = db.from('participants').select('id, repo_name, invite_status, students(name, github_id)').eq('contest_id', contestId);
  if (only?.length) q = q.in('id', only);
  const rows = ((await q).data ?? []) as unknown as Row[];
  const { data: mods } = await db.from('modules').select('id, code, folder').eq('contest_id', contestId).order('code');
  const gh = await github();

  const report: { name: string; status: string; note?: string }[] = [];
  for (const p of rows) {
    const name = p.students.name;
    const user = p.students.github_id?.trim();
    try {
      if (!p.repo_name) { report.push({ name, status: 'skipped', note: '저장소 이름이 없습니다.' }); continue; }
      if (action === 'create') {
        const exists = await gh.req('GET', `/repos/${org}/${p.repo_name}`);
        if (exists.status === 404) {
          const made = await gh.req('POST', `/orgs/${org}/repos`, { name: p.repo_name, private: true, auto_init: true, description: `${name} 과제 저장소` });
          if (made.status !== 201) throw new Error(`저장소를 만들지 못했습니다(${made.status}).`);
          for (const m of mods ?? []) {
            await gh.req('PUT', `/repos/${org}/${p.repo_name}/contents/${m.folder}/README.md`, {
              message: `${m.folder} 폴더 만들기`, content: btoa(`# ${m.folder}\n\n이 폴더 안에 Module ${m.code} 과제를 넣어 주세요.\n`),
            });
          }
        } else if (exists.status !== 200) throw new Error(`저장소를 확인하지 못했습니다(${exists.status}).`);
        if (!user) { report.push({ name, status: 'no-github', note: '학생의 GitHub 아이디가 없어 초대하지 못했습니다.' }); }
        else {
          const add = await gh.req('PUT', `/repos/${org}/${p.repo_name}/collaborators/${encodeURIComponent(user)}`, { permission: 'push' });
          if (add.status !== 201 && add.status !== 204) throw new Error(`초대하지 못했습니다(${add.status}).`);
          await db.from('participants').update({ invite_status: add.status === 204 ? 'accepted' : 'pending' }).eq('id', p.id);
          report.push({ name, status: add.status === 204 ? 'accepted' : 'pending' });
        }
        await db.from('submissions').upsert((mods ?? []).map((m) => ({ participant_id: p.id, module_id: m.id })), { onConflict: 'participant_id,module_id', ignoreDuplicates: true });
      } else if (action === 'refresh') {
        if (!user) { report.push({ name, status: 'no-github' }); continue; }
        let st = await inviteState(gh, org, p.repo_name, user);
        // 초대가 만료됐으면 다시 보낸다.
        if (st === 'expired' || st === 'none') {
          const add = await gh.req('PUT', `/repos/${org}/${p.repo_name}/collaborators/${encodeURIComponent(user)}`, { permission: 'push' });
          st = add.status === 204 ? 'accepted' : add.status === 201 ? 'pending' : st;
        }
        await db.from('participants').update({ invite_status: st }).eq('id', p.id);
        report.push({ name, status: st });
      } else throw new HttpError(400, '알 수 없는 동작입니다.');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      report.push({ name, status: 'error', note: (e as Error).message });
    }
  }
  return json({ report });
});
