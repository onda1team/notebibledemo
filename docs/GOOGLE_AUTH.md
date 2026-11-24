> 기존 Worker/Sites 서버용 문서입니다. 현재 Firebase 배포는 [배포 안내](DEPLOYMENT.md)를 따릅니다.

# Google 로그인 설정

Google Cloud Console에서 OAuth 클라이언트 유형을 **웹 애플리케이션**으로 만들고 승인된 리디렉션 URI를 정확히 등록합니다.

```
https://실제-앱-호스트/api/auth/google/callback
```

Worker 환경 변수:

- `GOOGLE_CLIENT_ID`: 해당 웹 OAuth 클라이언트 ID.
- `GOOGLE_CLIENT_SECRET`: 해당 클라이언트 비밀값. 서버 비밀 저장소에만 설정합니다.
- `APP_ORIGIN`: 실제 HTTPS origin만 입력합니다. 끝 슬래시·경로·쿼리를 넣지 않습니다.
- `DB`: 기존 `chapter_sync`와 새 인증 테이블을 사용하는 D1 바인딩.

`drizzle/0001_google_auth.sql`을 배포 전 적용합니다. 인증 설정이 없으면 Google 로그인 시작은 503을 반환하고 세션 API는 `googleEnabled:false`를 제공합니다.

`TRUST_SITES_IDENTITY=1`은 **Sites 인증 게이트웨이가 요청 헤더를 인증·대체하는 배포에만** 설정합니다. 공개 `workers.dev`나 독립 Cloudflare Worker에서는 설정하지 않습니다. 직접 공개된 Worker의 `oai-authenticated-user-id` 헤더는 신뢰할 수 없습니다.

Google 계정은 이메일 대신 검증된 `sub`에 따라 `google:<sub>` 저장 공간을 사용합니다. 기존 ChatGPT 기록을 자동 연결하거나 이동하지 않습니다. 기존 기록 복사는 신뢰된 Sites 환경에서 Google 세션과 기존 게이트웨이 계정이 모두 확인되고 사용자가 `POST /api/auth/import-legacy`에 `{"confirm":true}`로 요청한 경우에만 수행합니다. 같은 장이 이미 있으면 건너뛰며 원본은 남습니다.

세션 쿠키는 `__Host-yeo-session`, HttpOnly·Secure·SameSite=Lax, 30일입니다. DB에는 무작위 세션 토큰의 SHA-256 해시만 저장합니다. OAuth state는 브라우저 쿠키와 연결되며 10분 동안 한 번만 사용할 수 있습니다. Google ID 토큰은 Google 공개키로 서명, issuer, audience, nonce, sub, 만료를 검증합니다.

API:

- `GET /api/auth/session`: `account`, `user`, `provider`, `googleEnabled`, `hasLegacyAccount`.
- `GET /api/auth/google/start`: Google로 리디렉션. 성공 콜백은 `/?auth=google`, 검증된 흐름의 실패는 `/?auth_error=...`.
- `POST /api/auth/logout`: 동일-origin 요청, JSON `{}`. 서버 세션을 폐기하고 쿠키 삭제.
- `POST /api/auth/import-legacy`: 동일-origin JSON `{"confirm":true}`. `{imported,skipped,total}`.

잘못되거나 만료된 Google 세션 쿠키가 있으면 다른 ChatGPT 계정으로 조용히 전환하지 않습니다. 재로그인이 필요합니다. Google access/refresh/ID 토큰은 앱 세션으로 사용하거나 DB에 보관하지 않습니다.

테스트는 로컬 키로 서명된 JWT와 메모리 SQLite를 사용합니다. 운영 Google 로그인은 실제 OAuth 클라이언트 설정 후 별도 확인해야 합니다.

참고: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [jose](https://github.com/panva/jose).
