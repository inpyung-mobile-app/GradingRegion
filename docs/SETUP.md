# 설치와 운영 안내

이 문서는 새 GradingRegion을 처음 켤 때 한 번 하는 일과, 이후 운영에서 필요한 절차를 적습니다.

## 1. Supabase (프로젝트 grading-region)

1. **마이그레이션**: `supabase/migrations/` 의 SQL을 번호 순서대로 SQL Editor에 붙여 넣어 실행합니다. 04(cron)는 3번 항목을 끝낸 뒤에 실행합니다.
2. **로그인 설정** (Authentication)
   - Sign In / Providers 에서 *Allow new users to sign up* 을 끕니다. 관리자는 초대로만 들어옵니다.
   - URL Configuration 의 Site URL을 배포 주소로 바꾸고, Redirect URLs에 `https://<배포 주소>/admin/login` 을 추가합니다.
3. **첫 관리자 두 명** (Authentication > Users > Invite user 로 두 이메일을 초대한 뒤, SQL Editor에서 실행)

   ```sql
   insert into public.admins (user_id, email, role)
   select id, email, case email when '0812jinwoo@gmail.com' then 'owner' else 'editor' end
     from auth.users where email in ('0812jinwoo@gmail.com', '321plek@gmail.com')
on conflict (user_id) do update set role = excluded.role, email = excluded.email;
   ```

   이후 관리자 추가와 권한 변경은 사이트의 *관리자 목록* 화면(owner만)에서 합니다.
4. **서버 함수 배포**: GitHub 저장소 Settings > Secrets and variables > Actions 에 `SUPABASE_ACCESS_TOKEN`(Supabase 계정의 Access Token)을 넣고, Actions 탭에서 *서버 함수 배포* 를 실행합니다.
5. **예약 작업(cron)**: SQL Editor에서 아래 두 줄을 먼저 실행해 비밀 값을 넣은 뒤 04 마이그레이션을 실행합니다. (제출 기능을 만든 뒤에 하면 됩니다.)

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/close-submissions', 'close_submissions_url');
   select vault.create_secret('<긴 임의 문자열>', 'cron_secret');
   ```

## 1-1. 사이트용 GitHub App (제출 기능)

저장소 만들기, 학생 초대, 마감 시점 커밋 기록에 씁니다. org owner가 한 번 만듭니다.

1. GitHub org(inpyung-mobile-app) Settings > Developer settings > GitHub Apps > New GitHub App.
   - Webhook은 끕니다.
   - Repository permissions: **Administration** Read and write, **Contents** Read and write, **Metadata** Read-only.
   - Where can this app be installed: Only on this account.
2. 만든 뒤 *App ID* 를 적어 두고, *Generate a private key* 로 `.pem` 파일을 받습니다.
3. 앱 페이지의 Install App으로 org에 설치합니다(모든 저장소). 설치 뒤 주소 끝의 숫자가 *Installation ID* 입니다(`.../installations/12345678`).
4. Supabase > Edge Functions > Secrets 에 아래 네 개를 넣습니다. 키 파일은 줄바꿈이 있는 그대로 붙여 넣습니다.
   - `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`
   - `CRON_SECRET` (위 5번의 `cron_secret`과 같은 값)

## 2. Vercel

1. 이 저장소를 가져와 프로젝트를 만들고 Framework는 Vite, Build Command는 `npm run build`, Output은 `dist` 로 둡니다.
2. 환경 변수 두 개를 넣습니다: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (공개용 키만. 비밀 키는 넣지 않습니다).
3. 배포된 주소를 위 Supabase URL Configuration에 넣습니다.

## 3. GitHub Actions 자동 작업

| 작업 | 주기 | 필요한 비밀 값 |
| --- | --- | --- |
| 매주 백업 (`backup.yml`) | 일요일 03:00 KST | `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` |
| 일시정지 방지 핑 (`ping.yml`) | 3일마다 | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |
| 서버 함수 배포 (`deploy-functions.yml`) | 함수 코드 변경 시 / 수동 | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` |

백업은 암호화된 파일로 Actions 결과물에 90일 보관됩니다. 캡처 이미지와 제출 zip은 백업에 들어 있지 않습니다(결과는 다시 올릴 수 있고, zip은 14일 뒤 지워지는 임시 자료입니다).

## 4. 복원

1. Actions 결과물에서 `backup-날짜.dump.enc` 를 내려받습니다.
2. 복호화: `openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:<BACKUP_PASSPHRASE> -in backup-날짜.dump.enc -out backup.dump`
3. 새 Supabase 프로젝트에 마이그레이션을 먼저 적용한 뒤, 데이터만 되살립니다: `pg_restore --data-only --disable-triggers -d "<DB 주소>" backup.dump`
4. 관리자 로그인 계정(auth.users)도 함께 들어 있으므로, 같은 이메일로 다시 로그인할 수 있습니다.

## 5. 지켜야 할 것

- Supabase의 `service_role` 키와 데이터베이스 비밀번호는 브라우저 코드, 저장소, 채팅에 두지 않습니다.
- 확인 코드는 만든 순간 한 번만 보입니다. 잃어버리면 *참가자와 확인 코드* 화면에서 다시 발급합니다.

## 6. 첫 채점 기준표

`rubrics/2026-national-a.json`, `-b.json`, `-c.json` 은 공식 2026 전국기능경기대회 채점기준표(모바일앱개발)를 옮긴 것입니다. 대회 설정에서 모듈 A/B/C를 만든 뒤, *모듈과 채점 기준표* 화면에서 각 모듈에 맞는 파일을 올리세요. 주관 항목은 등급 0~4(배점 ÷ 4 단위), 객관 항목은 확인 사항마다 같은 점수를 주는 부분 점수 방식입니다. 합계는 A 30점, B 35점, C 35점이며 테스트가 이를 확인합니다.
