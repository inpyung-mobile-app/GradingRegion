-- 트리거 전용 함수는 RPC로 부를 수 없게 실행 권한을 거둔다.
revoke all on function public.audit_row() from public, anon, authenticated;
revoke all on function public.guard_last_owner() from public, anon, authenticated;
revoke all on function public.audit_log_immutable() from public, anon, authenticated;
