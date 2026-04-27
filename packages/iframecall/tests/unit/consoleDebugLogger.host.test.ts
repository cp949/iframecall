/**
 * host용 consoleDebugLogger의 출력 포맷과 prefix 기본값을 잠근다.
 * 실제 console.debug 호출 인자를 spy로 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consoleDebugLogger } from "../../src/host/consoleDebugLogger.ts";

describe("host consoleDebugLogger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it("prefix 옵션 없이 호출하면 기본 prefix [iframecall:host]를 사용한다", () => {
    const log = consoleDebugLogger();
    log({ type: "commandSentToIframe", command: "run", args: [1] });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:host] commandSentToIframe run",
      [1],
    );
  });

  it("커스텀 prefix는 그대로 사용한다", () => {
    const log = consoleDebugLogger({ prefix: "[host-A]" });
    log({ type: "commandSentToIframe", command: "run", args: [] });
    expect(debugSpy).toHaveBeenCalledWith(
      "[host-A] commandSentToIframe run",
      [],
    );
  });

  it("빈 prefix는 prefix 없이 출력한다", () => {
    const log = consoleDebugLogger({ prefix: "" });
    log({ type: "commandSentToIframe", command: "run", args: [] });
    expect(debugSpy).toHaveBeenCalledWith("commandSentToIframe run", []);
  });

  it("commandResultReceivedFromIframe은 command 식별자와 value를 출력한다", () => {
    const log = consoleDebugLogger();
    log({
      type: "commandResultReceivedFromIframe",
      command: "run",
      value: "ok",
    });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:host] commandResultReceivedFromIframe run",
      "ok",
    );
  });

  it("commandErrorReceivedFromIframe은 command와 error 객체를 출력한다", () => {
    const log = consoleDebugLogger();
    const error = {
      protocol: "iframecall" as const,
      version: 1 as const,
      code: "timeout" as const,
      message: "boom",
    };
    log({ type: "commandErrorReceivedFromIframe", command: "run", error });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:host] commandErrorReceivedFromIframe run",
      error,
    );
  });

  it("notificationReceivedFromIframe은 event 식별자와 payload를 출력한다", () => {
    const log = consoleDebugLogger();
    log({
      type: "notificationReceivedFromIframe",
      event: "stateChanged",
      payload: { dirty: true },
    });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:host] notificationReceivedFromIframe stateChanged",
      { dirty: true },
    );
  });

  it("readyReceived는 payload를 두 번째 인자로 전달한다", () => {
    const log = consoleDebugLogger();
    log({ type: "readyReceived", payload: { protocolVersion: 1 } });
    expect(debugSpy).toHaveBeenCalledWith("[iframecall:host] readyReceived", {
      protocolVersion: 1,
    });
  });

  it("terminatedReceived는 reason 식별자와 error 객체를 전달한다", () => {
    const log = consoleDebugLogger();
    log({
      type: "terminatedReceived",
      reason: "host-unmount",
      error: null,
    });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:host] terminatedReceived host-unmount",
      null,
    );
  });
});
