"use client";

// iframe 측 IframeCallRunner를 React lifecycle에 묶는 hook.
// mount 시 runner를 한 번만 생성하고, unmount 시 "react_unmount" reason으로 dispose한다.
// 옵션 reference 변경은 무시되며, re-render에서 runner가 재생성되지 않는다.

import { useEffect, useRef, useState } from "react";
import type {
  CommandMap,
  CommandsConstructor,
  IframeCallRunnerClassOptions,
  IframeCallRunnerHandle,
  IframeHelper,
} from "../core/types.ts";
import { consoleDebugLogger } from "./consoleDebugLogger.ts";
import { createIframeCallRunner } from "./runner.ts";

/** debugLog 옵션. true면 자동 구독, prefix override 가능. false/undefined면 미구독. */
export type UseIframeCallRunnerDebugLog =
  | boolean
  | {
      readonly prefix?: string;
    };

/**
 * useIframeCallRunner에 전달하는 옵션.
 * IframeCallRunnerClassOptions의 transport, logger, onHostDispose도 그대로 전달할 수 있다.
 */
export type UseIframeCallRunnerOptions<
  TCommands,
  TNotificationsToHost = Record<string, unknown>,
> = {
  /** postMessage targetOrigin. 빈 문자열이나 "*"은 runner 내부에서 거부된다. */
  readonly targetOrigin: string;

  /** 허용할 origin 목록. 생략하면 targetOrigin 하나만 허용한다. */
  readonly allowedOrigins?: readonly string[];

  /** runner가 new해서 iframeHelper를 주입할 Commands class. */
  readonly Commands: CommandsConstructor<TCommands, TNotificationsToHost>;

  /** true 또는 { prefix }이면 mount 시 consoleDebugLogger를 자동 구독한다. */
  readonly debugLog?: UseIframeCallRunnerDebugLog;
} & Pick<
  IframeCallRunnerClassOptions<TCommands, TNotificationsToHost>,
  "logger" | "onHostDispose" | "transport"
>;

/**
 * useIframeCallRunner가 반환하는 handle.
 * mount 전에는 모든 값이 undefined / false이며, mount 후 runner가 생성되면 채워진다.
 */
export type UseIframeCallRunnerResult<
  TCommands,
  TNotificationsToHost = Record<string, unknown>,
> = {
  /** runner가 생성한 Commands 인스턴스. mount 전 undefined. */
  readonly commands: TCommands | undefined;

  /** Commands constructor에 주입된 iframeHelper. mount 전 undefined. */
  readonly iframeHelper: IframeHelper<TNotificationsToHost> | undefined;

  /** runner handle 전체. mount 전 undefined. */
  readonly runner:
    | IframeCallRunnerHandle<TCommands, TNotificationsToHost>
    | undefined;

  /** runner가 활성화되어 있으면 true. mount 전 false. */
  readonly isActive: boolean;
};

/**
 * IframeCallRunner를 React lifecycle에 묶는 hook.
 * mount 시 runner를 한 번만 생성하고, unmount 시 dispose한다.
 * re-render로 인한 runner 재생성을 방지하기 위해 handle을 ref에 보관한다.
 * unmount cleanup은 transport/runner dispose만 수행하고 isActive 전환은 하지 않는다.
 * StrictMode의 mount→unmount→re-mount 사이클에서도 inactive 상태가 외부에 노출되지 않도록 보장한다.
 *
 * TCommands는 Commands class가 구현하는 command interface여야 한다.
 * class 자체가 아니라 command method만 포함하는 타입을 전달해야 CommandMap constraint를 만족한다.
 */
export function useIframeCallRunner<
  TCommands extends CommandMap<TCommands>,
  TNotificationsToHost = Record<string, unknown>,
>(
  options: UseIframeCallRunnerOptions<TCommands, TNotificationsToHost>,
): UseIframeCallRunnerResult<TCommands, TNotificationsToHost> {
  // options는 매 render마다 새 참조가 올 수 있으므로 ref로 최신값을 보관한다.
  // 단, runner는 mount 시 한 번만 생성하므로 이후 options 변경은 반영되지 않는다.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // runner handle은 mount 후 한 번만 생성되고 unmount까지 유지된다.
  const runnerRef = useRef<IframeCallRunnerHandle<
    TCommands,
    TNotificationsToHost
  > | null>(null);

  // mount 완료 후 상위 컴포넌트가 최신 handle을 읽을 수 있도록 re-render를 트리거한다.
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const opts = optionsRef.current;

    const runner = createIframeCallRunner<TCommands, TNotificationsToHost>({
      targetOrigin: opts.targetOrigin,
      allowedOrigins: opts.allowedOrigins,
      Commands: opts.Commands,
      logger: opts.logger,
      onHostDispose: opts.onHostDispose,
      transport: opts.transport,
    });

    runnerRef.current = runner;
    setIsActive(true);

    // debugLog 옵션이 truthy면 consoleDebugLogger를 mount 동안 자동 구독한다.
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
      unsubscribeDebug = runner.iframeHelper.debug.subscribe(handler);
    }

    return () => {
      // unmount 이후 setState는 화면에 반영되지 않고, StrictMode mount→unmount→re-mount 사이클에서
      // 일시적으로 isActive=false가 다른 hook에 노출될 수 있으므로 cleanup에서는 isActive 전환을 수행하지 않는다.
      // 실제 활성/비활성 판단은 commands/runner reference 노출 여부로 한다.
      if (unsubscribeDebug !== null) unsubscribeDebug();
      runner.dispose("react_unmount");
      runnerRef.current = null;
    };
  }, []); // runner lifecycle은 mount/unmount에 묶인다

  const runner = runnerRef.current;

  return {
    commands: runner?.commands,
    iframeHelper: runner?.iframeHelper,
    runner: runner ?? undefined,
    isActive,
  };
}
