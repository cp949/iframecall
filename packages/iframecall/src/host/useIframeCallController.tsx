"use client";

// host React hook. mount 시 iframe attach 후 controller를 한 번만 생성하고, unmount 시 dispose한다.
// 옵션 reference 변경은 무시되며, 새 controller가 필요하면 부모가 key prop으로 hook을 리마운트한다.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandMap,
  IframeCallController,
  IframeCallControllerOptions,
  SerializedIframeCallError,
} from "../core/types.ts";
import { consoleDebugLogger } from "./consoleDebugLogger.ts";
import { createIframeCallController } from "./controller.ts";

/** controller가 거치는 lifecycle 단계. host shell이 직접 화면에 노출하기 좋은 단계로 좁힌다. */
export type IframeCallControllerStatus =
  | "pending"
  | "ready"
  | "failed"
  | "terminated";

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
> = {
  readonly targetOrigin: string;
  readonly debugLog?: UseIframeCallControllerDebugLog;
} & Pick<
  IframeCallControllerOptions<TCommands>,
  | "allowedOrigins"
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

  const iframeRef = useCallback((node: HTMLIFrameElement | null) => {
    iframeElRef.current = node;
    setIframeAttached(node !== null);
  }, []);

  useEffect(() => {
    if (!iframeAttached) return;
    const iframeEl = iframeElRef.current;
    if (iframeEl === null) return;

    // mount 시점의 옵션 snapshot으로 controller를 만든다.
    const opts = optionsRef.current;
    const next = createIframeCallController<TCommands>({
      iframe: iframeEl,
      targetOrigin: opts.targetOrigin,
      allowedOrigins: opts.allowedOrigins,
      defaultTimeoutMs: opts.defaultTimeoutMs,
      generateId: opts.generateId,
      logger: opts.logger,
      readyPolicy: opts.readyPolicy,
      readyQueueLimit: opts.readyQueueLimit,
      readyTimeoutMs: opts.readyTimeoutMs,
      transport: opts.transport,
    });

    // effect cleanup 이후 도착하는 promise resolve가 stale React state를 건드리지 않게 한다.
    let cancelled = false;

    setController(
      next as IframeCallController<TCommands, TNotificationsFromIframe>,
    );
    setStatus("pending");
    setTerminationError(null);
    setReadyError(null);

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
