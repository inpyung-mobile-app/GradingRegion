-- 모듈 마감 처리와 제출 zip 정리를 부르는 예약 작업.
-- Edge Function 주소와 비밀 값은 마이그레이션에 넣지 않고 Vault에 따로 넣는다(docs/SETUP.md 참고):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/close-submissions', 'close_submissions_url');
--   select vault.create_secret('<긴 임의 문자열>', 'cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 마감 시각(연장 반영)이 지났는데 아직 처리하지 않은 참가자 × 모듈 수
create function public.pending_close_count() returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
    from public.participants p
    join public.modules m on m.contest_id = p.contest_id
    left join public.submissions s on s.participant_id = p.id and s.module_id = m.id
    left join public.deadline_extensions e on e.participant_id = p.id and e.module_id = m.id
   where m.deadline is not null
     and coalesce(e.extended_until, m.deadline) <= now()
     and coalesce(s.status, 'open') = 'open'
$$;

create function public.kick_close_submissions(p_force boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not p_force and public.pending_close_count() = 0 then return; end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'close_submissions_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('purge', p_force),
    timeout_milliseconds := 55000
  );
end $$;

revoke all on function public.pending_close_count(), public.kick_close_submissions(boolean) from public, anon, authenticated;

-- 1분마다 마감 확인(처리할 게 있을 때만 함수를 부른다), 매일 03:10 KST에 zip 정리
select cron.schedule('close-submissions', '* * * * *', $$select public.kick_close_submissions(false)$$);
select cron.schedule('purge-submissions', '10 18 * * *', $$select public.kick_close_submissions(true)$$);
