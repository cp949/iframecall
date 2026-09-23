# `useIframeCallController`는 iframe 요소 교체를 감지하지 않는다

발견: 2026-09-23, opaque origin handoff 검토 중 임시 테스트로 확인.

## 증상

- `<iframe key={n}>`의 key를 바꿔 요소를 교체해도 controller는 그대로다.
- 교체 후 `invoke`가 오류 없이 응답을 못 받는다(post가 떼어낸 요소의 `contentWindow === null`로 조용히 유실).

## 원인

사실:

- ref callback이 한 commit 안에서 `setIframeAttached(false)` → `setIframeAttached(true)`를 호출한다. batch되어 최종 값이 `true`로 동일하다.
- effect deps `[iframeAttached]`가 변하지 않아 controller 재생성 effect가 돌지 않는다.
- controller(기본 transport)는 생성 시점 요소와 `contentWindow`에 묶인다.

## 계약 / 회피

hook을 소유한 컴포넌트 자체를 `key`로 리마운트한다. iframe에만 key를 주면 안 된다.

```tsx
<SandboxFrame key={runId} /> // 내부에서 useIframeCallController + <iframe ref={iframeRef}>
```

리마운트 시 이전 controller는 `host-unmount`로 dispose되어 대기 요청이 `terminated`로 reject되고, 새 controller는 이전 window의 늦은 메시지를 source 검사로 버린다. (단위 테스트 `useIframeCallController.test.tsx`, Chromium 데모로 확인)

runo-lab 범주 B의 Stop(iframe 요소 재생성)이 이 경우다.
