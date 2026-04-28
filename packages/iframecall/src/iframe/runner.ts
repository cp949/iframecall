// iframe 측 iframecall runner 구현.
// host로부터 받은 command 요청을 dispatch하고, 도메인 코드가 host로 notify를 보낼 helper를 제공한다.
// host:dispose / runner.dispose / runner.terminated 의 lifecycle 종료 경로를 일관된 disposing/disposed 가드로 묶는다.

import {
  createIframeCallError,
  serializeIframeCallError,
} from "../core/errors.ts";
import {
  createIframeCallErrorResponse,
  createIframeCallNotify,
  createIframeCallSuccessResponse,
  parseIframeCallMessage,
} from "../core/messages.ts";
import { createParentWindowTransport } from "../core/transport.ts";
import type {
  CommandHandler,
  CommandMap,
  CommandsConstructor,
  IframeCallRunnerHandle,
  IframeCallRunnerOptions,
  IframeDebugEvent,
  IframeHelper,
  SerializedIframeCallError,
} from "../core/types.ts";

/**
 * Commands class dispatch에서 제외하는 lifecycle/예약 method 이름.
 * `host:dispose`는 host controller가 보낸 dispose request 처리 전용이라 도메인 command로 노출하지 않는다.
 */
const RESERVED_COMMAND_NAMES = new Set<string>(["constructor", "host:dispose"]);

/**
 * iframecall iframe runner를 생성한다.
 * `{ Commands }` class 옵션을 받아 dispatch lookup을 만들고,
 * 도메인 코드가 host로 notify를 보낼 수 있는 helper를 함께 노출한다.
 * 두 번째 generic은 host로 보낼 notify event/payload 타입 추론에 사용한다.
 */
export function createIframeCallRunner<
  TCommands extends CommandMap<TCommands>,
  TNotificationsToHost = Record<string, unknown>,
>(
  options: IframeCallRunnerOptions<TCommands, TNotificationsToHost>,
): IframeCallRunnerHandle<TCommands, TNotificationsToHost> {
  const targetOrigin = requireTargetOrigin(options.targetOrigin);
  const allowedOrigins = new Set(options.allowedOrigins ?? [targetOrigin]);
  const transport = options.transport ?? createParentWindowTransport();

  // host:dispose 수신 또는 dispose() 호출 직후 세워지는 guard.
  // disposing 상태에서는 새 inbound request와 in-flight response를 모두 drop한다.
  let disposing = false;
  // unsubscribe 완료 후 세워지는 guard.
  // disposed 상태에서는 notify/terminated outbound도 no-op이 된다.
  let disposed = false;

  // debug 구독자 집합. opt-in 개발용이므로 기본 구독자는 없다.
  const debugSubscribers = new Set<(event: IframeDebugEvent) => void>();

  // 등록된 debug subscriber 모두에게 raw event를 그대로 전달한다.
  // 단일 호출에서 result/error 이벤트가 동시에 나가지 않는 invariant는 호출 측에서 보장한다.
  function emitDebug(event: IframeDebugEvent): void {
    for (const handler of debugSubscribers) {
      try {
        handler(event);
      } catch (error) {
        options.logger?.warn("iframecall debug subscriber threw.", error);
      }
    }
  }

  // public IframeHelper는 conditional 타입을 가지므로 내부에서는 untyped helper를 만들고 boundary에서 cast한다.
  const helperInternal = {
    sendNotificationToHost(event: string, payload: unknown): void {
      if (disposing || disposed) return;
      safePost(createIframeCallNotify(event, payload));
      emitDebug({ type: "notificationSentToHost", event, payload });
    },
    sendLifecycleReady(): void {
      if (disposing || disposed) return;
      // ready payload는 라이브러리가 protocolVersion을 고정한다.
      safePost(createIframeCallNotify("ready", { protocolVersion: 1 }));
    },
    debug: {
      subscribe(handler: (event: IframeDebugEvent) => void): () => void {
        debugSubscribers.add(handler);
        return () => {
          debugSubscribers.delete(handler);
        };
      },
    },
  };
  const iframeHelper =
    helperInternal as unknown as IframeHelper<TNotificationsToHost>;

  const { commands, dispatch } = resolveCommandSource<
    TCommands,
    TNotificationsToHost
  >(options, iframeHelper);

  const unsubscribeTransport = transport.subscribe((event) => {
    if (disposing || disposed) return;

    if (!allowedOrigins.has(event.origin)) {
      return;
    }

    if (
      transport.expectedSource !== undefined &&
      event.source !== transport.expectedSource
    ) {
      return;
    }

    const parsed = parseIframeCallMessage(event.data);

    if (parsed?.type === "notify") {
      // host -> iframe notification 수신은 RM-006 scope 밖이지만, debug 관찰은 가능하게 둔다.
      emitDebug({
        type: "notificationReceivedFromHost",
        event: parsed.message.event,
        payload: parsed.message.payload,
      });
      return;
    }

    if (parsed?.type !== "request") {
      return;
    }

    if (parsed.message.cmd === "host:dispose") {
      void handleHostDispose(getDisposeReason(parsed.message.args[0]));
      return;
    }

    void handleRequest(
      parsed.message.id,
      parsed.message.cmd,
      parsed.message.args,
    );
  });

  function safePost(
    message: unknown,
    transfer?: readonly Transferable[],
  ): void {
    try {
      transport.post(message, targetOrigin, transfer);
    } catch (error) {
      options.logger?.warn("iframecall postMessage failed.", error);
    }
  }

  async function handleHostDispose(reason: string) {
    if (disposing || disposed) return;
    // 동기적으로 guard를 세워 이후 inbound request와 in-flight response를 즉시 차단한다.
    disposing = true;
    try {
      await options.onHostDispose?.(reason);
    } catch (error) {
      options.logger?.warn("iframecall host dispose handler failed.", error);
    } finally {
      // lifecycle 완료 알림은 disposing 중에도 한 번 허용한다.
      safePost(createIframeCallNotify("terminated", { reason }));
      disposed = true;
      unsubscribeTransport();
    }
  }

  async function handleRequest(
    id: string,
    cmd: string,
    args: readonly unknown[],
  ) {
    if (disposing || disposed) return;

    emitDebug({ type: "commandReceivedFromHost", command: cmd, args });

    const handler = dispatch(cmd);

    if (handler === undefined) {
      const error = createIframeCallError(
        "command_not_found",
        `Command not found: ${cmd}`,
        { command: cmd },
      );
      safePost(createIframeCallErrorResponse(id, error));
      emitDebug({ type: "commandErrorSentToHost", command: cmd, error });
      return;
    }

    try {
      const value = await handler(...args);
      // await 이후에도 dispose 여부를 재확인한다.
      if (disposing || disposed) return;
      safePost(createIframeCallSuccessResponse(id, value));
      emitDebug({ type: "commandResultSentToHost", command: cmd, value });
    } catch (rawError) {
      if (disposing || disposed) return;
      const serialized = serializeIframeCallError(rawError, cmd);
      safePost(createIframeCallErrorResponse(id, serialized));
      emitDebug({
        type: "commandErrorSentToHost",
        command: cmd,
        error: serialized,
      });
    }
  }

  // 내부 dispatch는 runtime 동작이 동일하므로 conditional public surface로 노출하기 전 단일 helper로 통일한다.
  const sendNotificationToHostUntyped = (
    event: string,
    payload: unknown,
  ): void => helperInternal.sendNotificationToHost(event, payload);

  const handle = {
    commands,
    iframeHelper,
    sendNotificationToHost: sendNotificationToHostUntyped,
    sendLifecycleReady(): void {
      iframeHelper.sendLifecycleReady();
    },
    terminated(reason: string, error?: SerializedIframeCallError): void {
      if (disposing || disposed) return;
      // iframe 주도 종료도 dispose와 같은 최종 상태로 취급해 이후 request/notify를 차단한다.
      disposing = true;
      safePost(createIframeCallNotify("terminated", { reason, error }));
      disposed = true;
      unsubscribeTransport();
    },
    dispose(_reason?: string): void {
      if (disposing || disposed) return;
      // 즉시 동기적으로 양쪽 guard를 세워 inbound/outbound를 모두 차단한다.
      disposing = true;
      disposed = true;
      unsubscribeTransport();
    },
  };

  return handle as unknown as IframeCallRunnerHandle<
    TCommands,
    TNotificationsToHost
  >;
}

/**
 * runner option의 Commands class로 commands 인스턴스와 dispatch lookup을 만든다.
 * 누락되거나 제거된 object-map 옵션이 들어오면 invalid_args로 throw한다.
 */
function resolveCommandSource<
  TCommands extends CommandMap<TCommands>,
  TNotificationsToHost,
>(
  options: IframeCallRunnerOptions<TCommands, TNotificationsToHost>,
  iframeHelper: IframeHelper<TNotificationsToHost>,
): {
  readonly commands: TCommands;
  readonly dispatch: (cmd: string) => CommandHandler | undefined;
} {
  const rawOptions = options as {
    readonly Commands?: CommandsConstructor<TCommands, TNotificationsToHost>;
    readonly commands?: unknown;
  };
  const hasCommandsObject =
    "commands" in rawOptions && rawOptions.commands !== undefined;
  const hasCommandsClass =
    "Commands" in rawOptions && rawOptions.Commands !== undefined;

  if (hasCommandsObject) {
    throw createIframeCallError(
      "invalid_args",
      "createIframeCallRunner no longer accepts { commands }. Use { Commands } class.",
    );
  }

  if (!hasCommandsClass) {
    throw createIframeCallError(
      "invalid_args",
      "createIframeCallRunner requires { Commands } class.",
    );
  }

  const Ctor = rawOptions.Commands;
  const instance = new Ctor(iframeHelper);
  // dispatch 호출마다 클로저를 새로 만들지 않도록 prototype command를 instance에 바인딩한 채 캐시한다.
  // invariant 필터링은 캐시 빌드 시점 한 번만 수행되고, 이후 dispatch는 Map lookup으로만 동작한다.
  const handlerCache = buildPrototypeCommandHandlers(instance);

  return {
    commands: instance,
    dispatch(cmd: string) {
      return handlerCache.get(cmd);
    },
  };
}

/**
 * Commands 인스턴스의 prototype chain을 한 번만 훑어 dispatch 가능한 method를
 * instance에 바인딩한 채 Map으로 캐시한다. dispatch에서는 lookup만 수행하므로
 * 호출당 새 클로저가 만들어지지 않는다.
 *
 * 제외 대상은 기존과 동일하다.
 * - `host:dispose` 등 RESERVED_COMMAND_NAMES, `_` prefix, symbol key
 * - accessor(get/set), instance field에 할당된 함수
 * - static method는 constructor에 있어 prototype chain 순회에서 자연히 접근되지 않는다.
 *
 * 같은 method 이름이 prototype chain에서 여러 번 등장하면 가장 가까운 prototype의
 * 정의를 사용한다(JS 메서드 해상도 규칙과 일치).
 */
function buildPrototypeCommandHandlers(
  instance: object,
): Map<string, CommandHandler> {
  const handlers = new Map<string, CommandHandler>();
  let proto: object | null = Object.getPrototypeOf(instance);

  while (proto !== null && proto !== Object.prototype) {
    // Reflect.ownKeys로 symbol-keyed method까지 함께 수집한 뒤 string key만 필터링한다.
    for (const key of Reflect.ownKeys(proto)) {
      if (typeof key !== "string") continue;
      if (RESERVED_COMMAND_NAMES.has(key)) continue;
      if (key.startsWith("_")) continue;
      // 더 가까운 prototype에서 이미 채운 항목은 덮어쓰지 않아 method 해상도 순서를 보존한다.
      if (handlers.has(key)) continue;

      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor === undefined) continue;
      // accessor(get/set)는 도메인 command가 아니므로 제외한다.
      if (descriptor.get !== undefined || descriptor.set !== undefined)
        continue;
      if (typeof descriptor.value !== "function") continue;

      // host-dispatched prototype command는 생성된 인스턴스를 this로 유지해야 state 접근이 깨지지 않는다.
      const method = descriptor.value as (...a: unknown[]) => unknown;
      handlers.set(key, method.bind(instance) as CommandHandler);
    }
    proto = Object.getPrototypeOf(proto);
  }

  return handlers;
}

/**
 * targetOrigin을 정규화한다. wildcard("*"/"null"/빈 문자열)는 보안상 거부하고
 * invalid_origin 에러로 즉시 throw해 잘못된 호출 측 설정을 빠르게 드러낸다.
 */
function requireTargetOrigin(targetOrigin: string): string {
  if (
    targetOrigin.length === 0 ||
    targetOrigin === "*" ||
    targetOrigin === "null"
  ) {
    throw createIframeCallError(
      "invalid_origin",
      "targetOrigin must be explicit.",
    );
  }

  return targetOrigin;
}

/**
 * host:dispose request의 payload에서 reason 문자열을 꺼낸다.
 * payload가 없거나 형식이 어긋나면 기본값 "host_requested"를 돌려준다.
 */
function getDisposeReason(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "reason" in payload &&
    typeof payload.reason === "string"
  ) {
    return payload.reason;
  }

  return "host_requested";
}
