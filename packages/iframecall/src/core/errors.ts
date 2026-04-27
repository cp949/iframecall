// iframecall 프로토콜이 host와 iframe 사이에서 주고받는 직렬화된 에러 객체를 만드는 유틸이다.
// 도메인 코드가 던지는 throw 값(Error, 임의의 객체, 문자열 등)을 wire 포맷에 맞춰 정규화한다.

import type { SerializedIframeCallError } from "./types.ts";

type ErrorOptions = {
  readonly command?: string;
  readonly details?: unknown;
  readonly cause?: SerializedIframeCallError;
};

/**
 * 직렬화된 iframecall 에러 객체를 생성한다.
 * `command`/`details`/`cause`가 명시적으로 전달되지 않으면 결과 객체에서도 키를 누락시켜
 * postMessage 직렬화 결과가 호출자 의도와 어긋나지 않게 한다.
 */
export function createIframeCallError(
  code: string,
  message: string,
  options: ErrorOptions = {},
): SerializedIframeCallError {
  return {
    code,
    message,
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  };
}

/**
 * 임의의 throw 값을 직렬화된 iframecall 에러로 정규화한다.
 * - 이미 직렬화된 형태면 `command` 정보가 비어 있을 때만 보강한다.
 * - 실제 Error 인스턴스는 message만 살리고 name은 details에 보존한다.
 * - 그 외 값은 문자열화한 결과를 message로, 원본을 details로 남긴다.
 */
export function serializeIframeCallError(
  value: unknown,
  command?: string,
): SerializedIframeCallError {
  if (isSerializedIframeCallError(value)) {
    return {
      ...value,
      ...(value.command === undefined && command !== undefined
        ? { command }
        : {}),
    };
  }

  if (value instanceof Error) {
    return createIframeCallError("command_failed", value.message, {
      command,
      details: { name: value.name },
    });
  }

  return createIframeCallError("command_failed", String(value), {
    command,
    details: value,
  });
}

/**
 * 임의의 값이 이미 직렬화된 iframecall 에러 형태인지 검사한다.
 * `code`와 `message`가 모두 string이어야 한다.
 */
export function isSerializedIframeCallError(
  value: unknown,
): value is SerializedIframeCallError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}
