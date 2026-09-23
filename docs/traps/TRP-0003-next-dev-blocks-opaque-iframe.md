# Next.js dev server는 opaque origin iframe의 `/_next` 리소스를 차단한다

발견: 2026-09-23, iframe-r19 앱을 `sandbox="allow-scripts"`로 띄웠을 때.

## 증상

- iframe 화면은 SSR HTML만 보이고 hydration이 안 된다. runner가 시작되지 않아 host는 `pending`.
- iframe 앱 dev server 로그:

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/static/chunks/_1gsra8x._.js from an unknown source.
Cross-origin access to Next.js dev resources is blocked by default for safety.
```

## 원인

사실:

- sandboxed 문서의 origin은 `"null"`이라 자기 서버(`localhost:3301`)의 `/_next` 요청도 cross-origin이 된다.
- Next.js 16.3.6 dev server는 cross-origin dev 리소스 요청을 기본 차단한다.

가설: `allowedDevOrigins`는 hostname 기반이라 `"null"` origin을 허용 목록에 넣을 수 없다. 시도 안 함.

## 회피

iframe 앱은 production 모드로 실행한다. host는 dev여도 된다.

```sh
pnpm build
pnpm --filter iframe-r19 exec next start --port 3301
pnpm --filter host-r19 dev
```

`pnpm dev:r19`로는 opaque 데모(`/opaque`)가 동작하지 않는다.
