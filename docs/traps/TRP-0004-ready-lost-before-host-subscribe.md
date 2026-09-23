# iframe ready가 host 구독 전에 도착하면 유실된다

발견: 2026-09-23, opaque origin 모드 데모(`apps/host-r19/app/opaque`) 브라우저 검증 중.

## 증상

- host `status`가 `pending`에서 멈춘다. readyTimeoutMs 설정에 따라 이후 `failed`.
- iframe 쪽 runner는 `active`. 에러·콘솔 경고 없음.

## 원인

사실:

- host controller는 React effect에서 생성되고, 그때 `message` listener를 등록한다. hydration 전에는 listener가 없다.
- SSR된 HTML에 `<iframe src=...>`가 포함되면 iframe은 host hydration과 무관하게 로드된다.
- runner는 ready notify를 한 번만 보낸다. host가 ready를 다시 요청하는 handshake는 없다.
- 측정(headless Chromium, host=`next dev`, iframe=`next start`): ready 도착 t=269ms, host controller 생성은 그 이후. iframe만 다시 로드(`f.src = f.src`)하자 즉시 `ready`.

## 영향 범위

- opaque 모드 전용 문제가 아니다. 모든 모드에서 "iframe이 host 구독보다 먼저 ready를 보내는" 순서면 발생한다.
- iframe이 빠를수록(production 빌드, 캐시, srcdoc/blob) 재현이 쉽다.

가설(미검증):

- 기존 데모(`/`)도 같은 race가 잠재한다. 양쪽이 dev 모드라 iframe이 느려서 드러나지 않는다.
- runo-lab 범주 B(srcdoc 등으로 즉시 로드되는 iframe)에서 재현 가능성이 높다.

## 회피

controller가 생긴 뒤에 iframe `src`를 설정한다.

```tsx
<iframe
  ref={iframeRef}
  src={controller ? IFRAME_URL : undefined}
  sandbox="allow-scripts"
/>
```

같은 요소의 src 변경이라 `contentWindow` identity가 유지되어 source 검사에 문제없다([TRP-0002-contentwindow-identity-survives-navigation.md](TRP-0002-contentwindow-identity-survives-navigation.md)).

## 근본 해결 후보 (결정 안 됨)

- host가 controller 생성 직후 iframe에 "ready 요청" notify를 보내고 runner가 재응답. protocol 변경.
- 라이브러리 README에 "iframe src는 controller 생성 후 설정" 계약을 명시. (반영됨: `packages/iframecall/README.md` 동작 흐름)
