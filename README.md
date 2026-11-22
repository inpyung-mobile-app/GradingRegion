# 채점 결과 조회 사이트

https://inpyung-mobile-app.github.io/GradingRegion/

지방기능경기대회 모바일앱개발(Module A) 채점 결과를 **이름으로 검색**해서 보는 사이트다.
내 결과와 다른 참가자의 결과를 한 화면에서 볼 수 있다.

- 공개 사이트: `docs/` 의 **순수 정적 파일**(VanillaJS) → GitHub Pages 로 배포
- 관리자 도구: **관리자 PC에서만** 실행하는 Node.js 서버(외부 패키지 없음, `127.0.0.1` 전용)

```
관리자 PC                                 GitHub Pages (공개)
─────────────────────────────            ─────────────────────
npm start  (localhost:3000)               docs/index.html
 로그인 → 폴더 업로드 → 이름 입력          docs/data/index.json   ← 목록·점수
   └─ docs/reviews/<id>/ 에 저장           docs/reviews/<id>/     ← 채점지 원본
   └─ docs/data/index.json 갱신
 [GitHub에 배포] → git add/commit/push ──▶ 1~2분 뒤 반영
```

## 처음 한 번만 (GitHub Pages 켜기)

저장소 **Settings → Pages → Build and deployment**
- Source: `Deploy from a branch`
- Branch: `main` / 폴더: `/docs`

> 조직 저장소도 **public** 이면 무료로 배포된다. private 저장소의 Pages 는 유료 플랜이 필요할 수 있다.

## 채점지 추가하는 법

```powershell
npm start
```

1. 브라우저에서 `http://localhost:3000` 을 연다.
2. 처음 실행하면 비밀번호가 터미널에 한 번 표시되고 `admin.config.json` 에 저장된다(git 에는 올라가지 않는다).
3. **탐색기 열기**를 눌러 채점 폴더(`review.html`, `screenshot/`, `prototype/` 이 들어 있는 폴더)를 고른다. 끌어다 놓아도 된다.
4. 점수가 자동으로 인식된다. **참가자 이름**을 입력하고 **채점지 추가**를 누른다.
5. `http://localhost:3000/site/` 에서 미리 본 뒤, **GitHub에 배포** 버튼을 누른다.

같은 이름을 다시 올리면 새 채점지로 **교체**할지 묻는다. 동명이인은 없다고 가정하고 이름을 고유 키로 쓴다.

### 채점 폴더 규칙
- 폴더 맨 위에 `review.html` 이 있어야 한다.
- `review.html` 의 `data-count="…"` 값 순서(총점, 주관, 객관, 감점)로 점수를 읽는다.
- 허용 확장자: html, png, jpg, gif, webp, svg, ico, css, js, json, ttf, otf, woff(2), txt, md
- 등록할 때 `review.html` 에 Pretendard 글꼴 `<style data-gr-font>` 가 한 번 주입된다(원본의 `../assets/fonts` 경로가 배포본에 없기 때문이다).

## 폴더 구조

```
docs/                    ← GitHub Pages 가 서빙하는 공개 폴더
  index.html, assets/    사이트 (style.css, app.js, fonts/)
  data/index.json        목록
  reviews/<id>/          채점지 원본
server/
  server.js              관리자 서버 (API, 업로드, git push)
  admin/                 관리자 화면
admin.config.json        관리자 비밀번호 (git 제외)
```

## 보안과 공개 범위

- 결과는 **완전 공개**다. 주소를 아는 누구나 모든 이름과 점수를 볼 수 있고, 저장소가 public 이면 채점 원본도 저장소에서 보인다.
- 관리자 서버는 `127.0.0.1` 에만 열리고 비밀번호 로그인(HttpOnly 쿠키, 연속 실패 시 30초 잠금)을 거친다. 공개 사이트에는 관리자 기능이 없다.
- 업로드는 경로 이탈(`..`)과 허용 목록 밖의 확장자를 막는다.

## 디자인

- 글꼴: [Pretendard](https://github.com/orioncactus/pretendard) Variable (SIL OFL 1.1, `docs/assets/fonts/LICENSE.txt`), 자체 호스팅
- 참고한 사이트: 토스, 당근, 원티드, Notion, Linear, Vercel, Stripe, GitHub, Kaggle 리더보드
- 반응형 중단점 600 / 768 / 1024px. 모바일에서는 표의 보조 열을 숨기고 이름 아래에 요약을 보여 준다.
- 시스템 라이트/다크 모드를 따른다. 초성 검색(`ㅇㅇㅈ` → 이영재)과 `/` 단축키를 지원한다.
