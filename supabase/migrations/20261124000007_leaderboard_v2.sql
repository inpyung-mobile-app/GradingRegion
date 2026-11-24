-- 순위표: 모듈별 주관/객관/만점까지 돌려줘서 화면에서 탭별 순위와 감점을 계산한다.
drop function if exists public.get_leaderboard(text);

create function public.get_leaderboard(p_slug text)
returns table (anon_no int, display_name text, subjective numeric, objective numeric, total numeric, max_total numeric, modules jsonb)
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
             sum(ru.subjective_max + ru.objective_max) as mx,
             jsonb_object_agg(m.code, jsonb_build_object(
               'sub', r.subjective_score, 'obj', r.objective_score,
               'total', r.subjective_score + r.objective_score,
               'max', ru.subjective_max + ru.objective_max)) as mods
        from public.participants p
        join public.students s on s.id = p.student_id
        join public.results r on r.participant_id = p.id and r.is_public
        join public.modules m on m.id = r.module_id
        join public.rubrics ru on ru.id = r.rubric_id
       where p.contest_id = c.id
       group by p.id, s.name
    )
    select public.participant_anon_no(a.pid),
           case when c.leaderboard_mode = 'names' then a.sname else '참가자 ' || public.participant_anon_no(a.pid) end,
           a.sub, a.obj, a.tot, a.mx, a.mods
      from agg a order by a.tot desc, a.obj desc, a.sname;
end $$;

revoke all on function public.get_leaderboard(text) from public;
grant execute on function public.get_leaderboard(text) to anon, authenticated;
