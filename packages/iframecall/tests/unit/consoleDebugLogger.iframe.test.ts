/**
 * iframe용 consoleDebugLogger의 출력 포맷과 prefix 기본값을 잠근다.
 * IframeDebugEvent 5종을 모두 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consoleDebugLogger } from "../../src/iframe/consoleDebugLogger.ts";

describe("iframe consoleDebugLogger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it("prefix 옵션 없이 호출하면 기본 prefix [iframecall:iframe]를 사용한다", () => {
    const log = consoleDebugLogger();
    log({ type: "commandReceivedFromHost", command: "run", args: [1] });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:iframe] commandReceivedFromHost run",
      [1],
    );
  });

  it("commandResultSentToHost는 command 식별자와 value를 출력한다", () => {
    const log = consoleDebugLogger();
    log({ type: "commandResultSentToHost", command: "run", value: "ok" });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:iframe] commandResultSentToHost run",
      "ok",
    );
  });

  it("commandErrorSentToHost는 command와 error를 출력한다", () => {
    const log = consoleDebugLogger();
    const error = {
      protocol: "iframecall" as const,
      version: 1 as const,
      code: "invalid_args" as const,
      message: "boom",
    };
    log({ type: "commandErrorSentToHost", command: "run", error });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:iframe] commandErrorSentToHost run",
      error,
    );
  });

  it("notificationSentToHost는 event 식별자와 payload를 전달한다", () => {
    const log = consoleDebugLogger();
    log({
      type: "notificationSentToHost",
      event: "stateChanged",
      payload: { dirty: true },
    });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:iframe] notificationSentToHost stateChanged",
      { dirty: true },
    );
  });

  it("notificationReceivedFromHost는 event 식별자와 payload를 전달한다", () => {
    const log = consoleDebugLogger();
    log({
      type: "notificationReceivedFromHost",
      event: "ping",
      payload: { value: 1 },
    });
    expect(debugSpy).toHaveBeenCalledWith(
      "[iframecall:iframe] notificationReceivedFromHost ping",
      { value: 1 },
    );
  });

  it("커스텀 prefix를 그대로 사용한다", () => {
    const log = consoleDebugLogger({ prefix: "[ifr-A]" });
    log({ type: "commandReceivedFromHost", command: "run", args: [] });
    expect(debugSpy).toHaveBeenCalledWith(
      "[ifr-A] commandReceivedFromHost run",
      [],
    );
  });

  it("빈 prefix는 prefix 없이 출력한다", () => {
    const log = consoleDebugLogger({ prefix: "" });
    log({ type: "commandReceivedFromHost", command: "run", args: [] });
    expect(debugSpy).toHaveBeenCalledWith("commandReceivedFromHost run", []);
  });
});
