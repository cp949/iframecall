// host controller의 ready/terminate lifecycle 상태를 캡슐화한다.
// ready/terminated promise, ready timeout, terminate 멱등성, local cleanup 플래그를 한 closure에 모은다.
// in-flight 호출 정리는 onTerminate 콜백으로, transport unsubscribe 같은 외부 자원 해제는 setOnCleanup으로 주입받아 controller closure와의 순환 의존을 끊는다.

import { createIframeCallError } from "../core/errors.ts";
import type { SerializedIframeCallError } from "../core/types.ts";

/** lifecycle 생성 시 controller에서 전달하는 의존성. */
export type ControllerLifecycleOptions = {
  /** ready notify 대기 timeout. 0 또는 Infinity면 timeout을 만들지 않는다. */
  readonly readyTimeoutMs: number;

  /**
   * terminate가 처음 발생했을 때 한 번 호출된다.
   * controller는 여기서 pending/queue 같은 in-flight 호출을 일괄 reject 한다.
   */
  readonly onTerminate: (error: SerializedIframeCallError) => void;
};

/** controller에 노출되는 lifecycle 인터페이스. */
export type ControllerLifecycle = {
  /** ready notify를 기다리는 promise. terminate 시 reject 된다. */
  readonly ready: Promise<void>;

  /** terminate된 사유를 알리는 promise. dispose 후에도 한 번만 settle 된다. */
  readonly terminated: Promise<SerializedIframeCallError | null>;

  /** ready notify를 받았는지 여부. 중복 ready 검사에 사용된다. */
  isReady(): boolean;

  /** 이미 terminate 됐는지 여부. transport 라우팅 가드에 사용된다. */
  isTerminated(): boolean;

  /** terminate 사유. 아직 살아 있으면 null. */
  getTerminatedError(): SerializedIframeCallError | null;

  /** ready notify 수신 시 호출. timeout 해제와 ready resolve를 함께 처리한다. */
  markReady(): void;

  /** lifecycle을 종료한다. 두 번째 호출부터는 no-op. */
  terminate(error: SerializedIframeCallError): void;

  /**
   * cleanup callback을 주입한다. transport.subscribe 결과를 controller가 받은 뒤
   * 이 메서드로 lifecycle에 알려 순환 의존을 피한다.
   */
  setOnCleanup(fn: () => void): void;

  /** 외부 자원(transport subscription, notify handler 등)을 해제한다. 멱등하다. */
  cleanup(): void;
};

/** 새 lifecycle 인스턴스를 만든다. ready timeout은 생성 시 즉시 무장된다. */
export function createControllerLifecycle(
  options: ControllerLifecycleOptions,
): ControllerLifecycle {
  const { readyTimeoutMs, onTerminate } = options;

  let readyFlag = false;
  let terminatedError: SerializedIframeCallError | null = null;
  let cleanupDone = false;
  let onCleanup: (() => void) | null = null;

  let resolveReady!: () => void;
  let rejectReady!: (error: SerializedIframeCallError) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // ready는 rejectReady만 호출해도 unhandled rejection을 만든다.
  // terminate 진입 전에 미리 swallow해두고 실제 소비자에게는 terminated promise로 노출한다.
  ready.catch(() => {
    /* noop: rejected ready는 terminated promise로 확인한다. */
  });

  let resolveTerminated!: (error: SerializedIframeCallError | null) => void;
  const terminated = new Promise<SerializedIframeCallError | null>(
    (resolve) => {
      resolveTerminated = resolve;
    },
  );

  const readyTimeoutId =
    readyTimeoutMs === 0 || readyTimeoutMs === Number.POSITIVE_INFINITY
      ? null
      : setTimeout(() => {
          terminate(
            createIframeCallError("timeout", "Iframe ready timed out.", {
              details: { timeoutMs: readyTimeoutMs },
            }),
          );
        }, readyTimeoutMs);

  function clearReadyTimeout(): void {
    if (readyTimeoutId !== null) {
      clearTimeout(readyTimeoutId);
    }
  }

  function markReady(): void {
    if (terminatedError !== null || readyFlag) {
      return;
    }

    readyFlag = true;
    clearReadyTimeout();
    resolveReady();
  }

  function terminate(error: SerializedIframeCallError): void {
    if (terminatedError !== null) {
      return;
    }

    terminatedError = error;
    clearReadyTimeout();
    rejectReady(error);
    resolveTerminated(error);
    onTerminate(error);
    cleanup();
  }

  function cleanup(): void {
    if (cleanupDone) {
      return;
    }

    cleanupDone = true;
    onCleanup?.();
  }

  return {
    ready,
    terminated,
    isReady: () => readyFlag,
    isTerminated: () => terminatedError !== null,
    getTerminatedError: () => terminatedError,
    markReady,
    terminate,
    setOnCleanup(fn) {
      onCleanup = fn;
    },
    cleanup,
  };
}
