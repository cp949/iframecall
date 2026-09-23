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

| peer           | 지원 버전              |
| -------------- | ---------------------- |
| `react`        | `^18.0.0 \|\| ^19.0.0` |
| `@types/react` | `^18.0.0 \|\| ^19.0.0` |

## 진입점

| import                     | 용도                                              |
| -------------------------- | ------------------------------------------------- |
| `@cp949/iframecall/host`   | 부모 페이지(host)에서 iframe을 제어할 때          |
| `@cp949/iframecall/iframe` | 임베드된 페이지(iframe)에서 host의 호출을 받을 때 |

호스트와 iframe은 서로 다른 origin에서 실행되며, 각 진입점은 그쪽에서만 필요한 API와 타입만 노출한다.

## 빠른 시작

### 1. 공유 타입 정의

host와 iframe 양쪽에서 동일하게 사용할 커맨드와 알림 타입을 정의한다.

```ts
type AppCommands = {
  greet(name: string): Promise<string>;
  add(a: number, b: number): Promise<number>;
  delay(ms: number): Promise<void>;
};

type AppNotifications = {
  "status-changed": "idle" | "processing";
};
```

> 라이프사이클(`ready` / `terminated`)과 도메인 알림은 채널을 분리한다. 도메인 페이로드에 `"ready"`를 넣지 않는다 — `ready`는 transport가 살아 있다는 라이프사이클 신호 전용이다.

> 별도 공유 패키지 없이 양쪽에 같은 타입을 두는 패턴을 권장한다. 모노레포라면 공통 패키지로 빼도 된다.

### 2. host 측 (부모 페이지)

```tsx
"use client";

import { useIframeCallController } from "@cp949/iframecall/host";
import { useEffect } from "react";

const IFRAME_ORIGIN = "https://iframe.example.com";

export function HostPage() {
  const { iframeRef, controller, status } = useIframeCallController<
    AppCommands,
    AppNotifications
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
    const result = await controller.invoke("greet", ["World"]);
    console.log(result); // "Hello, World!"
  };

  return (
    <div>
      <p>status: {status}</p>
      <button type="button" onClick={handleGreet} disabled={status !== "ready"}>
        Greet
      </button>
      <iframe ref={iframeRef} src={IFRAME_ORIGIN} title="iframe demo" />
    </div>
  );
}
```

### 3. iframe 측 (임베드된 페이지)

커맨드 구현은 클래스로 정의한다. 생성자는 `iframeHelper`를 인자로 받으며, prototype에 둔 메서드 이름이 곧 커맨드 이름이 된다.

prefix 컨벤션:

| prefix | 의미                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------- |
| (없음) | host로 dispatch되는 remote command                                                                   |
| `_`    | 사용자 local-only 메서드. dispatch 대상에서 제외된다. (예: `_sendLifecycleReady`, `_onStatusChange`) |
| `$`    | 라이브러리 점유 namespace. dispatch에서 제외되며, 라이브러리가 정의한 hook 이름만 의미가 있다.       |

현재 라이브러리가 인식하는 hook은 한 개:

- `$onCommandRun(cmd, args, invoke)` — 매 command dispatch를 wrap한다. `await invoke()`를 try/finally로 감싸 상태 토글·로깅·refcount 등을 한 곳에서 처리한다.

```tsx
"use client";

import {
  type IframeHelper,
  useIframeCallRunner,
} from "@cp949/iframecall/iframe";
import { useEffect } from "react";

const HOST_ORIGIN = "https://host.example.com";

type RunningStatus = "idle" | "processing";

// 클래스 자체가 곧 command 타입이다. 별도 interface를 두지 않는다.
// `_` prefix는 사용자 local-only(dispatch 제외), `$` prefix는 라이브러리 namespace.
class AppCommands {
  private status: RunningStatus = "idle";
  private inflight = 0;
  private listeners = new Set<(s: RunningStatus) => void>();

  constructor(private iframeHelper: IframeHelper<AppNotifications>) {}

  _sendLifecycleReady(): void {
    this.iframeHelper.sendLifecycleReady();
  }

  _onStatusChange(fn: (s: RunningStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // 모든 command를 wrap. 동시 dispatch에서 안쪽 호출이 끝나기 전에 idle로 떨어지지 않도록 refcount.
  async $onCommandRun(
    _cmd: string,
    _args: readonly unknown[],
    invoke: () => Promise<unknown>,
  ): Promise<unknown> {
    this.inflight += 1;
    if (this.inflight === 1) this._setStatus("processing");
    try {
      return await invoke();
    } finally {
      this.inflight -= 1;
      if (this.inflight === 0) this._setStatus("idle");
    }
  }

  private _setStatus(next: RunningStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.iframeHelper.sendNotificationToHost("status-changed", next);
    for (const fn of this.listeners) fn(next);
  }

  async greet(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }

  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}

export function IframePage() {
  const { iframeHelper, commands, isActive } = useIframeCallRunner<
    AppCommands,
    AppNotifications
  >({
    targetOrigin: HOST_ORIGIN,
    allowedOrigins: [HOST_ORIGIN],
    Commands: AppCommands,
  });

  useEffect(() => {
    if (!iframeHelper || !commands) return;
    commands._sendLifecycleReady();
    return commands._onStatusChange((s) => {
      console.log("local status:", s);
    });
  }, [iframeHelper, commands]);

  return <p>{isActive ? "active" : "initializing"}</p>;
}
```

## 동작 흐름

```text
host                                    iframe
  │                                       │
  │  <iframe src="...">                   │
  │──────────────────────────────────────▶│ mount
  │                                       │ commands._sendLifecycleReady() → sendLifecycleReady()
  │  ◀── ready ───────────────────────────│  (lifecycle 채널)
  │  controller.status = "ready"          │
  │                                       │
  │  controller.invoke("greet", ["World"])│
  │  ── request ─────────────────────────▶│ $onCommandRun → AppCommands.greet("World")
  │  ◀── notify status-changed:processing │  (도메인 채널, refcount 0→1)
  │  ◀── response: "Hello, World!" ───────│
  │  ◀── notify status-changed:idle ──────│  (도메인 채널, refcount 1→0)
```

- iframe이 마운트되면 `commands._sendLifecycleReady()`가 `sendLifecycleReady()`를 통해 transport ready 신호를 보낸다.
- host의 `controller.invoke`는 ready 시점까지 대기한 뒤 전송된다.
- **iframe `src`는 controller가 생긴 뒤 설정한다.** controller는 생성 시점에 `message` listener를 등록하고, iframe은 ready를 한 번만 보낸다. SSR된 `<iframe src>`처럼 iframe이 host hydration보다 먼저 로드되면 ready가 유실되어 `status`가 `pending`에 머문다. 같은 요소의 `src` 변경은 `contentWindow` identity를 유지하므로 source 검사에 영향이 없다.

  ```tsx
  <iframe ref={iframeRef} src={controller ? IFRAME_URL : undefined} />
  ```

- 응답은 Promise로 돌아오며, iframe 측 메서드가 throw하면 host 쪽 Promise는 reject된다.
- iframe → host 단방향 알림은 `sendNotificationToHost`로 보내고, host 쪽에서 `controller.onNotificationFromIframe`으로 받는다.
- **라이프사이클 채널과 도메인 채널은 책임이 다르다.** `ready`/`terminated`는 transport 신호 전용이고, 도메인 알림(`status-changed` 등)에는 `"ready"` 같은 lifecycle 의미를 담지 않는다.
- prototype에 `$onCommandRun(cmd, args, invoke)`을 두면 모든 command dispatch가 그 함수로 wrap된다. status 토글·로깅·refcount 같은 횡단 관심사를 한 곳에서 처리할 수 있다.

## API 개요

### host 진입점

| export                        | 종류    | 설명                                                             |
| ----------------------------- | ------- | ---------------------------------------------------------------- |
| `useIframeCallController`     | hook    | host용 React 훅. `iframeRef`, `controller`, `status`를 반환한다. |
| `createIframeCallController`  | factory | 훅 없이 컨트롤러를 직접 만들 때 사용                             |
| `createIframeWindowTransport` | factory | 커스텀 트랜스포트 구성용                                         |
| `consoleDebugLogger`          | util    | 디버그 이벤트를 콘솔에 출력하는 로거                             |

훅이 반환하는 `controller`의 주요 멤버:

- `controller.invoke(command, args, options?)` — iframe의 커맨드 호출, 결과를 Promise로 반환
- `controller.call(command, args, options?)` — deprecated 호환 alias. `invoke`를 사용하세요.
- `controller.onNotificationFromIframe(event, handler)` — iframe이 보내는 알림 구독, unsubscribe 함수 반환
- `controller.ready` — iframe ready 신호 대기용 Promise
- `controller.terminated` — 종료 사유를 노출하는 Promise (정상 dispose면 `null`)
- `controller.debug.subscribe(handler)` — 송수신 이벤트 디버그 스트림 구독
- `controller.dispose(reason?)` — 명시적 정리 (훅을 쓰면 자동 호출됨)

### iframe 진입점

| export                        | 종류    | 설명                                                                                                               |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `useIframeCallRunner`         | hook    | iframe용 React 훅. `commands`, `iframeHelper`, `isActive`를 반환한다. mount 전 `commands`/`iframeHelper`는 `null`. |
| `createIframeCallRunner`      | factory | 훅 없이 러너를 직접 만들 때 사용                                                                                   |
| `createParentWindowTransport` | factory | 커스텀 트랜스포트 구성용                                                                                           |

`iframeHelper`의 주요 멤버:

- `iframeHelper.sendNotificationToHost(event, payload)` — host로 도메인 알림 전송 (lifecycle 예약 이름 `ready`/`terminated`는 타입에서 제외)
- `iframeHelper.sendLifecycleReady()` — host에 transport lifecycle ready 신호 전송. 도메인 알림과는 채널이 다르다.
- `iframeHelper.debug.subscribe(handler)` — 디버그 스트림 구독

**Commands class prefix 컨벤션:**

- prefix 없는 prototype 메서드 → host에서 호출 가능한 remote command
- `_` prefix → 사용자 local-only (dispatch 제외)
- `$` prefix → 라이브러리 namespace (dispatch 제외, 인식되는 hook은 `$onCommandRun`)

`onStatusChange`처럼 prefix가 없으면서 host에서 호출하면 안 되는 메서드는 반드시 `_` prefix를 붙여야 한다. 그렇지 않으면 host가 `controller.invoke("onStatusChange", [...])`로 직접 호출할 수 있다.

> 알림은 iframe → host 단방향이다. host → iframe 알림은 라이브러리 외부에서 `postMessage`로 직접 처리하거나, host에서 커맨드를 호출해 처리한다.

### 공통 타입

`CommandMap`, `IframeCallController`, `IframeCallRunnerHandle`, `IframeCallTransport`, `ReadyPolicy`, `SerializedIframeCallError` 등 핵심 타입은 `host`/`iframe` 양쪽에서 모두 export된다.

## 보안: origin 검증

`targetOrigin`과 `allowedOrigins`는 반드시 명시적으로 지정한다. 와일드카드(`*`)는 사용하지 않는다.

| 옵션             | 의미                                      |
| ---------------- | ----------------------------------------- |
| `targetOrigin`   | `postMessage` 전송 시 사용할 대상 origin  |
| `allowedOrigins` | 수신 시 허용할 origin 화이트리스트 (배열) |

수신 메시지의 `event.origin`이 화이트리스트에 없으면 무시된다. host의 기본 transport는 `event.source`가 대상 iframe의 `contentWindow`인지도 함께 검사한다.

`targetOrigin`에 `""`, `"*"`, `"null"`을 넘기면 `invalid_origin` 에러를 던진다. origin이 `"null"`인 iframe은 아래 opaque origin 모드를 사용한다.

### opaque origin iframe (`sandbox`)

`sandbox="allow-scripts"`처럼 `allow-same-origin` 없이 띄운 iframe은 origin이 `"null"`이라 명시적인 `targetOrigin`으로 메시지를 보낼 수 없다. host에서 `opaqueOrigin: true`로 opt-in한다.

```tsx
const { iframeRef, controller, status } = useIframeCallController<AppCommands>({
  opaqueOrigin: true,
});

return <iframe ref={iframeRef} sandbox="allow-scripts" srcDoc={runnerHtml} />;
```

이 모드의 동작:

- 송신: 내부적으로 `targetOrigin="*"`로 보낸다. 대상은 해당 iframe의 `contentWindow`뿐이다.
- 수신: `event.origin === "null"` **그리고** `event.source === contentWindow`일 때만 받는다.
- 생성 시 거부(`invalid_origin`):
  - `targetOrigin` 또는 `allowedOrigins`를 함께 지정한 경우. 타입에서도 거부한다.
  - iframe이 문서에 붙지 않아 `contentWindow`가 없는 경우, 또는 커스텀 `transport`에 `expectedSource`가 없는 경우.

보안 근거:

- **source 비교가 필수인 이유**: origin `"null"`은 다른 사이트의 모든 sandboxed frame이 공유하는 값이다. origin만으로는 대상 iframe과 다른 opaque frame을 구별할 수 없다. 그래서 이 모드는 source를 비교할 수 없는 설정을 생성 시점에 거부한다.
- **source 검사는 iframe 요소를 인증할 뿐 문서를 인증하지 않는다**: `sandbox="allow-scripts"`는 iframe 문서가 자기 자신을 navigation하는 것(`location.href = ...`)을 막지 않는다. 이동한 문서도 sandbox flag를 이어받아 origin이 `"null"`이고, 같은 요소라 `contentWindow`도 같다. 따라서 그 문서는 host의 origin·source 검사를 모두 통과하고, `"*"`로 보낸 command와 인자를 받으며, 응답과 notify를 보낼 수 있다. (headless Chromium에서 확인)
- **수용 조건**: 위 위험은 iframe 안에서 신뢰하지 않는 코드가 돌지 않을 때만 수용할 수 있다. 이 경우 `src`/`srcdoc`는 host가 통제하므로 iframe이 모르는 문서로 이동하지 않는다.
- **신뢰하지 않는 코드를 실행하는 iframe**(사용자 코드 실행 샌드박스 등)에서는 채널 전체를 신뢰하지 않는 상대로 취급한다. command 인자에 비밀이나 권한 토큰을 넣지 않고, 응답과 notify는 host에서 검증한다. 이 경우 iframe 안의 코드는 navigation 없이도 채널을 이미 제어할 수 있다. navigation은 그 제어를 iframe 밖의 문서로 넘기는 경로를 하나 더 만든다.

iframe 쪽 runner는 바꿀 필요가 없다. parent(host)는 일반 origin이므로 runner는 지금처럼 `targetOrigin: HOST_ORIGIN`을 명시한다.

### iframe 요소 교체

controller는 iframe 요소 하나에 묶인다. 같은 요소의 `src` 변경은 `contentWindow` identity를 유지하지만, 요소 자체를 새로 만들면 `contentWindow`가 달라진다. 훅은 요소 교체를 감지하지 않으므로, 요소를 교체할 때는 훅을 소유한 컴포넌트를 `key`로 리마운트한다.

```tsx
<SandboxFrame key={runId} />
```

리마운트하면 이전 controller가 dispose되어 대기 중인 요청이 `terminated`로 reject되고, 새 controller는 이전 window에서 늦게 도착한 메시지를 source 검사로 버린다.

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

opaque origin 모드 데모는 `http://localhost:3300/opaque`다. iframe-r19 앱을 `sandbox="allow-scripts"`로 띄운다. Next.js dev server는 origin `"null"` 문서의 `/_next` 리소스 요청을 cross-origin으로 차단하므로 iframe 앱은 production 모드로 실행한다.

```sh
pnpm build
pnpm --filter iframe-r19 exec next start --port 3301
pnpm --filter host-r19 dev
```

## 라이선스

MIT
