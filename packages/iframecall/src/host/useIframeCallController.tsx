"use client";

// host React hook. mount 시 iframe attach 후 controller를 한 번만 생성하고, unmount 시 dispose한다.
// 옵션 reference 변경은 무시되며, 새 controller가 필요하면 부모가 key prop으로 hook을 리마운트한다.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandMap,
  IframeCallController,
  IframeCallControllerBaseOptions,
  IframeCallControllerOriginOptions,
  SerializedIframeCallError,
} from "../core/types.ts";
import { consoleDebugLogger } from "./consoleDebugLogger.ts";
import { createIframeCallController } from "./controller.ts";

/** controller가 거치는 lifecycle 단계. host shell이 직접 화면에 노출하기 좋은 단계로 좁힌다. */
export type IframeCallControllerStatus =
  "pending" | "ready" | "failed" | "terminated";

/** debugLog 옵션. true면 자동 구독, prefix override 가능. false/undefined면 미구독. */
export type UseIframeCallControllerDebugLog =
  | boolean
  | {
      readonly prefix?: string;
    };

/**
 * useIframeCallController에 전달하는 옵션.
 * iframe element는 callback ref로 받으므로 controller 생성 옵션에서 제외한다.
 */
export type UseIframeCallControllerOptions<
  TCommands extends CommandMap<TCommands>,
> = IframeCallControllerOriginOptions & {
  readonly debugLog?: UseIframeCallControllerDebugLog;
} & Pick<
    IframeCallControllerBaseOptions<TCommands>,
    | "defaultTimeoutMs"
    | "generateId"
    | "logger"
    | "readyPolicy"
    | "readyQueueLimit"
    | "readyTimeoutMs"
    | "transport"
  >;

/** useIframeCallController가 반환하는 handle. mount 전에는 controller가 null이다. */
export type UseIframeCallControllerResult<
  TCommands extends CommandMap<TCommands>,
  TNotificationsFromIframe = Record<string, unknown>,
> = {
  readonly iframeRef: (node: HTMLIFrameElement | null) => void;
  readonly controller: IframeCallController<
    TCommands,
    TNotificationsFromIframe
  > | null;
  readonly status: IframeCallControllerStatus;
  readonly terminationError: SerializedIframeCallError | null;
  readonly readyError: unknown;
};

/**
 * iframecall host controller를 React lifecycle에 묶는 hook.
 * mount 시 한 번 controller를 생성하고, unmount 시 dispose한다.
 * 옵션 reference 변경은 무시되므로 호출처는 옵션을 매 render마다 새로 생성해도 안전하다.
 * 새 controller가 필요한 경우 부모 컴포넌트에서 key prop을 변경해 hook 인스턴스를 리마운트한다.
 */
export function useIframeCallController<
  TCommands extends CommandMap<TCommands>,
  TNotificationsFromIframe = Record<string, unknown>,
>(
  options: UseIframeCallControllerOptions<TCommands>,
): UseIframeCallControllerResult<TCommands, TNotificationsFromIframe> {
  // 옵션은 mount 시 한 번만 사용한다. ref로 보관해 effect dependency에서 제외한다.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const iframeElRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeAttached, setIframeAttached] = useState(false);

  const [controller, setController] = useState<IframeCallController<
    TCommands,
    TNotificationsFromIframe
  > | null>(null);
  const [status, setStatus] = useState<IframeCallControllerStatus>("pending");
  const [terminationError, setTerminationError] =
    useState<SerializedIframeCallError | null>(null);
  const [readyError, setReadyError] = useState<unknown>(null);
  const controllerRef = useRef<IframeCallController<
    TCommands,
    TNotificationsFromIframe
  > | null>(null);

  const iframeRef = useCallback((node: HTMLIFrameElement | null) => {
    iframeElRef.current = node;
    setIframeAttached(node !== null);
  }, []);

  useEffect(() => {
    if (!iframeAttached) return;
    if (controllerRef.current !== null) return;
    const iframeEl = iframeElRef.current;
    if (iframeEl === null) return;

    // mount 시점의 옵션 snapshot으로 controller를 만든다.
    const opts = optionsRef.current;
    const next = createIframeCallController<TCommands>({
      iframe: iframeEl,
      ...pickOriginOptions(opts),
      defaultTimeoutMs: opts.defaultTimeoutMs,
      generateId: opts.generateId,
      logger: opts.logger,
      readyPolicy: opts.readyPolicy,
      readyQueueLimit: opts.readyQueueLimit,
      readyTimeoutMs: opts.readyTimeoutMs,
      transport: opts.transport,
    });
    const controller = next as IframeCallController<
      TCommands,
      TNotificationsFromIframe
    >;
    controllerRef.current = controller;

    // effect cleanup 이후 도착하는 promise resolve가 stale React state를 건드리지 않게 한다.
    let cancelled = false;

    // ref가 이번 effect가 생성한 controller일 때만 mount state를 초기화한다.
    // StrictMode cleanup/re-run 또는 iframe 재연결에서 이전 lifecycle이 state를 덮어쓰지 않는다.
    if (controllerRef.current === controller) {
      setController(controller);
      setStatus("pending");
      setTerminationError(null);
      setReadyError(null);
    }

    next.ready.then(
      () => {
        if (cancelled) return;
        setStatus("ready");
      },
      (error: unknown) => {
        if (cancelled) return;
        setReadyError(error);
        setStatus((prev) => (prev === "terminated" ? prev : "failed"));
      },
    );

    next.terminated.then((reason) => {
      if (cancelled) return;
      setTerminationError(reason);
      setStatus("terminated");
    });

    // debugLog 옵션이 truthy면 콘솔 subscriber를 mount 동안 자동 등록한다.
    let unsubscribeDebug: (() => void) | null = null;
    const debugLog = opts.debugLog;
    if (debugLog) {
      const prefix =
        typeof debugLog === "object" && debugLog !== null
          ? debugLog.prefix
          : undefined;
      const handler = consoleDebugLogger(
        prefix !== undefined ? { prefix } : undefined,
      );
      unsubscribeDebug = next.debug.subscribe(handler);
    }

    return () => {
      cancelled = true;
      if (unsubscribeDebug !== null) {
        unsubscribeDebug();
      }
      void next.dispose("host-unmount");
      if (controllerRef.current === controller) controllerRef.current = null;
      setController(null);
    };
  }, [iframeAttached]);

  return {
    iframeRef,
    controller,
    status,
    terminationError,
    readyError,
  };
}

/**
 * hook 옵션에서 origin 정책 필드만 골라 controller로 넘긴다.
 * 충돌 검증(opaqueOrigin + targetOrigin 등)은 controller가 담당하므로 값을 걸러내지 않고 그대로 전달한다.
 */
function pickOriginOptions(
  opts: IframeCallControllerOriginOptions,
): IframeCallControllerOriginOptions {
  return {
    opaqueOrigin: opts.opaqueOrigin,
    targetOrigin: opts.targetOrigin,
    allowedOrigins: opts.allowedOrigins,
  } as IframeCallControllerOriginOptions;
}
