// iframecall wire 메시지(요청/응답/notify)의 envelope 생성과 파싱을 담당한다.
// host와 iframe 양쪽 transport 코드가 공유하는 단일 직렬화 계약이며,
// `protocol`/`version` 필드와 envelope 형태가 일치하지 않는 메시지는 모두 무시한다.

import type {
  IframeCallNotify,
  IframeCallRequest,
  IframeCallResponse,
  SerializedIframeCallError,
} from "./types.ts";

/** 파싱 결과를 type tag로 구분한 discriminated union. 알 수 없는 형태는 null로 반환한다. */
export type ParsedIframeCallMessage =
  | { readonly type: "request"; readonly message: IframeCallRequest }
  | { readonly type: "response"; readonly message: IframeCallResponse }
  | { readonly type: "notify"; readonly message: IframeCallNotify };

/** host -> iframe 방향 command 요청 envelope을 만든다. */
export function createIframeCallRequest(
  id: string,
  cmd: string,
  args: readonly unknown[],
): IframeCallRequest {
  return {
    protocol: "iframecall",
    version: 1,
    id,
    cmd,
    args,
  };
}

/** iframe -> host 방향 command 성공 응답 envelope을 만든다. */
export function createIframeCallSuccessResponse(
  id: string,
  value: unknown,
): IframeCallResponse {
  return {
    protocol: "iframecall",
    version: 1,
    id,
    ok: true,
    value,
  };
}

/** iframe -> host 방향 command 실패 응답 envelope을 만든다. */
export function createIframeCallErrorResponse(
  id: string,
  error: SerializedIframeCallError,
): IframeCallResponse {
  return {
    protocol: "iframecall",
    version: 1,
    id,
    ok: false,
    error,
  };
}

/** iframe -> host 방향 notify envelope을 만든다. id 없이 event 이름과 payload만 가진다. */
export function createIframeCallNotify(
  event: string,
  payload: unknown,
): IframeCallNotify {
  return {
    protocol: "iframecall",
    version: 1,
    event,
    payload,
  };
}

/**
 * postMessage로 받은 임의의 값을 iframecall envelope으로 파싱한다.
 * `protocol`/`version`이 어긋나거나 envelope 형태가 어떤 분기와도 일치하지 않으면 null을 돌려준다.
 * 호출 측은 origin/source 검증 후 이 함수의 결과를 신뢰해 dispatch한다.
 */
export function parseIframeCallMessage(
  value: unknown,
): ParsedIframeCallMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.protocol !== "iframecall" || value.version !== 1) {
    return null;
  }

  if (isIframeCallRequest(value)) {
    return { type: "request", message: value };
  }

  if (isIframeCallResponse(value)) {
    return { type: "response", message: value };
  }

  if (isIframeCallNotify(value)) {
    return { type: "notify", message: value };
  }

  return null;
}

/**
 * request envelope 판별. response/notify와의 모호성을 막기 위해
 * 다른 분기 전용 키(`ok`/`event`/`payload`)가 함께 있으면 거부한다.
 */
function isIframeCallRequest(
  value: Record<string, unknown>,
): value is IframeCallRequest {
  return (
    typeof value.id === "string" &&
    typeof value.cmd === "string" &&
    Array.isArray(value.args) &&
    !("ok" in value) &&
    !("event" in value) &&
    !("payload" in value)
  );
}

/**
 * response envelope 판별. `ok` 분기에 따라 성공 응답은 `value`,
 * 실패 응답은 직렬화된 에러 객체를 요구한다.
 */
function isIframeCallResponse(
  value: Record<string, unknown>,
): value is IframeCallResponse {
  if (typeof value.id !== "string" || !("ok" in value)) {
    return false;
  }

  if (value.ok === true) {
    return (
      "value" in value &&
      !("cmd" in value) &&
      !("event" in value) &&
      !("args" in value)
    );
  }

  if (value.ok === false) {
    return (
      isSerializedIframeCallError(value.error) &&
      !("cmd" in value) &&
      !("event" in value) &&
      !("args" in value) &&
      !("value" in value)
    );
  }

  return false;
}

/**
 * notify envelope 판별. id/cmd/ok 같은 다른 분기 키가 섞이면 거부한다.
 * payload는 undefined도 허용해야 하므로 `in` 검사로만 확인한다.
 */
function isIframeCallNotify(
  value: Record<string, unknown>,
): value is IframeCallNotify {
  return (
    typeof value.event === "string" &&
    !("id" in value) &&
    !("cmd" in value) &&
    !("ok" in value) &&
    "payload" in value
  );
}

// errors.ts와 동일한 검사를 가지지만 messages.ts가 errors.ts에 의존하지 않도록 내부에 둔다.
function isSerializedIframeCallError(
  value: unknown,
): value is SerializedIframeCallError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

// postMessage 데이터는 임의 값이 들어올 수 있어 object 검사부터 안전하게 시작한다.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
