-- 확인 코드, 공개 조회, 관리자 작업용 함수(RPC).

-- 헷갈리는 글자(0/O, 1/l/I)를 뺀 8자 코드
create function public.generate_code() returns text
language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  bytes bytea := extensions.gen_random_bytes(8);
  out text := '';
begin
  for i in 0..7 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return out;
end $$;
revoke all on function public.generate_code() from public, anon, authenticated;

-- 참가자의 확인 코드를 새로 만들어 해시만 저장하고, 코드는 한 번만 돌려준다.
create function public.issue_code(p_participant uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare code text := public.generate_code();
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  update public.participants
     set code_hash = extensions.crypt(code, extensions.gen_salt('bf')), code_issued_at = now()
   where id = p_participant;
  if not found then raise exception '참가자를 찾을 수 없습니다.'; end if;
  return code;
end $$;

-- 학생 명단에서 이번 대회 참가자를 불러온다. 새로 들어온 참가자에게만 코드를 만든다.
create function public.add_participants(p_contest uuid, p_students uuid[])
returns table (participant_id uuid, student_id uuid, name text, repo_name text, code text)
language plpgsql security definer set search_path = ''
as $$
declare
  c public.contests;
  s record;
  pid uuid;
  new_code text;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  select * into c from public.contests where id = p_contest;
  if not found then raise exception '대회를 찾을 수 없습니다.'; end if;
  for s in select * from public.students st where st.id = any (p_students) order by st.name loop
    if exists (select 1 from public.participants p where p.contest_id = p_contest and p.student_id = s.id) then
      continue;
    end if;
    new_code := public.generate_code();
    insert into public.participants (contest_id, student_id, repo_name, code_hash, code_issued_at)
    values (p_contest, s.id, format('%s-%s-%s', c.year, c.stage, s.short_name),
            extensions.crypt(new_code, extensions.gen_salt('bf')), now())
    returning id into pid;
    participant_id := pid; student_id := s.id; name := s.name;
    repo_name := format('%s-%s-%s', c.year, c.stage, s.short_name); code := new_code;
    return next;
  end loop;
end $$;

-- 코드 분실 요청을 처리한다: 새 코드를 발급하고 요청을 처리됨으로 표시한다.
create function public.handle_code_request(p_request uuid) returns table (name text, code text)
language plpgsql security definer set search_path = ''
as $$
declare
  r public.code_requests;
  pid uuid;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  select * into r from public.code_requests where id = p_request;
  if not found then raise exception '요청을 찾을 수 없습니다.'; end if;
  select p.id into pid from public.participants p join public.students s on s.id = p.student_id
   where p.contest_id = r.contest_id and s.name = r.name;
  if pid is null then raise exception '이 대회에 그 이름의 참가자가 없습니다.'; end if;
  name := r.name; code := public.issue_code(pid);
  update public.code_requests set handled = true, handled_by = (select auth.uid()), handled_at = now() where id = p_request;
  return next;
end $$;

-- 모듈 단위 공개/비공개
create function public.set_module_public(p_module uuid, p_public boolean) returns int
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  update public.results set is_public = p_public where module_id = p_module and is_public is distinct from p_public;
  get diagnostics n = row_count;
  return n;
end $$;

-- 저장 공간 사용량(제출 zip + 캡처)
create function public.storage_usage() returns table (bucket text, bytes bigint, files bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  return query
    select o.bucket_id::text, coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint, count(*)::bigint
      from storage.objects o where o.bucket_id in ('grading', 'submissions') group by o.bucket_id;
end $$;

-- ---------------------------------------------------------------------------
-- Edge Function(service_role)만 부르는 함수
-- ---------------------------------------------------------------------------
create function public.verify_participant(p_slug text, p_name text, p_code text)
returns table (participant_id uuid, contest_id uuid, student_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.contest_id, p.student_id
    from public.participants p
    join public.contests c on c.id = p.contest_id
    join public.students s on s.id = p.student_id
   where c.slug = p_slug and c.is_public and s.name = btrim(p_name)
     and p.code_hash is not null and p.code_hash = extensions.crypt(p_code, p.code_hash)
$$;

-- 같은 이름 또는 같은 IP에서 10분 안에 5번 틀리면 마지막 실패로부터 15분 동안 막는다.
create function public.lookup_blocked(p_contest uuid, p_name text, p_ip text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  by_name boolean;
  by_ip boolean;
begin
  select coalesce(bool_or(newest - oldest <= interval '10 minutes' and now() - newest < interval '15 minutes'), false)
    into by_name
    from (
      select max(at) as newest, min(at) as oldest
        from (select at from public.lookup_attempts
               where contest_id = p_contest and name = p_name and not ok
                 and at > coalesce((select max(at) from public.lookup_attempts
                                     where contest_id = p_contest and name = p_name and ok), '-infinity')
               order by at desc limit 5) last5
       having count(*) = 5
    ) w;
  select coalesce(bool_or(newest - oldest <= interval '10 minutes' and now() - newest < interval '15 minutes'), false)
    into by_ip
    from (
      select max(at) as newest, min(at) as oldest
        from (select at from public.lookup_attempts
               where ip_hash = p_ip and not ok
                 and at > coalesce((select max(at) from public.lookup_attempts where ip_hash = p_ip and ok), '-infinity')
               order by at desc limit 5) last5
       having count(*) = 5
    ) w;
  return by_name or by_ip;
end $$;

revoke all on function public.verify_participant(text, text, text) from public, anon, authenticated;
revoke all on function public.lookup_blocked(uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_participant(text, text, text) to service_role;
grant execute on function public.lookup_blocked(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 누구나 부르는 함수(anon): 필요한 컬럼만
-- ---------------------------------------------------------------------------
create function public.list_public_contests()
returns table (slug text, name text, stage text, year int, held_on date, leaderboard_mode text)
language sql stable security definer set search_path = ''
as $$
  select c.slug, c.name, c.stage, c.year, c.held_on, c.leaderboard_mode
    from public.contests c where c.is_public order by c.year desc, c.held_on desc nulls last, c.created_at desc
$$;

create function public.get_contest_public(p_slug text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'slug', c.slug, 'name', c.name, 'stage', c.stage, 'year', c.year, 'held_on', c.held_on,
    'leaderboard_mode', c.leaderboard_mode, 'github_org', c.github_org,
    'modules', coalesce((select jsonb_agg(jsonb_build_object('code', m.code, 'title', m.title, 'folder', m.folder, 'deadline', m.deadline) order by m.code)
                           from public.modules m where m.contest_id = c.id), '[]'::jsonb))
    from public.contests c where c.slug = p_slug and c.is_public
$$;

-- 참가자 번호(익명 순위표용): 대회 안에서 항상 같은 번호
create function public.participant_anon_no(p_participant uuid) returns int
language sql stable security definer set search_path = ''
as $$
  select n::int from (
    select id, row_number() over (partition by contest_id order by md5(id::text)) as n from public.participants
     where contest_id = (select contest_id from public.participants where id = p_participant)
  ) t where id = p_participant
$$;
revoke all on function public.participant_anon_no(uuid) from public, anon, authenticated;
grant execute on function public.participant_anon_no(uuid) to service_role;

-- 순위표: 공개된 결과만 합산. 숨김이면 빈 목록, 익명이면 이름 대신 번호.
create function public.get_leaderboard(p_slug text)
returns table (rank int, anon_no int, display_name text, subjective numeric, objective numeric, total numeric, modules jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare c public.contests;
begin
  select * into c from public.contests where slug = p_slug and is_public;
  if not found or c.leaderboard_mode = 'hidden' then return; end if;
  return query
    with agg as (
      select p.id as pid, s.name as sname,
             sum(r.subjective_score) as sub, sum(r.objective_score) as obj,
             sum(r.subjective_score + r.objective_score) as tot,
             jsonb_object_agg(m.code, r.subjective_score + r.objective_score) as mods
        from public.participants p
        join public.students s on s.id = p.student_id
        join public.results r on r.participant_id = p.id and r.is_public
        join public.modules m on m.id = r.module_id
       where p.contest_id = c.id
       group by p.id, s.name
    )
    select (rank() over (order by a.tot desc))::int,
           public.participant_anon_no(a.pid),
           case when c.leaderboard_mode = 'names' then a.sname else '참가자 ' || public.participant_anon_no(a.pid) end,
           a.sub, a.obj, a.tot, a.mods
      from agg a order by a.tot desc, a.sname;
end $$;

-- 코드 분실 요청. 같은 이름은 하루 3번까지. 참가자가 아닌 이름이어도 같은 응답을 준다.
create function public.request_code(p_slug text, p_name text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  c public.contests;
  nm text := btrim(coalesce(p_name, ''));
begin
  if length(nm) = 0 or length(nm) > 40 then return true; end if;
  select * into c from public.contests where slug = p_slug and is_public;
  if not found then return true; end if;
  if (select count(*) from public.code_requests where contest_id = c.id and name = nm
        and requested_at > now() - interval '1 day') >= 3 then return true; end if;
  if exists (select 1 from public.code_requests where contest_id = c.id and name = nm and not handled) then return true; end if;
  if exists (select 1 from public.participants p join public.students s on s.id = p.student_id
              where p.contest_id = c.id and s.name = nm) then
    insert into public.code_requests (contest_id, name) values (c.id, nm);
  end if;
  return true;
end $$;

-- 일시정지 방지용 핑
create function public.ping() returns timestamptz
language sql stable security definer set search_path = ''
as $$ select now() $$;

revoke all on function public.list_public_contests(), public.get_contest_public(text), public.get_leaderboard(text),
  public.request_code(text, text), public.ping() from public;
grant execute on function public.list_public_contests(), public.get_contest_public(text), public.get_leaderboard(text),
  public.request_code(text, text), public.ping() to anon, authenticated;

revoke all on function public.issue_code(uuid), public.add_participants(uuid, uuid[]), public.handle_code_request(uuid),
  public.set_module_public(uuid, boolean), public.storage_usage() from public, anon;
grant execute on function public.issue_code(uuid), public.add_participants(uuid, uuid[]), public.handle_code_request(uuid),
  public.set_module_public(uuid, boolean), public.storage_usage() to authenticated;
