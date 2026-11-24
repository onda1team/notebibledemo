# GitHub에서 독립 배포하기

GitHub는 소스코드를 보관합니다. 이 앱은 서버 인증과 D1 데이터베이스를 사용하므로 GitHub Pages만으로 실행할 수 없습니다. 이 저장소의 독립 배포 대상은 Cloudflare Workers + D1입니다. 아래 과정은 실제 외부 리소스를 만들며, 비용·계정 조건은 사용하는 Cloudflare 계정에서 확인합니다.

## 배포 전 상태

- `wrangler.jsonc`의 데이터베이스 ID와 로그인 설정은 비어 있습니다. 설정을 완료하기 전에는 실제 구글 로그인이 동작하지 않습니다.
- GitHub Actions는 빌드와 테스트만 실행합니다. 푸시만으로 앱이 공개되거나 데이터베이스가 변경되지 않습니다.
- 기존 Sites 주소와 비공개 접근 설정은 별도로 유지됩니다. Workers에 배포하면 별도의 주소와 데이터베이스가 생성됩니다.

## 1. 코드 확인

Node.js 24를 사용합니다. 테스트 중 일부는 Node의 SQLite를 사용합니다.

```sh
npm ci
npm run build
npm test
```

`npm run dev`의 간단한 화면 미리보기는 테스트 계정·메모리 DB를 사용하는 개발 도구입니다. 실제 구글 로그인과 영구 저장은 아래 절차로 배포한 HTTPS 테스트 Worker에서 확인합니다.

## 2. Cloudflare 데이터베이스 만들기

Cloudflare 계정에 로그인한 다음 전용 데이터베이스를 만듭니다.

```sh
npx wrangler login
npx wrangler d1 create yeobaek-bible
```

반환된 실제 `database_id`를 `wrangler.jsonc`에 넣습니다. 기존 Sites 데이터베이스 ID를 추측해 입력하지 않습니다. 독립 Worker에서 `TRUST_SITES_IDENTITY`는 반드시 `"0"`으로 유지합니다. 일반 인터넷 요청의 ChatGPT 사용자 헤더는 신원 증명이 아닙니다.

새 데이터베이스에 저장소의 SQL을 적용합니다.

```sh
npx wrangler d1 migrations apply yeobaek-bible --remote
```

## 3. 첫 배포와 접속 주소

```sh
npx wrangler deploy
```

배포 결과에 나온 실제 HTTPS 주소가 앱 접속 주소입니다. 기본 형태는 `https://yeobaek-bible.<계정의 workers.dev 하위 도메인>.workers.dev`이며, 하위 도메인은 Cloudflare 계정에서 결정됩니다. 아직 배포하지 않았다면 주소가 확정된 것이 아닙니다.

그 주소를 `wrangler.jsonc`의 `APP_ORIGIN`에 후행 `/` 없이 입력합니다. 이 시점에는 구글 로그인이 아직 활성화되지 않습니다.

## 4. Google 앱 등록

Google Cloud의 Google Auth Platform에서 프로젝트를 만들고 앱 이름·사용자 지원 이메일·대상 사용자를 설정합니다. 테스트 상태라면 사용할 구글 계정을 테스트 사용자로 등록합니다.

OAuth 클라이언트 유형은 **웹 애플리케이션**입니다. 승인된 리디렉션 URI에는 실제 앱 주소에 `/api/auth/google/callback`을 붙인 값을 정확히 등록합니다.

```text
https://실제-앱-도메인/api/auth/google/callback
```

클라이언트 ID는 `wrangler.jsonc`의 `GOOGLE_CLIENT_ID`에 입력합니다. 클라이언트 보안 비밀번호는 코드·GitHub·채팅에 기록하지 않고 Cloudflare Secret으로 입력합니다.

```sh
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler deploy
```

이후 실제 주소에서 구글 로그인, 로그아웃, 재로그인, 다른 기기에서 같은 기록 조회, 다른 계정의 기록 격리를 확인합니다. 다른 계정으로 로그인하면 기존 계정의 필기가 표시되어서는 안 됩니다.

## 5. 로컬 검증과 실제 로그인 검증

로컬에서는 화면과 저장 동작을 확인하고, `npm test`로 인증 응답을 모의한 테스트를 실행합니다. 이 앱은 실제 Google OAuth의 `APP_ORIGIN`을 HTTPS로 제한하므로 HTTP localhost에서는 구글 로그인을 활성화하지 않습니다. `.dev.vars.example`의 인증 값은 로컬 화면 검증 시 비워 둡니다.

```sh
npx wrangler d1 migrations apply yeobaek-bible --local
npm run build
npx wrangler dev
```

실제 Google 로그인을 시험하려면 별도 HTTPS 테스트 Worker와 전용 D1을 준비하고, 그 Worker의 정확한 HTTPS 콜백 주소를 Google Cloud에 등록합니다. 테스트용과 운영용 클라이언트·데이터베이스를 혼용하지 않습니다.

`.dev.vars`, `.env`, 개인 필기 백업, 인증 토큰, 데이터베이스 파일은 Git에 포함하지 않습니다.

## 기존 필기 이전

새 Worker 데이터베이스는 기존 Sites 기록을 자동으로 가져오지 않습니다. 기존 브라우저에서 **내 기록 → 백업 및 복구 → 기기 백업 내려받기**로 먼저 원본을 확보합니다. 기존 Sites에서 지원되는 계정 연결/가져오기와 별도 호스팅으로의 데이터 이전은 서로 다른 작업입니다. 독립 배포의 기록 복원은 검증된 가져오기 경로가 준비된 뒤에 진행하며, 이메일 주소만 같다고 기존 기록을 자동으로 연결하지 않습니다.

## 공식 설정 자료

- [Cloudflare Wrangler 설정](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare D1 시작하기](https://developers.cloudflare.com/d1/get-started/)
- [D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)
- [Google OpenID Connect 앱 등록](https://developers.google.com/identity/openid-connect/openid-connect)
