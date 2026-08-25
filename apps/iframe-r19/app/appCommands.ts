/**
 * iframe 측 Commands 클래스 모듈.
 *
 * 라이브러리(useIframeCallRunner / createIframeCallRunner)가 이 클래스를 받아
 * `new AppCommands(iframeHelper)`로 한 번 인스턴스화한다. prototype에 정의된 메서드 중
 * prefix가 없는 것을 host에서 호출 가능한 remote command로 노출하고,
 * `$` prefix는 라이브러리 hook으로 인식한다.
 *
 * prefix 컨벤션:
 * - prefix 없음 → host에서 `controller.invoke(name, args)`로 호출 가능한 remote command
 * - `_` prefix  → 사용자 local-only (dispatch 제외, 컴포넌트가 직접 호출)
 * - `$` prefix  → 라이브러리 점유 namespace (dispatch 제외, 인식되는 hook은 `$onCommandRun` 한 개)
 *
 * 그 밖에 instance field 함수, accessor(get/set), static method, symbol-key, `host:dispose`도
 * 라이브러리가 자동으로 dispatch 대상에서 제외한다.
 */
import type { IframeHelper } from "@cp949/iframecall/iframe";

/**
 * 이 데모가 host로 흘려보내는 실행 상태 값.
 */
export type RunningStatus = "idle" | "processing";

/**
 * iframe → host 단방향 notification map.
 * 키 = event 이름, 값 = payload 타입.
 *
 * 라이브러리는 이 map을 generic으로 받아 `sendNotificationToHost`/`onNotificationFromIframe`의
 * 키와 payload 타입을 추론한다. lifecycle 예약 이름(`ready`/`terminated`)은 라이브러리가 자동 제외하므로
 * 여기에 넣지 않는다.
 */
export type AppNotifications = {
  "status-changed": RunningStatus;
};

export class AppCommands {
  // ──────────────────────────────────────────────────────────
  // private 인스턴스 상태 (private 키워드라 라이브러리 dispatch 대상이 아님)
  // ──────────────────────────────────────────────────────────

  /** 현재 status. 같은 값으로 중복 알림을 보내지 않기 위해 보관한다. */
  private status: RunningStatus = "idle";

  /**
   * 진행 중인 command 개수.
   * 동시 dispatch에서 안쪽 호출이 끝나기 전에 idle로 떨어지지 않도록 refcount로 관리한다.
   */
  private inflight = 0;

  /** `_onStatusChange`로 등록된 local subscriber 집합. */
  private listeners = new Set<(s: RunningStatus) => void>();

  /**
   * **라이브러리 필수.** runner가 `new AppCommands(iframeHelper)`로 호출한다.
   * `iframeHelper`는 host로 알림/lifecycle 신호를 보낼 때 사용한다 — 인스턴스 어딘가에 보관해 둘 것.
   *
   * (constructor를 직접 정의하지 않으면 JS 기본 constructor가 helper를 무시하므로
   *  iframeHelper에 접근할 수 없게 된다.)
   */
  constructor(private iframeHelper: IframeHelper<AppNotifications>) {}

  // ──────────────────────────────────────────────────────────
  // `_` prefix — 사용자 local-only 메서드 (라이브러리는 dispatch에서 자동 제외)
  // ──────────────────────────────────────────────────────────

  /**
   * **선택적 — 사용자 패턴.** transport lifecycle ready 신호를 host로 한 번 보낸다.
   * 보통 컴포넌트가 mount 직후 한 번 호출한다. 이 신호가 도착해야 host의 `controller.invoke`가 풀린다.
   *
   * 본질적으로 `iframeHelper.sendLifecycleReady()` 한 줄 wrap이라 컴포넌트에서 직접 호출해도 무방하다.
   * 클래스에 두면 (1) 호출 의도 명시, (2) 추가 초기화를 함께 묶을 수 있다는 장점이 있다.
   */
  _sendLifecycleReady(): void {
    this.iframeHelper.sendLifecycleReady();
  }

  /**
   * **선택적 — 사용자 패턴.** local status 변화를 컴포넌트가 구독하기 위한 편의 메서드.
   * unsubscribe 함수를 반환한다.
   *
   * 라이브러리가 강제하는 인터페이스는 아니며, host로 가는 notification과는 별개로
   * 같은 iframe 안 React state로 status를 끌어올릴 때 쓴다.
   */
  _onStatusChange(fn: (s: RunningStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // ──────────────────────────────────────────────────────────
  // `$` prefix — 라이브러리 hook (라이브러리가 prototype에서 직접 lookup 한다)
  // ──────────────────────────────────────────────────────────

  /**
   * **선택적 — 라이브러리가 인식하는 wrap hook.** 정의되어 있으면 라이브러리가 매 command dispatch를
   * `await $onCommandRun(cmd, args, invoke)` 형태로 wrap한다. 없으면 라이브러리가 handler를 직접 await 한다.
   *
   * `invoke()`는 실제 command body를 호출하는 thunk다. try/finally로 감싸 status 토글·로깅·refcount 같은
   * 횡단 관심사를 한 곳에서 처리한다.
   *
   * 여기서는 동시 dispatch에서 첫 호출 진입 시 processing, 마지막 종료 시 idle로 status를 토글한다.
   * inflight refcount로 안쪽 호출이 끝나기 전에 idle로 떨어지지 않도록 보장한다.
   *
   * (이 hook은 host에서 호출할 수 없다 — `$` prefix가 dispatch에서 제외되기 때문.)
   */
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

  /**
   * 내부 status 갱신 헬퍼. status 변경 시 host로 알림을 보내고 local subscriber에도 통지한다.
   * `_` prefix로 dispatch에서 제외된다.
   */
  private _setStatus(next: RunningStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.iframeHelper.sendNotificationToHost("status-changed", next);
    for (const fn of this.listeners) fn(next);
  }

  // ──────────────────────────────────────────────────────────
  // prefix 없음 — host에서 호출 가능한 remote command (사용자 도메인에 맞춰 자유롭게 정의)
  // ──────────────────────────────────────────────────────────
  //
  // 라이브러리는 이 영역의 메서드 개수/이름을 강제하지 않는다. 0개여도 동작은 정상.
  // host 쪽에서 type generic으로 잡은 command 시그니처와만 일치하면 된다.
  // args와 return은 structured clone 가능해야 한다 (함수, DOM 노드, 클래스 인스턴스 등은 보낼 수 없음).

  /**
   * **사용자 도메인 메서드.** host의 `controller.invoke("greet", ["World"])`로 호출된다.
   * 인사말 문자열을 돌려주는 단순 데모 command.
   */
  async greet(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }

  /**
   * **사용자 도메인 메서드.** 두 수의 합을 반환한다.
   * 동기 결과를 Promise로 감싸 비동기 시그니처를 유지한다.
   */
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  /**
   * **사용자 도메인 메서드.** 지정된 ms 동안 대기한다.
   * 비동기 wait 동안 status가 processing으로 유지되는지 확인하는 데모 command.
   */
  async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
