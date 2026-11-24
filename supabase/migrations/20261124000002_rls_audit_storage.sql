-- 권한(RLS), 감사 트리거, 저장소 버킷.
-- 원칙: 브라우저(anon 키)는 아무 표도 직접 못 읽는다. 관리자는 로그인 뒤 RLS 안에서만, 참가자는 Edge Function으로만.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

alter table public.admins enable row level security;
alter table public.students enable row level security;
alter table public.contests enable row level security;
alter table public.rubrics enable row level security;
alter table public.modules enable row level security;
alter table public.participants enable row level security;
alter table public.submissions enable row level security;
alter table public.deadline_extensions enable row level security;
alter table public.results enable row level security;
alter table public.result_images enable row level security;
alter table public.audit_log enable row level security;
alter table public.lookup_attempts enable row level security;
alter table public.code_requests enable row level security;

-- 관리자 전용: 읽기와 쓰기 모두 is_admin()
do $$
declare t text;
begin
  foreach t in array array['students', 'contests', 'rubrics', 'modules', 'submissions', 'deadline_extensions', 'result_images']
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()))', t || '_admin_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_admin()))', t || '_admin_delete', t);
  end loop;
end $$;

-- 참가자: 관리자만. 확인 코드 해시 컬럼은 아무도(관리자도) 직접 못 읽고 못 쓴다.
create policy participants_admin_select on public.participants for select to authenticated using ((select public.is_admin()));
create policy participants_admin_insert on public.participants for insert to authenticated with check ((select public.is_admin()));
create policy participants_admin_update on public.participants for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy participants_admin_delete on public.participants for delete to authenticated using ((select public.is_admin()));
revoke all on public.participants from authenticated;
grant select (id, contest_id, student_id, code_issued_at, repo_name, invite_status, created_at) on public.participants to authenticated;
grant insert (contest_id, student_id, repo_name, invite_status) on public.participants to authenticated;
grant update (repo_name, invite_status) on public.participants to authenticated;
grant delete on public.participants to authenticated;

-- 결과: 관리자는 읽기와 지우기만. 저장과 공개 전환은 submit-result / 함수로만(서버가 한 번 더 검사).
create policy results_admin_select on public.results for select to authenticated using ((select public.is_admin()));
create policy results_admin_delete on public.results for delete to authenticated using ((select public.is_admin()));
revoke all on public.results from authenticated;
grant select, delete on public.results to authenticated;

-- 관리자 목록: 모든 관리자가 읽고, 바꾸는 건 owner만(초대는 invite-admin).
create policy admins_select on public.admins for select to authenticated using ((select public.is_admin()));
create policy admins_owner_update on public.admins for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy admins_owner_delete on public.admins for delete to authenticated using ((select public.is_owner()));
revoke all on public.admins from authenticated;
grant select on public.admins to authenticated;
grant update (role) on public.admins to authenticated;
grant delete on public.admins to authenticated;

-- 기록 표: 관리자는 읽기만. 쓰기는 트리거(security definer)와 서버만.
create policy audit_log_admin_select on public.audit_log for select to authenticated using ((select public.is_admin()));
create policy lookup_attempts_admin_select on public.lookup_attempts for select to authenticated using ((select public.is_admin()));
create policy code_requests_admin_select on public.code_requests for select to authenticated using ((select public.is_admin()));
create policy code_requests_admin_update on public.code_requests for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.audit_log, public.lookup_attempts, public.code_requests from authenticated;
grant select on public.audit_log, public.lookup_attempts to authenticated;
grant select on public.code_requests to authenticated;
grant update (handled, handled_by, handled_at) on public.code_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 마지막 owner는 지우거나 내릴 수 없다
-- ---------------------------------------------------------------------------
create function public.guard_last_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (select 1 from public.admins where role = 'owner' and user_id <> old.user_id) then
      raise exception '마지막 owner는 지우거나 editor로 바꿀 수 없습니다.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger admins_guard_last_owner before update or delete on public.admins
  for each row execute function public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- 감사 기록: 트리거가 자동으로 쓰고, 아무도 수정/삭제할 수 없다
-- ---------------------------------------------------------------------------
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  strip text[] := array['code_hash', 'body'];
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - strip end;
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - strip end;
  rid text := coalesce(new_j ->> 'id', old_j ->> 'id', new_j ->> 'user_id', old_j ->> 'user_id');
  diff jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', old_j -> n.key, 'to', n.value)), '{}'::jsonb)
      into diff from jsonb_each(new_j) n where old_j -> n.key is distinct from n.value;
    if diff = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then diff := new_j;
  else diff := old_j;
  end if;
  insert into public.audit_log (actor, action, table_name, row_id, changes)
  values (coalesce((select auth.uid()), nullif(current_setting('app.actor', true), '')::uuid),
          lower(tg_op), tg_table_name, rid, diff);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['admins', 'students', 'contests', 'rubrics', 'modules', 'participants', 'submissions', 'deadline_extensions', 'results']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

create function public.audit_log_immutable() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '감사 기록은 수정하거나 지울 수 없습니다.'; end $$;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- 저장소 버킷(둘 다 비공개)과 관리자 권한
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('grading', 'grading', false, 10485760),
       ('submissions', 'submissions', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "grading_admin_all" on storage.objects for all to authenticated
  using (bucket_id = 'grading' and (select public.is_admin()))
  with check (bucket_id = 'grading' and (select public.is_admin()));
create policy "submissions_admin_all" on storage.objects for all to authenticated
  using (bucket_id = 'submissions' and (select public.is_admin()))
  with check (bucket_id = 'submissions' and (select public.is_admin()));
