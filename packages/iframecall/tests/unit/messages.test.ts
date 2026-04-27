/**
 * iframecall v0 wire message parser를 검증한다.
 * request, response, notify 판별과 invalid message drop 규칙을 함께 다룬다.
 */
import { describe, expect, it } from "vitest";
import {
  createIframeCallErrorResponse,
  createIframeCallNotify,
  createIframeCallRequest,
  createIframeCallSuccessResponse,
  parseIframeCallMessage,
} from "../../src/host/index.ts";

describe("검증: iframecall 메시지", () => {
  it("요청 message를 생성하고 다시 request로 판별한다", () => {
    const message = createIframeCallRequest("id-1", "sum", [1, 2]);

    expect(parseIframeCallMessage(message)).toEqual({
      type: "request",
      message,
    });
  });

  it("성공 response message를 생성하고 다시 response로 판별한다", () => {
    const message = createIframeCallSuccessResponse("id-1", 3);

    expect(parseIframeCallMessage(message)).toEqual({
      type: "response",
      message,
    });
  });

  it("실패 response message를 생성하고 다시 response로 판별한다", () => {
    const message = createIframeCallErrorResponse("id-1", {
      code: "command_failed",
      message: "Command failed.",
      command: "sum",
    });

    expect(parseIframeCallMessage(message)).toEqual({
      type: "response",
      message,
    });
  });

  it("알림 message를 생성하고 다시 notify로 판별한다", () => {
    const message = createIframeCallNotify("ready", { protocolVersion: 1 });

    expect(parseIframeCallMessage(message)).toEqual({
      type: "notify",
      message,
    });
  });

  it("프로토콜이나 version이 다르면 null을 반환한다", () => {
    expect(
      parseIframeCallMessage({ protocol: "other", version: 1 }),
    ).toBeNull();
    expect(
      parseIframeCallMessage({ protocol: "iframecall", version: 2 }),
    ).toBeNull();
  });

  it("동작: id가 있는 notify는 invalid message로 보고 null을 반환한다", () => {
    expect(
      parseIframeCallMessage({
        protocol: "iframecall",
        version: 1,
        id: "bad",
        event: "ready",
        payload: {},
      }),
    ).toBeNull();
  });

  it("서로 다른 message shape 필드가 섞이면 null을 반환한다", () => {
    expect(
      parseIframeCallMessage({
        protocol: "iframecall",
        version: 1,
        id: "id-1",
        cmd: "sum",
        args: [],
        payload: {},
      }),
    ).toBeNull();
    expect(
      parseIframeCallMessage({
        protocol: "iframecall",
        version: 1,
        id: "id-1",
        ok: true,
        value: 3,
        args: [],
      }),
    ).toBeNull();
  });
});
