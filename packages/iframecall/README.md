# @cp949/iframecall

타입 안전한 host ↔ iframe `postMessage` 호출 라이브러리. host에서 iframe의 메서드를 함수처럼 호출하고, iframe에서 host로 알림(notification)을 보낼 수 있다. React 18/19 모두 지원한다.

- 양방향 통신: host → iframe RPC 호출, iframe → host 알림
- 타입 안전: 커맨드 시그니처와 알림 페이로드를 제네릭으로 고정
- React 훅 제공: `useIframeCallController` (host), `useIframeCallRunner` (iframe)
- ESM 전용, 브라우저 환경 전용
- origin 화이트리스트와 ready 핸드셰이크 내장

## 설치

```sh
pnpm add @cp949/iframecall
# 또는
npm install @cp949/iframecall
# 또는
yarn add @cp949/iframecall
```

`react`, `@types/react`는 peer dependency이다. 프로젝트에 이미 설치되어 있어야 한다.

| peer | 지원 버전 |
|------|-----------|
| `react` | `^18.0.0 \|\| ^19.0.0` |
| `@types/react` | `^18.0.0 \|\| ^19.0.0` |

## 진입점

| import | 용도 |
|--------|------|
| `@cp949/iframecall/host` | 부모 페이지(host)에서 iframe을 제어할 때 |
| `@cp949/iframecall/iframe` | 임베드된 페이지(iframe)에서 host의 호출을 받을 때 |

호스트와 iframe은 서로 다른 origin에서 실행되며, 각 진입점은 그쪽에서만 필요한 API와 타입만 노출한다.

## 빠른 시작

### 1. 공유 타입 정의

host와 iframe 양쪽에서 동일하게 사용할 커맨드와 알림 타입을 정의한다.

```ts
type DemoCommands = {
  greet(name: string): Promise<string>;
  add(a: number, b: number): Promise<number>;
  delay(ms: number): Promise<void>;
};

type DemoEvents = {
  "status-changed": string;
};
```

> 별도 공유 패키지 없이 양쪽에 같은 타입을 두는 패턴을 권장한다. 모노레포라면 공통 패키지로 빼도 된다.

### 2. host 측 (부모 페이지)

```tsx
"use client";

import { useIframeCallController } from "@cp949/iframecall/host";
import { useEffect } from "react";

const IFRAME_ORIGIN = "https://iframe.example.com";

export function HostPage() {
  const { iframeRef, controller, status } = useIframeCallController<
    DemoCommands,
    DemoEvents
  >({
    targetOrigin: IFRAME_ORIGIN,
    allowedOrigins: [IFRAME_ORIGIN],
  });

  useEffect(() => {
    if (!controller) return;
    return controller.onNotificationFromIframe("status-changed", (payload) => {
      console.log("iframe status:", payload);
    });
  }, [controller]);

  const handleGreet = async () => {
    if (!controller) return;
    const result = await controller.call("greet", ["World"]);
    console.log(result); // "Hello, World!"
  };

  return (
    <div>
      <p>status: {status}</p>
      <button type="button" onClick={handleGreet} disabled={status !== "ready"}>
        Greet
      </button>
      <iframe
        ref={iframeRef}
        src={IFRAME_ORIGIN}
        title="iframe demo"
      />
    </div>
  );
}
```

### 3. iframe 측 (임베드된 페이지)

커맨드 구현은 클래스로 정의한다. 생성자는 `iframeHelper`를 인자로 받으며, 메서드 이름이 곧 커맨드 이름이 된다.

```tsx
"use client";

import {
  type IframeHelper,
  useIframeCallRunner,
} from "@cp949/iframecall/iframe";
import { useEffect } from "react";

const HOST_ORIGIN = "https://host.example.com";

class DemoCommandsImpl {
  constructor(private iframeHelper: IframeHelper<DemoEvents>) {}

  async greet(name: string): Promise<string> {
    this.iframeHelper.sendNotificationToHost("status-changed", "processing");
    const result = `Hello, ${name}!`;
    this.iframeHelper.sendNotificationToHost("status-changed", "idle");
    return result;
  }

  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function IframePage() {
  const { iframeHelper, isActive } = useIframeCallRunner<
    DemoCommands,
    DemoEvents
  >({
    targetOrigin: HOST_ORIGIN,
    allowedOrigins: [HOST_ORIGIN],
    Commands: DemoCommandsImpl,
  });

  useEffect(() => {
    if (!iframeHelper) return;
    iframeHelper.sendNotificationToHost("status-changed", "ready");
    iframeHelper.sendReadyToHost();
  }, [iframeHelper]);

  return <p>{isActive ? "active" : "initializing"}</p>;
}
```

## 동작 흐름

```text
host                                    iframe
  │                                       │
  │  <iframe src="...">                   │
  │──────────────────────────────────────▶│ mount
  │                                       │ sendReadyToHost()
  │  ◀── ready ───────────────────────────│
  │  controller.status = "ready"          │
  │                                       │
  │  controller.call("greet", ["World"])  │
  │  ── request ─────────────────────────▶│ DemoCommandsImpl.greet("World")
  │  ◀── response: "Hello, World!" ───────│
  │                                       │
  │  ◀── notify "status-changed" ─────────│ sendNotificationToHost(...)
```

- iframe이 마운트되면 `sendReadyToHost()`로 준비 신호를 보낸다.
- host의 `controller.call`은 ready 시점까지 대기한 뒤 전송된다 (기본 `ReadyPolicy: "wait"`).
- 응답은 Promise로 돌아오며, iframe 측 메서드가 throw하면 host 쪽 Promise는 reject된다.
- iframe → host 단방향 알림은 `sendNotificationToHost`로 보내고, host 쪽에서 `controller.onNotificationFromIframe`으로 받는다.

## API 개요

### host 진입점

| export | 종류 | 설명 |
|--------|------|------|
| `useIframeCallController` | hook | host용 React 훅. `iframeRef`, `controller`, `status`를 반환한다. |
| `createIframeCallController` | factory | 훅 없이 컨트롤러를 직접 만들 때 사용 |
| `createIframeWindowTransport` | factory | 커스텀 트랜스포트 구성용 |
| `consoleDebugLogger` | util | 디버그 이벤트를 콘솔에 출력하는 로거 |

훅이 반환하는 `controller`의 주요 멤버:

- `controller.call(command, args, options?)` — iframe의 커맨드 호출, 결과를 Promise로 반환
- `controller.onNotificationFromIframe(event, handler)` — iframe이 보내는 알림 구독, unsubscribe 함수 반환
- `controller.ready` — iframe ready 신호 대기용 Promise
- `controller.terminated` — 종료 사유를 노출하는 Promise (정상 dispose면 `null`)
- `controller.debug.subscribe(handler)` — 송수신 이벤트 디버그 스트림 구독
- `controller.dispose(reason?)` — 명시적 정리 (훅을 쓰면 자동 호출됨)

### iframe 진입점

| export | 종류 | 설명 |
|--------|------|------|
| `useIframeCallRunner` | hook | iframe용 React 훅. `iframeHelper`, `isActive`를 반환한다. |
| `createIframeCallRunner` | factory | 훅 없이 러너를 직접 만들 때 사용 |
| `createParentWindowTransport` | factory | 커스텀 트랜스포트 구성용 |

`iframeHelper`의 주요 멤버:

- `iframeHelper.sendNotificationToHost(event, payload)` — host로 알림 전송 (lifecycle 예약 이름 `ready`/`terminated`는 제외)
- `iframeHelper.sendReadyToHost()` — host에 ready 신호 전송
- `iframeHelper.debug.subscribe(handler)` — 디버그 스트림 구독

> 알림은 iframe → host 단방향이다. host → iframe 알림은 라이브러리 외부에서 `postMessage`로 직접 처리하거나, host에서 커맨드를 호출해 처리한다.

### 공통 타입

`CommandMap`, `IframeCallController`, `IframeCallRunnerHandle`, `IframeCallTransport`, `ReadyPolicy`, `SerializedIframeCallError` 등 핵심 타입은 `host`/`iframe` 양쪽에서 모두 export된다.

## 보안: origin 검증

`targetOrigin`과 `allowedOrigins`는 반드시 명시적으로 지정한다. 와일드카드(`*`)는 사용하지 않는다.

| 옵션 | 의미 |
|------|------|
| `targetOrigin` | `postMessage` 전송 시 사용할 대상 origin |
| `allowedOrigins` | 수신 시 허용할 origin 화이트리스트 (배열) |

수신 메시지의 `event.origin`이 화이트리스트에 없으면 무시된다.

## 디버깅

훅 옵션에 `debugLog: true`를 주면 송수신 이벤트가 콘솔에 출력된다. 또는 `consoleDebugLogger`를 직접 전달할 수도 있다.

```ts
useIframeCallController({
  targetOrigin: IFRAME_ORIGIN,
  allowedOrigins: [IFRAME_ORIGIN],
  debugLog: true,
});
```

세밀한 제어가 필요하면 `controller.debug.subscribe` / `iframeHelper.debug.subscribe`로 이벤트 스트림을 직접 구독한다.

## 데모

레포에는 동일 시나리오를 React 18/19로 각각 구현한 4개 데모 앱이 있다.

```sh
# React 19 한 쌍 (host: 3300, iframe: 3301)
pnpm dev:r19

# React 18 한 쌍 (host: 3302, iframe: 3303)
pnpm dev:r18
```

## 라이선스

MIT
