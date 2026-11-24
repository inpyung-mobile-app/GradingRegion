-- Edge Function(service_role)만 부르는 저장용 함수.
-- 서버가 결과를 검사한 뒤 한 트랜잭션으로 저장하고, 감사 기록에는 실제 관리자를 남긴다.

create function public.save_result(
  p_actor uuid,
  p_new_id uuid,
  p_participant uuid,
  p_module uuid,
  p_rubric uuid,
  p_target text,
  p_graded_commit text,
  p_graded_zip text,
  p_graded_late boolean,
  p_body jsonb,
  p_subjective numeric,
  p_objective numeric,
  p_images jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  was_public boolean := false;
  img jsonb;
  i int := 0;
begin
  perform set_config('app.actor', coalesce(p_actor::text, ''), true);
  select r.is_public into was_public from public.results r where r.participant_id = p_participant and r.module_id = p_module;
  delete from public.results where participant_id = p_participant and module_id = p_module;
  insert into public.results (id, participant_id, module_id, rubric_id, target, graded_commit, graded_zip_path, graded_late,
                              body, subjective_score, objective_score, is_public, updated_by, updated_at)
  values (p_new_id, p_participant, p_module, p_rubric, p_target, p_graded_commit, p_graded_zip, p_graded_late,
          p_body, p_subjective, p_objective, coalesce(was_public, false), p_actor, now());
  for img in select * from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) loop
    insert into public.result_images (result_id, storage_path, file_name, caption, sort_order)
    values (p_new_id, img ->> 'path', img ->> 'file', img ->> 'caption', i);
    i := i + 1;
  end loop;
  return p_new_id;
end $$;

-- 다른 관리자의 로그인 세션을 모두 끊는다(owner가 invite-admin을 거쳐서만).
create function public.revoke_sessions(p_user uuid) returns int
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.save_result(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, jsonb, numeric, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.save_result(uuid, uuid, uuid, uuid, uuid, text, text, text, boolean, jsonb, numeric, numeric, jsonb) to service_role;
grant execute on function public.revoke_sessions(uuid) to service_role;
