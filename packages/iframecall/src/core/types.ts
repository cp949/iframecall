// iframecall 공개 타입 정의 모듈.
// wire envelope, command/notify 시그니처, host controller와 iframe runner의 옵션/핸들 타입을 한 곳에서 노출한다.
// host/iframe 양쪽 barrel은 이 파일에서 필요한 타입만 골라 export 한다.

import type { IframeCallTransport } from "./transport.ts";

/** Wire envelope: host -> iframe 방향 request. */
export type IframeCallRequest = {
  readonly protocol: "iframecall";
  readonly version: 1;
  readonly id: string;
  readonly cmd: string;
  readonly args: readonly unknown[];
};

/** Wire envelope: iframe -> host 방향 response. 성공/실패 모두 포함한다. */
export type IframeCallResponse =
  | {
      readonly protocol: "iframecall";
      readonly version: 1;
      readonly id: string;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly protocol: "iframecall";
      readonly version: 1;
      readonly id: string;
      readonly ok: false;
      readonly error: SerializedIframeCallError;
    };

/** Wire envelope: iframe -> host 방향 notify. id 없이 event 이름과 payload만 가진다. */
export type IframeCallNotify = {
  readonly protocol: "iframecall";
  readonly version: 1;
  readonly event: string;
  readonly payload: unknown;
};

/** Error response body. 재귀적으로 cause를 가질 수 있다. */
export type SerializedIframeCallError = {
  readonly code: string;
  readonly message: string;
  readonly command?: string;
  readonly details?: unknown;
  readonly cause?: SerializedIframeCallError;
};

/** Host controller가 ready 이전 호출을 어떻게 다룰지 선택한다. */
export type ReadyPolicy = "queue" | "reject";

/** command handler 시그니처. args와 return 모두 structured clone 가능해야 한다. */
export type CommandHandler<
  TArgs extends readonly unknown[] = readonly unknown[],
  TResult = unknown,
> = (...args: TArgs) => TResult | PromiseLike<TResult>;

/** command map의 각 property가 command handler인지 검증한다. */
export type CommandMap<TCommands> = {
  readonly [K in keyof TCommands]: TCommands[K] extends (
    ...args: infer TArgs
  ) => infer TResult
    ? TArgs extends readonly unknown[]
      ? CommandHandler<TArgs, Awaited<TResult>>
      : never
    : never;
};

/** command handler의 args tuple을 꺼낸다. */
export type CommandArgs<TCommand> = TCommand extends (
  ...args: infer TArgs
) => unknown
  ? TArgs
  : never;

/** command handler의 awaited return type을 꺼낸다. */
export type CommandResult<TCommand> = TCommand extends (
  ...args: infer TArgs
) => infer TResult
  ? TArgs extends readonly unknown[]
    ? Awaited<TResult>
    : never
  : never;

/** 도메인별 command 목록을 타입 파라미터로 받는 command map. */
export type CommandRunner<TCommands extends CommandMap<TCommands>> = {
  readonly commands: TCommands;
};

/** host가 subscribe하는 notify handler. */
export type NotifyHandler<TPayload = unknown> = (payload: TPayload) => void;

/** postMessage가 ownership을 넘길 transferable 값. */
export type IframeCallTransferable = Transferable;

/** command 호출별 timeout과 transfer 대상을 지정한다. */
export type IframeCallCallOptions = {
  readonly timeoutMs?: number;
  readonly transfer?: readonly IframeCallTransferable[];
};

/** 디버그용 최소 logger. */
export type IframeCallLogger = {
  readonly warn: (message: string, detail?: unknown) => void;
  readonly info?: (message: string, detail?: unknown) => void;
};

/** host controller 생성 옵션. */
export type IframeCallControllerOptions<
  TCommands extends CommandMap<TCommands>,
> = {
  /** 통신 대상 iframe element. transport 미지정 시 contentWindow 기준 기본 transport를 만든다. */
  readonly iframe: HTMLIFrameElement;

  /** postMessage targetOrigin. wildcard("*"/"null"/빈 문자열)는 거부한다. */
  readonly targetOrigin: string;

  /** 수신 시 허용할 origin 목록. 미지정이면 targetOrigin 단일 값을 사용한다. */
  readonly allowedOrigins?: readonly string[];

  /** ready 이전 호출 처리 정책. "queue"는 대기열에 쌓고, "reject"는 즉시 거부한다. */
  readonly readyPolicy?: ReadyPolicy;

  /** queue 정책일 때 대기열 최대 크기. 초과 호출은 queue_overflow 에러로 거부한다. */
  readonly readyQueueLimit?: number;

  /** call() 호출별 timeout 기본값(ms). 0 또는 Infinity면 timeout을 적용하지 않는다. */
  readonly defaultTimeoutMs?: number;

  /** ready 신호 대기 timeout(ms). 미지정이면 defaultTimeoutMs를 따른다. */
  readonly readyTimeoutMs?: number;

  /** request id 생성기. 테스트 환경에서 결정적인 id를 주입할 때 사용한다. */
  readonly generateId?: () => string;

  /** 디버그 로그 출력 hook. ready 중복 수신, postMessage 실패 등 비치명적 이벤트만 흘려준다. */
  readonly logger?: IframeCallLogger;

  /** Window 외 매체로 통신할 때 주입하는 transport. 미지정이면 iframe 기반 transport를 사용한다. */
  readonly transport?: IframeCallTransport;

  /** TCommands를 추론에 강제하기 위한 phantom 필드. 런타임에서는 사용하지 않는다. */
  readonly __commandsPhantom?: TCommands;
};

/**
 * `ready`는 transport lifecycle event라 domain notification map에 섞이지 않는다.
 * 사용자가 `TNotificationsToHost`에 `ready` 키를 넣으려 해도 type-level에서 거부한다.
 */
export type ReservedNotificationName = "ready" | "terminated";

/**
 * 도메인 notification map에서 lifecycle 예약 이름을 제거한다.
 * `sendNotificationToHost`의 generic K 추론에 사용한다.
 */
export type DomainNotificationKey<TNotificationsToHost> = Exclude<
  keyof TNotificationsToHost & string,
  ReservedNotificationName
>;

/**
 * iframe runner가 host로 보낼 수 있는 notification helper.
 * Commands class constructor에 주입되어 도메인 코드가 host로 신호를 흘려보낼 때 사용한다.
 *
 * 명시된 notification map에서는 lifecycle 예약 이름을 generic K에서 자동으로 제거하고,
 * default wildcard map에서는 string event를 받는다.
 */
export type IframeHelper<TNotificationsToHost = Record<string, unknown>> = {
  /** 도메인 notification을 host로 전송한다. lifecycle 예약 이름은 받지 않는다. */
  sendNotificationToHost: IsWildcardNotificationMap<TNotificationsToHost> extends true
    ? (event: string, payload: unknown) => void
    : <K extends DomainNotificationKey<TNotificationsToHost>>(
        event: K,
        payload: TNotificationsToHost[K],
      ) => void;

  /** transport lifecycle ready 신호를 host로 전송한다. payload는 라이브러리가 고정한다. */
  sendLifecycleReady(): void;

  /** 개발/디버그 패널이 iframecall 통신 흐름을 관찰할 수 있도록 raw event를 흘려준다. */
  readonly debug: {
    subscribe(handler: (event: IframeDebugEvent) => void): () => void;
  };
};

/**
 * 디버그 패널이 관찰하는 iframecall 통신 이벤트.
 * raw payload를 그대로 전달하므로 production logging에는 사용하지 않는다.
 */
export type IframeDebugEvent =
  | {
      readonly type: "commandReceivedFromHost";
      readonly command: string;
      readonly args: readonly unknown[];
    }
  | {
      readonly type: "commandResultSentToHost";
      readonly command: string;
      readonly value: unknown;
    }
  | {
      readonly type: "commandErrorSentToHost";
      readonly command: string;
      readonly error: SerializedIframeCallError;
    }
  | {
      readonly type: "notificationSentToHost";
      readonly event: string;
      readonly payload: unknown;
    }
  | {
      readonly type: "notificationReceivedFromHost";
      readonly event: string;
      readonly payload: unknown;
    };

/**
 * host controller가 관찰하는 iframecall 통신 이벤트.
 * raw payload를 그대로 전달하므로 production logging에는 사용하지 않는다.
 * iframe 측 IframeDebugEvent와 같은 dev-only 정책을 따른다.
 */
export type HostDebugEvent =
  | {
      readonly type: "commandSentToIframe";
      readonly command: string;
      readonly args: readonly unknown[];
    }
  | {
      readonly type: "commandResultReceivedFromIframe";
      readonly command: string;
      readonly value: unknown;
    }
  | {
      readonly type: "commandErrorReceivedFromIframe";
      readonly command: string;
      readonly error: SerializedIframeCallError;
    }
  | {
      readonly type: "notificationReceivedFromIframe";
      readonly event: string;
      readonly payload: unknown;
    }
  | {
      readonly type: "readyReceived";
      readonly payload: unknown;
    }
  | {
      readonly type: "terminatedReceived";
      readonly reason: string;
      readonly error: SerializedIframeCallError | null;
    };

/**
 * iframe 업체가 구현하는 `Commands` class의 constructor 시그니처.
 * runner가 `new Commands(iframeHelper)`로 정확히 한 번 호출한다.
 */
export type CommandsConstructor<
  TCommands,
  TNotificationsToHost = Record<string, unknown>,
> = new (iframeHelper: IframeHelper<TNotificationsToHost>) => TCommands;

/**
 * class 기반 runner 옵션.
 * 업체 개발자는 `Commands` class만 작성하면 되고, runner가 `iframeHelper`를 주입한다.
 */
export type IframeCallRunnerClassOptions<
  TCommands,
  TNotificationsToHost = Record<string, unknown>,
> = {
  readonly targetOrigin: string;

  readonly allowedOrigins?: readonly string[];

  readonly Commands: CommandsConstructor<TCommands, TNotificationsToHost>;

  readonly logger?: IframeCallLogger;

  readonly onHostDispose?: (reason: string) => void | PromiseLike<void>;

  readonly transport?: IframeCallTransport;
};

/** iframe runner 생성 옵션. */
export type IframeCallRunnerOptions<
  TCommands,
  TNotificationsToHost = Record<string, unknown>,
> = IframeCallRunnerClassOptions<TCommands, TNotificationsToHost>;

/**
 * host controller public surface.
 * 두 번째 generic은 default를 두어 단일 generic 호출처가 typecheck를 유지한다.
 */
export type IframeCallController<
  TCommands extends CommandMap<TCommands>,
  TNotificationsFromIframe = Record<string, unknown>,
> = {
  /** iframe이 ready 신호를 보낼 때까지 대기하는 promise. terminate 시 reject된다. */
  readonly ready: Promise<void>;

  /** 종료 사유를 노출하는 promise. 정상 dispose면 null, 비정상 종료면 직렬화된 에러로 resolve된다. */
  readonly terminated: Promise<SerializedIframeCallError | null>;

  /**
   * iframe에 등록된 command를 호출한다.
   * ready 이전 호출은 readyPolicy에 따라 queue되거나 즉시 거부된다.
   * timeout/transfer는 호출별 options로 지정한다.
   */
  call<K extends keyof TCommands & string>(
    cmd: K,
    args: CommandArgs<TCommands[K]>,
    options?: IframeCallCallOptions,
  ): Promise<CommandResult<TCommands[K]>>;

  /**
   * iframe이 host로 보낸 notification을 event 이름과 payload로 구독한다.
   * payload 타입은 `TNotificationsFromIframe`로 추론된다.
   */
  onNotificationFromIframe<K extends keyof TNotificationsFromIframe & string>(
    event: K,
    handler: NotifyHandler<TNotificationsFromIframe[K]>,
  ): () => void;

  /**
   * controller를 종료하고 transport listener를 정리한다.
   * iframe에 dispose request를 한 번 시도하지만 실패해도 내부 상태는 항상 정리된다.
   */
  dispose(reason?: string): Promise<void>;

  /**
   * 개발/디버그 패널이 host 측 통신 흐름을 관찰할 수 있도록 raw event를 흘려준다.
   * raw payload를 그대로 전달하므로 production logging에는 사용하지 않는다.
   */
  readonly debug: {
    subscribe(handler: (event: HostDebugEvent) => void): () => void;
  };
};

/**
 * notification map 명시 여부를 판별하는 conditional helper.
 * 명시된 키 union이면 false, default `Record<string, unknown>`이나 `unknown` 같은 wildcard면 true가 된다.
 *
 * `unknown`인 경우 `keyof = never`라 별도로 wildcard로 취급한다.
 */
type IsWildcardNotificationMap<TNotificationsToHost> =
  unknown extends TNotificationsToHost
    ? true
    : string extends keyof TNotificationsToHost & string
      ? true
      : false;

/**
 * iframe runner public surface.
 * 두 generic 모두 default를 두어 단일 generic 호출처가 typecheck를 유지한다.
 */
export type IframeCallRunnerHandle<
  TCommands = Record<string, CommandHandler>,
  TNotificationsToHost = Record<string, unknown>,
> = {
  /** runner가 생성한 Commands 인스턴스. class API 사용 시 host와 같은 reference를 노출한다. */
  readonly commands: TCommands;

  /** Commands constructor에 주입된 helper와 같은 reference. debug 구독에도 사용한다. */
  readonly iframeHelper: IframeHelper<TNotificationsToHost>;

  /** iframeHelper.sendNotificationToHost와 동일한 동작을 runner handle에서 노출한다. */
  sendNotificationToHost: IsWildcardNotificationMap<TNotificationsToHost> extends true
    ? (event: string, payload: unknown) => void
    : <K extends DomainNotificationKey<TNotificationsToHost>>(
        event: K,
        payload: TNotificationsToHost[K],
      ) => void;

  /** transport lifecycle ready 신호. payload는 `{ protocolVersion: 1 }`로 고정된다. */
  sendLifecycleReady(): void;

  terminated(reason: string, error?: SerializedIframeCallError): void;

  /** local transport subscription을 즉시 정리하고 이후 inbound/outbound를 모두 no-op으로 만든다. */
  dispose(reason?: string): void;
};
