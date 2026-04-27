/**
 * iframecall serialized error 변환 규칙을 검증한다.
 * Error, serialized error, primitive throw 값을 host에 전달 가능한 shape으로 바꾼다.
 */
import { describe, expect, it } from "vitest";
import {
  createIframeCallError,
  serializeIframeCallError,
} from "../../src/host/index.ts";

describe("검증: iframecall 에러", () => {
  it("표준 Error 인스턴스를 command_failed 에러로 직렬화한다", () => {
    const error = serializeIframeCallError(
      new TypeError("Bad image"),
      "updateImage",
    );

    expect(error).toEqual({
      code: "command_failed",
      message: "Bad image",
      command: "updateImage",
      details: { name: "TypeError" },
    });
  });

  it("이미 serialized error이면 그대로 command만 보강한다", () => {
    const error = serializeIframeCallError(
      {
        code: "invalid_args",
        message: "Invalid args.",
      },
      "updateImage",
    );

    expect(error).toEqual({
      code: "invalid_args",
      message: "Invalid args.",
      command: "updateImage",
    });
  });

  it("원시 throw 값을 문자열 message로 직렬화한다", () => {
    const error = serializeIframeCallError("boom", "requestImageResult");

    expect(error).toEqual({
      code: "command_failed",
      message: "boom",
      command: "requestImageResult",
      details: "boom",
    });
  });

  it("코드와 message로 기본 serialized error를 만든다", () => {
    expect(
      createIframeCallError("timeout", "Command timed out.", {
        command: "requestImageResult",
        details: { timeoutMs: 1000 },
      }),
    ).toEqual({
      code: "timeout",
      message: "Command timed out.",
      command: "requestImageResult",
      details: { timeoutMs: 1000 },
    });
  });
});
