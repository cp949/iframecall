// host 측 iframecall controller 구현.
// iframe ready 대기, command 호출과 응답 매칭, notify 디스패치, 종료 처리까지 lifecycle 전체를 담당한다.
// 호출/큐/notify 상태와 ready/terminate lifecycle은 각각 별도 모듈로 위임하고, controller는 transport 라우팅 조립과 invoke API 노출만 책임진다.

import {
  createIframeCallError,
  isSerializedIframeCallError,
} from "../core/errors.ts";
import {
  createIframeCallRequest,
  parseIframeCallMessage,
} from "../core/messages.ts";
import {
  createIframeWindowTransport,
  type IframeCallTransport,
  type IframeCallTransportEvent,
} from "../core/transport.ts";
import type {
  CommandMap,
  CommandResult,
  HostDebugEvent,
  IframeCallController,
  IframeCallControllerOptions,
  IframeCallLogger,
  SerializedIframeCallError,
} from "../core/types.ts";
import {
  type ControllerLifecycle,
  createControllerLifecycle,
} from "./controllerLifecycle.ts";
import {
  createNotifyHandlerRegistry,
  type NotifyHandlerRegistry,
} from "./notifyHandlerRegistry.ts";
import {
  createPendingCallRegistry,
  type PendingCall,
  type PendingCallRegistry,
} from "./pendingCallRegistry.ts";
import { createReadyQueue, type ReadyQueue } from "./readyQueue.ts";

/**
 * iframecall host controller를 생성한다.
 * 옵션을 정규화하고 transport를 구독해 ready/notify/response 이벤트를 dispatch하는 controller 객체를 돌려준다.
 * 두 번째 generic은 iframe -> host notify의 payload 타입 추론에 사용한다.
 */
export function createIframeCallController<
  TCommands extends CommandMap<TCommands>,
  TNotificationsFromIframe = Record<string, unknown>,
>(
  options: IframeCallControllerOptions<TCommands>,
): IframeCallController<TCommands, TNotificationsFromIframe> {
  const targetOrigin = requireTargetOrigin(options.targetOrigin);
  const allowedOrigins = new Set(options.allowedOrigins ?? [targetOrigin]);
  const transport =
    options.transport ?? createIframeWindowTransport(options.iframe);
  const generateId = options.generateId ?? createDefaultRequestId;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  const readyTimeoutMs = options.readyTimeoutMs ?? defaultTimeoutMs;
  const readyPolicy = options.readyPolicy ?? "queue";
  const readyQueueLimit = options.readyQueueLimit ?? Number.POSITIVE_INFINITY;

  const pending = createPendingCallRegistry(transport, targetOrigin);
  const queue = createReadyQueue();
  const notifyRegistry = createNotifyHandlerRegistry();

  // debug 구독자 집합. opt-in 개발용이므로 기본 구독자는 없다.
  const debugSubscribers = new Set<(event: HostDebugEvent) => void>();

  // 등록된 debug subscriber 모두에게 raw event를 그대로 전달한다.
  // subscriber가 throw해도 다른 subscriber와 controller 동작에 영향을 주지 않는다.
  function emitDebug(event: HostDebugEvent): void {
    for (const handler of debugSubscribers) {
      try {
        handler(event);
      } catch (error) {
        options.logger?.warn("iframecall debug subscriber threw.", error);
      }
    }
  }

  const lifecycle = createControllerLifecycle({
    readyTimeoutMs,
    onTerminate(error) {
      const buildLifecycleError = (command: string) =>
        createCallLifecycleError(error, command);
      pending.rejectAll(buildLifecycleError);
      queue.rejectAll(buildLifecycleError);
    },
  });

  const unsubscribeTransport = transport.subscribe(
    createTransportRouter({
      lifecycle,
      allowedOrigins,
      transport,
      pending,
      queue,
      notifyRegistry,
      logger: options.logger,
      emitDebug,
    }),
  );

  lifecycle.setOnCleanup(() => {
    unsubscribeTransport();
    notifyRegistry.clear();
  });

  const invoke: IframeCallController<
    TCommands,
    TNotificationsFromIframe
  >["invoke"] = (cmd, args, callOptions) => {
    const terminatedError = lifecycle.getTerminatedError();
    if (terminatedError !== null) {
      return Promise.reject(terminatedError);
    }

    if (!lifecycle.isReady() && readyPolicy === "reject") {
      return Promise.reject(
        createIframeCallError("not_ready", "Iframe is not ready.", {
          command: cmd,
        }),
      );
    }

    const id = generateId();
    const timeoutMs = callOptions?.timeoutMs ?? defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const timeoutId =
        timeoutMs === 0 || timeoutMs === Number.POSITIVE_INFINITY
          ? null
          : setTimeout(() => {
              pending.delete(id);
              queue.delete(id);
              reject(
                createIframeCallError("timeout", "Command timed out.", {
                  command: cmd,
                  details: { timeoutMs },
                }),
              );
            }, timeoutMs);

      const call: PendingCall = {
        command: cmd,
        timeoutId,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      if (!lifecycle.isReady()) {
        if (queue.size() >= readyQueueLimit) {
          if (timeoutId !== null) clearTimeout(timeoutId);
          reject(
            createIframeCallError("queue_overflow", "Ready queue overflow.", {
              command: cmd,
              details: { readyQueueLimit },
            }),
          );
          return;
        }

        queue.add(id, {
          ...call,
          args,
          transfer: callOptions?.transfer,
        });
        return;
      }

      emitDebug({ type: "commandSentToIframe", command: cmd, args });
      pending.add(id, call);
      pending.post(id, cmd, args, callOptions?.transfer);
    }) as Promise<CommandResult<TCommands[typeof cmd]>>;
  };

  const controller: IframeCallController<TCommands, TNotificationsFromIframe> =
    {
      ready: lifecycle.ready,
      terminated: lifecycle.terminated,
      invoke,
      call(cmd, args, callOptions) {
        return invoke(cmd, args, callOptions);
      },
      onNotificationFromIframe(event, handler) {
        // typed handler를 내부 Set에 보관하기 위한 최소한의 cast.
        return notifyRegistry.register(
          event,
          handler as Parameters<typeof notifyRegistry.register>[1],
        );
      },
      debug: {
        subscribe(handler) {
          debugSubscribers.add(handler);
          return () => {
            debugSubscribers.delete(handler);
          };
        },
      },
      async dispose(reason = "host_requested") {
        if (lifecycle.isTerminated()) {
          lifecycle.cleanup();
          return;
        }

        const lifecycleError = createIframeCallError(
          "terminated",
          "Controller disposed.",
          {
            details: { reason },
          },
        );

        try {
          transport.post(
            createIframeCallRequest(generateId(), "host:dispose", [{ reason }]),
            targetOrigin,
          );
        } catch (error) {
          options.logger?.warn("iframecall dispose message failed.", error);
        } finally {
          lifecycle.terminate(lifecycleError);
          lifecycle.cleanup();
        }
      },
    };

  return controller;
}

/** Chrome 80에서도 지원되는 Web Crypto 난수로 opaque request id를 만든다. */
function createDefaultRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let id = "";
  for (const byte of bytes) {
    id += byte.toString(16).padStart(2, "0");
  }
  return id;
}

/** transport 메시지 라우터가 controller closure에서 끌어다 쓰는 의존성. */
type TransportRouterDeps = {
  readonly lifecycle: ControllerLifecycle;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly transport: IframeCallTransport;
  readonly pending: PendingCallRegistry;
  readonly queue: ReadyQueue;
  readonly notifyRegistry: NotifyHandlerRegistry;
  readonly logger: IframeCallLogger | undefined;
  readonly emitDebug: (event: HostDebugEvent) => void;
};

/**
 * transport 수신 이벤트를 origin/source 검증 후 응답·notify 분기로 라우팅한다.
 * controller 본문에서 분리해 ready/terminate 진입 경로와 분기 트리를 모듈 단위로 분리한다.
 */
function createTransportRouter(deps: TransportRouterDeps) {
  const {
    lifecycle,
    allowedOrigins,
    transport,
    pending,
    queue,
    notifyRegistry,
    logger,
    emitDebug,
  } = deps;

  return (event: IframeCallTransportEvent) => {
    if (lifecycle.isTerminated()) return;
    if (!allowedOrigins.has(event.origin)) return;

    if (
      transport.expectedSource !== undefined &&
      event.source !== transport.expectedSource
    ) {
      return;
    }

    const parsed = parseIframeCallMessage(event.data);

    if (parsed?.type === "response") {
      const responseMessage = parsed.message;
      const command = pending.getCommand(responseMessage.id);
      pending.settle(responseMessage.id, responseMessage);
      if (command !== undefined) {
        if (responseMessage.ok) {
          emitDebug({
            type: "commandResultReceivedFromIframe",
            command,
            value: responseMessage.value,
          });
        } else {
          emitDebug({
            type: "commandErrorReceivedFromIframe",
            command,
            error: responseMessage.error,
          });
        }
      }
      return;
    }

    if (parsed?.type !== "notify") return;

    const { event: notifyEvent, payload } = parsed.message;

    if (notifyEvent === "ready") {
      handleReadyNotify(payload, lifecycle, queue, pending, logger, emitDebug);
      return;
    }

    if (notifyEvent === "terminated") {
      const terminatedPayload = isRecord(payload) ? payload : {};
      const reason =
        typeof terminatedPayload.reason === "string"
          ? terminatedPayload.reason
          : "unknown";
      const cause = getTerminatedCause(payload);
      emitDebug({
        type: "terminatedReceived",
        reason,
        error: cause ?? null,
      });
      lifecycle.terminate(
        createIframeCallError("terminated", "Iframe terminated.", {
          cause,
          details: payload,
        }),
      );
      return;
    }

    notifyRegistry.dispatch(notifyEvent, payload);
    emitDebug({
      type: "notificationReceivedFromIframe",
      event: notifyEvent,
      payload,
    });
  };
}

/** ready notify의 중복/version_mismatch를 검사하고 정상이면 markReady와 queue flush를 진행한다. */
function handleReadyNotify(
  payload: unknown,
  lifecycle: ControllerLifecycle,
  queue: ReadyQueue,
  pending: PendingCallRegistry,
  logger: IframeCallLogger | undefined,
  emitDebug: (event: HostDebugEvent) => void,
): void {
  if (lifecycle.isReady()) {
    logger?.warn("iframecall duplicate ready ignored.", payload);
    return;
  }

  if (!isSupportedReadyPayload(payload)) {
    lifecycle.terminate(
      createIframeCallError(
        "version_mismatch",
        "Unsupported iframecall protocol version.",
        { details: payload },
      ),
    );
    return;
  }

  emitDebug({ type: "readyReceived", payload });
  lifecycle.markReady();
  queue.flush((id, call) => {
    emitDebug({
      type: "commandSentToIframe",
      command: call.command,
      args: call.args,
    });
    pending.add(id, call);
    pending.post(id, call.command, call.args, call.transfer);
  });
}

/**
 * terminate 시 in-flight 호출에 전달할 에러를 만든다.
 * 원본이 ready timeout처럼 command 정보가 빠진 lifecycle 에러일 때만 호출 단위 command를 보강한다.
 */
function createCallLifecycleError(
  error: SerializedIframeCallError,
  command: string,
): SerializedIframeCallError {
  if (error.code !== "timeout" || error.command !== undefined) {
    return error;
  }

  return {
    ...error,
    command,
  };
}

/**
 * iframe이 보낸 terminated notify의 payload에서 cause 후보를 꺼낸다.
 * payload.error가 직렬화된 iframecall 에러 형태일 때만 cause로 채택한다.
 */
function getTerminatedCause(
  payload: unknown,
): SerializedIframeCallError | undefined {
  if (!isRecord(payload) || !isSerializedIframeCallError(payload.error)) {
    return undefined;
  }

  return payload.error;
}

/** ready notify가 알려준 protocolVersion이 controller가 지원하는 1과 일치하는지 검사한다. */
function isSupportedReadyPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.protocolVersion === 1;
}

/**
 * targetOrigin을 정규화한다. wildcard("*"/"null"/빈 문자열)는 보안상 거부하고
 * invalid_origin 에러로 즉시 throw해 잘못된 호출 측 설정을 빨리 드러낸다.
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

// payload는 임의 값이라 object 가드부터 안전하게 시작한다.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
