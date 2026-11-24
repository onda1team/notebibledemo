# Firebase 배포 안내

현재 대상은 Firebase 프로젝트 `notebible-2922a`입니다. 정적 화면은 Hosting, Google 로그인은 Authentication, 계정별 기록은 Cloud Firestore를 사용합니다. Cloud Functions·Cloud Run·Cloudflare 배포는 필요하지 않습니다.

## 콘솔 설정

1. Firebase 콘솔에서 `notebible-2922a` 프로젝트를 선택하고 웹 앱을 등록합니다.
2. Authentication → 로그인 방법에서 Google을 활성화하고 지원 이메일을 지정합니다.
3. 승인된 도메인에 `notebible-2922a.web.app`과 `notebible-2922a.firebaseapp.com`이 있는지 확인합니다.
4. Cloud Firestore의 기본 데이터베이스를 만들고 위치를 선택합니다. 보안 규칙은 저장소의 `firestore.rules`를 배포합니다. `firestore.indexes.json`은 큰 필기 JSON을 불필요한 검색 색인에서 제외합니다. 모든 사용자에게 읽기·쓰기를 허용하는 테스트 규칙으로 운영하지 않습니다.
5. Spark 요금제를 유지하고 사용량을 확인합니다. 무료 한도에 도달하면 저장 요청이 실패할 수 있으므로 앱의 기기 초안과 백업을 함께 확인합니다.

웹 앱은 Hosting의 `/__/firebase/init.json`에서 공개 Firebase 설정을 읽습니다. OAuth client secret이나 서비스 계정 키를 브라우저에 넣지 않습니다. Google 공급자 설정 전에는 실제 로그인을 검증한 것으로 간주하지 않습니다.

## 빌드와 배포

Node.js 24.12 이상을 사용합니다.

```sh
npm ci
npm run build:firebase
npm test
npx firebase login
npm run deploy:firebase
```

`.firebaserc`와 배포 명령이 프로젝트를 `notebible-2922a`로 지정합니다. `firebase.json`의 Hosting `predeploy`가 최신 코드를 다시 빌드합니다. 배포 파일은 `dist/firebase/`이며, Worker 서버·대화 기록·개인 백업은 포함되지 않습니다.

배포 명령이 성공한 뒤 [https://notebible-2922a.web.app](https://notebible-2922a.web.app)에서 확인합니다. GitHub 저장소 URL은 소스 열람 주소이며 앱 접속 주소와 다릅니다.

## 배포 후 확인

- Google 로그인·로그아웃·재로그인과 로그인 취소를 확인합니다.
- 같은 계정으로 두 브라우저 또는 기기에서 로그인하여 제목·키보드 메모·손글씨가 전달되는지 확인합니다.
- 다른 Google 계정에서는 첫 계정의 기록이 보이지 않아야 합니다.
- 네트워크가 끊겼을 때 기기 초안이 남고, 연결이 돌아오면 서버 저장 상태가 갱신되는지 확인합니다.
- 같은 장을 동시에 수정하면 충돌을 표시하고 양쪽 기록을 보존하는지 확인합니다.

자동화 테스트와 실제 로그인 검증은 별개입니다. 실제 사용자의 맥북에 남은 누락 기록은 해당 기기 원본을 백업하고 비교해야 확인할 수 있습니다.

## 기존 기록과 코드

기존 Sites 주소의 브라우저 저장소와 서버 기록은 Firebase와 분리되어 있습니다. 새 계정이나 새 주소로 로그인해도 자동 이전되지 않습니다. 기존 기기에서 **내 기록 → 백업 및 복구 → 기기 백업 내려받기**로 원본을 먼저 확보합니다. 가져오기는 사용자가 고른 백업에만 수행하고 겹치는 기록을 무조건 덮어쓰지 않습니다.

`worker/`, `drizzle/`, `wrangler.jsonc`와 기존 Worker용 Google OAuth 코드는 이전 구현의 검증을 위해 보관합니다. `npm run build:firebase` 배포물은 해당 서버를 실행하지 않습니다. 기존 [Worker 인증 설명](GOOGLE_AUTH.md)은 Firebase 설정 절차가 아닙니다.

## 공식 자료

- [Firebase 웹 앱 등록](https://firebase.google.com/docs/web/setup)
- [Firebase Google 로그인](https://firebase.google.com/docs/auth/web/google-signin)
- [Hosting 설정](https://firebase.google.com/docs/hosting/full-config)
- [Hosting 공개 설정 URL](https://firebase.google.com/docs/hosting/reserved-urls)
- [Spark 요금제와 사용량 제한](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
