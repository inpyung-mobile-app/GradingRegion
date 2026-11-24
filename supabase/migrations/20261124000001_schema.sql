-- GradingRegion 2.0 스키마. 모든 표는 RLS를 켜고, 참가자는 표를 직접 읽지 못한다.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 관리자
-- ---------------------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'editor')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid()) and role = 'owner') $$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 학생 명단(대회 밖)
-- ---------------------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  github_id text,
  short_name text not null check (short_name ~ '^[a-z0-9][a-z0-9-]*$'),
  memo text,
  created_at timestamptz not null default now(),
  constraint students_short_name_key unique (short_name),
  constraint students_name_key unique (name)
);

-- ---------------------------------------------------------------------------
-- 대회, 채점 기준표, 모듈
-- ---------------------------------------------------------------------------
create table public.contests (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  stage text not null check (stage in ('reg', 'nat')),   -- reg=지방, nat=전국 (저장소 이름에 쓴다)
  year int not null check (year between 2000 and 2100),
  held_on date,
  leaderboard_mode text not null default 'names' check (leaderboard_mode in ('hidden', 'anonymous', 'names')),
  is_public boolean not null default false,
  zip_retention_days int not null default 14 check (zip_retention_days between 0 and 365),
  github_org text not null default 'inpyung-mobile-app',
  created_at timestamptz not null default now()
);

create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  rubric_key text not null,
  version int not null check (version >= 1),
  title text not null,
  subjective_max numeric not null,
  objective_max numeric not null,
  definition jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (rubric_key, version)
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  code text not null check (code in ('A', 'B', 'C')),
  title text,
  rubric_id uuid references public.rubrics (id) on delete restrict,
  folder text not null check (folder ~ '^[a-z0-9][a-z0-9-]*$'),
  deadline timestamptz,
  created_at timestamptz not null default now(),
  unique (contest_id, code)
);

-- ---------------------------------------------------------------------------
-- 참가자와 과제물
-- ---------------------------------------------------------------------------
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,
  code_hash text,
  code_issued_at timestamptz,
  repo_name text,
  invite_status text not null default 'none' check (invite_status in ('none', 'pending', 'accepted', 'expired')),
  created_at timestamptz not null default now(),
  unique (contest_id, student_id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  method text not null default 'repo' check (method in ('repo', 'zip')),
  status text not null default 'open' check (status in ('open', 'closed', 'late')),
  last_push_sha text,
  last_push_at timestamptz,
  last_checked_at timestamptz,
  ontime_commit text,
  ontime_zip_path text,
  closed_at timestamptz,
  late_commit text,
  late_at timestamptz,
  late_seconds int,
  grade_commit text,
  zip_path text,
  zip_size bigint,
  zip_uploaded_at timestamptz,
  zip_purged_at timestamptz,
  unique (participant_id, module_id)
);

create table public.deadline_extensions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  extended_until timestamptz not null,
  reason text,
  extended_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (participant_id, module_id)
);

-- ---------------------------------------------------------------------------
-- 결과
-- ---------------------------------------------------------------------------
create table public.results (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  module_id uuid not null references public.modules (id) on delete cascade,
  rubric_id uuid not null references public.rubrics (id) on delete restrict,
  target text,
  graded_commit text,
  graded_zip_path text,
  graded_late boolean not null default false,
  body jsonb not null,
  subjective_score numeric not null check (subjective_score >= 0),
  objective_score numeric not null check (objective_score >= 0),
  is_public boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (participant_id, module_id)
);

create table public.result_images (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.results (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  caption text,
  sort_order int not null default 0,
  unique (result_id, file_name)
);

-- ---------------------------------------------------------------------------
-- 기록 표
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  table_name text not null,
  row_id text,
  changes jsonb,
  at timestamptz not null default now()
);

create table public.lookup_attempts (
  id bigint generated always as identity primary key,
  contest_id uuid references public.contests (id) on delete cascade,
  name text,
  ip_hash text,
  ok boolean not null,
  at timestamptz not null default now()
);
create index lookup_attempts_name_idx on public.lookup_attempts (contest_id, name, at desc);
create index lookup_attempts_ip_idx on public.lookup_attempts (ip_hash, at desc);

create table public.code_requests (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  name text not null,
  requested_at timestamptz not null default now(),
  handled boolean not null default false,
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz
);
create index code_requests_open_idx on public.code_requests (contest_id, handled, requested_at desc);

create index results_module_idx on public.results (module_id);
create index submissions_module_idx on public.submissions (module_id);
create index participants_contest_idx on public.participants (contest_id);
