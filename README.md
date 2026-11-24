# 주의열매 코넬 여백성경

성경 본문 옆에 키보드 메모·손글씨·주보를 기록하고, 같은 Google 계정으로 여러 기기에서 이어 쓰는 웹앱입니다. 현재 배포 대상은 **Firebase 프로젝트 `notebible-2922a`**입니다. Hosting은 화면을 제공하고, Authentication은 Google 로그인을, Firestore는 계정별 기록 저장을 담당합니다.

설정된 Hosting 주소는 [notebible-2922a.web.app](https://notebible-2922a.web.app)입니다. 실제 배포와 Google 공급자·Firestore 설정을 완료해야 로그인과 저장을 사용할 수 있습니다. GitHub에 코드를 올리는 것만으로 홈페이지가 배포되지는 않습니다.

## 개발과 검증

Node.js 24.12 이상을 사용합니다.

```sh
npm ci
npm run build:firebase
npm test
```

`dist/firebase/`가 Firebase Hosting 배포물입니다. `npm run build`와 `npm run dev`는 기존 Sites/Worker 구현의 검증과 메모리 DB 미리보기용으로 유지합니다.

## 저장 방식

- 수정 내용은 계정별 기기 초안으로 먼저 보관하고 Firestore로 전송합니다.
- 서버의 장별 버전을 확인하여 오래된 기록의 무조건 덮어쓰기를 막습니다.
- 충돌과 기기 초안은 백업·복구 화면에서 확인하며, 저장이 확인되지 않은 기록을 임의로 지우지 않습니다.
- 기기마다 같은 Google 계정으로 로그인해야 기록이 연결됩니다.
- 기존 Sites의 필기는 새 Firebase 주소로 자동 이전되지 않습니다. 원본 기기에서 백업을 먼저 확보하고, 가져오기 결과를 확인해야 합니다.

## 배포

[Firebase 배포 안내](docs/DEPLOYMENT.md)를 따릅니다. 이 저장소는 Hosting·Authentication·Firestore를 사용하는 Spark 구성으로 준비했습니다. Cloud Functions와 결제 연결을 요구하지 않으며, 무료 사용량 제한은 Firebase 콘솔에서 확인합니다.

GitHub Actions는 빌드와 테스트만 실행합니다. 인증 비밀값, CLI 로그인 정보, 개인 필기 백업, 기존 Sites의 프로젝트 메타데이터는 저장소와 배포물에 포함하지 않습니다.
