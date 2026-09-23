# src 변경은 `contentWindow` identity를 바꾸지 않는다

발견: 2026-09-23. 기존 `createIframeWindowTransport` 주석이 반대로 적혀 있었다("iframe src 변경처럼 contentWindow가 교체되는 경우").

## 사실

- HTML spec: `contentWindow`는 browsing context의 WindowProxy를 반환하고, 같은 iframe 요소의 navigation 동안 identity가 유지된다. `event.source`도 같은 WindowProxy다.
- 실측(headless Chromium): 요소 삽입 직후 캡처한 `contentWindow`(초기 about:blank)와, sandboxed cross-origin 문서로 navigation한 뒤 온 메시지의 `event.source`가 `===`로 같았다. src 재설정 후에도 같았다.
- `contentWindow`가 `null`인 경우는 요소가 문서에 붙지 않았을 때다.
- `contentWindow`가 달라지는 경우는 iframe 요소 자체를 새로 만들 때다.

## 함의

- controller 생성 시점에 캐시한 `expectedSource`는 src 변경 후에도 유효하다. "src를 나중에 설정" 회피([TRP-0004-ready-lost-before-host-subscribe.md](TRP-0004-ready-lost-before-host-subscribe.md))가 안전한 근거.
- 요소 교체 시에는 controller를 새로 만든다([TRP-0001-hook-ignores-iframe-element-swap.md](TRP-0001-hook-ignores-iframe-element-swap.md)).
- jsdom은 이 동작을 검증하지 못한다. 실제 브라우저로 확인한다.

## 미확인

- Firefox 실측 안 함(로컬 Playwright용 Firefox 바이너리 없음).
