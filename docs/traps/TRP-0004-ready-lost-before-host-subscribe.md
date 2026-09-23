# iframe ready가 host 구독 전에 도착하면 유실된다

발견: 2026-09-23, opaque origin 모드 데모(`apps/host-r19/app/opaque`) 브라우저 검증 중.

상태: **해결** — 커밋 `d955352`(ready-query). 아래 증상·원인은 해결 전 기준이다. 해결 방식은 "근본 해결 (적용)" 참고. 이전 버전 runner와 함께 쓸 때만 "회피"가 필요하다.

## 증상

- host `status`가 `pending`에서 멈춘다. readyTimeoutMs 설정에 따라 이후 `failed`.
- iframe 쪽 runner는 `active`. 에러·콘솔 경고 없음.

## 원인

사실:

- host controller는 React effect에서 생성되고, 그때 `message` listener를 등록한다. hydration 전에는 listener가 없다.
- SSR된 HTML에 `<iframe src=...>`가 포함되면 iframe은 host hydration과 무관하게 로드된다.
- runner는 ready notify를 한 번만 보낸다. (해결 전) host가 ready를 다시 요청하는 handshake가 없었다.
- 측정(headless Chromium, host=`next dev`, iframe=`next start`): ready 도착 t=269ms, host controller 생성은 그 이후. iframe만 다시 로드(`f.src = f.src`)하자 즉시 `ready`.

## 영향 범위

- opaque 모드 전용 문제가 아니다. 모든 모드에서 "iframe이 host 구독보다 먼저 ready를 보내는" 순서면 발생한다.
- iframe이 빠를수록(production 빌드, 캐시, srcdoc/blob) 재현이 쉽다.

가설(미검증):

- 기존 데모(`/`)도 같은 race가 잠재한다. 양쪽이 dev 모드라 iframe이 느려서 드러나지 않는다.
- runo-lab 범주 B(srcdoc 등으로 즉시 로드되는 iframe)에서 재현 가능성이 높다.

## 회피 (이전 버전 runner와 쓸 때만)

controller가 생긴 뒤에 iframe `src`를 설정한다.

```tsx
<iframe
  ref={iframeRef}
  src={controller ? IFRAME_URL : undefined}
  sandbox="allow-scripts"
/>
```

같은 요소의 src 변경이라 `contentWindow` identity가 유지되어 source 검사에 문제없다([TRP-0002-contentwindow-identity-survives-navigation.md](TRP-0002-contentwindow-identity-survives-navigation.md)).

## 근본 해결 (적용)

ready 재요청 handshake. host와 runner가 모두 이 기능을 포함한 버전이면 회피 없이 복구된다.

- host: `transport.subscribe()` 직후 `notify("host:ready-query")`를 한 번 보낸다(`controller.ts`).
- runner: `sendLifecycleReady()` 호출 여부를 기억하고, query를 받으면 호출된 적이 있을 때만 `{ protocolVersion: 1, requested: true }` ready로 응답한다(`runner.ts`). query는 debug 이벤트로 흘리지 않는다.
- host: `requested: true` 중복 ready는 경고 없이 무시한다.

한 번 보내면 충분한 이유:

- runner는 생성 시 동기적으로 구독한 뒤에야 앱이 `sendLifecycleReady()`를 호출할 수 있다. ready를 보낸 runner는 항상 이미 구독 중이다.
- host는 구독 후 query를 보낸다. ready가 구독 뒤에 나가면 원래 흐름으로 받고, 구독 전에 나갔으면 query에 응답한다. 앱이 아직 준비 전이면 이후 ready를 받는다.

호환성: 이전 버전 runner는 host notify를 무시하고, 이전 버전 host는 query를 보내지 않는다. 섞이면 기존 동작과 같다(`protocolVersion` 1 유지). 이전 버전 runner와 쓰면 위 회피가 여전히 필요하다.

검증:

- 단위 테스트 `tests/unit/readyQuery.test.ts` (유실 복구, 앱 준비 전 무시, 잘못된 origin·source 무시, dispose 후 무시, 기존 runner 호환, requested 중복 무경고).
- headless Chromium(host=`next dev`, iframe=`next start`, 회피 코드 제거): 첫 ready t=238ms 유실, ready-query 응답 t=279ms로 `status ready`.

## 남은 문제 (별도)

- 같은 iframe 요소가 재로드/navigation되면 새 runner의 ready를 host가 중복 ready로 무시한다. 이 해결과 무관하다. 미기록(TRP 후보).
