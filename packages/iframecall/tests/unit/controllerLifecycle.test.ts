/**
 * controller lifecycle 모듈의 ready/terminate 진입과 cleanup 멱등성을 검증한다.
 * fakeTimers로 readyTimeout 발화를, terminate 멱등성과 onCleanup 호출 횟수를 단위로 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createControllerLifecycle } from "../../src/host/controllerLifecycle.ts";

describe("검증: controllerLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("동작: markReady는 ready promise를 resolve하고 readyTimeout 발화를 막는다", async () => {
    const onTerminate = vi.fn();
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 100,
      onTerminate,
    });

    expect(lifecycle.isReady()).toBe(false);
    lifecycle.markReady();
    expect(lifecycle.isReady()).toBe(true);

    await expect(lifecycle.ready).resolves.toBeUndefined();

    vi.advanceTimersByTime(500);
    expect(onTerminate).not.toHaveBeenCalled();
    expect(lifecycle.isTerminated()).toBe(false);
  });

  it("동작: readyTimeoutMs가 지나면 timeout 에러로 terminate되고 ready가 reject된다", async () => {
    const onTerminate = vi.fn();
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 50,
      onTerminate,
    });
    // ready promise는 swallow가 lifecycle 내부에서 처리되더라도 외부 await에 대비해 별도 catch를 단다.
    const readyExpectation = expect(lifecycle.ready).rejects.toMatchObject({
      code: "timeout",
    });

    vi.advanceTimersByTime(50);
    await readyExpectation;

    expect(onTerminate).toHaveBeenCalledTimes(1);
    expect(onTerminate).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "timeout",
        details: { timeoutMs: 50 },
      }),
    );
    await expect(lifecycle.terminated).resolves.toMatchObject({
      code: "timeout",
    });
  });

  it("동작: readyTimeoutMs가 0이면 timeout을 무장하지 않는다", async () => {
    const onTerminate = vi.fn();
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 0,
      onTerminate,
    });

    vi.advanceTimersByTime(10_000);
    expect(onTerminate).not.toHaveBeenCalled();
    expect(lifecycle.isTerminated()).toBe(false);

    lifecycle.markReady();
    await expect(lifecycle.ready).resolves.toBeUndefined();
  });

  it("동작: readyTimeoutMs가 Infinity여도 timeout을 무장하지 않는다", () => {
    const onTerminate = vi.fn();
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: Number.POSITIVE_INFINITY,
      onTerminate,
    });

    vi.advanceTimersByTime(1_000_000);
    expect(onTerminate).not.toHaveBeenCalled();
    expect(lifecycle.isTerminated()).toBe(false);
  });

  it("동작: terminate는 멱등이라 두 번째 호출에도 onTerminate가 한 번만 실행된다", async () => {
    const onTerminate = vi.fn();
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 0,
      onTerminate,
    });
    const firstError = { code: "terminated", message: "first" };
    const secondError = { code: "terminated", message: "second" };

    lifecycle.terminate(firstError);
    lifecycle.terminate(secondError);

    expect(onTerminate).toHaveBeenCalledTimes(1);
    expect(onTerminate).toHaveBeenCalledWith(firstError);
    expect(lifecycle.getTerminatedError()).toBe(firstError);
    await expect(lifecycle.terminated).resolves.toBe(firstError);
  });

  it("동작: terminate 이후 markReady는 무시되어 isReady가 false로 유지된다", async () => {
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 0,
      onTerminate: vi.fn(),
    });
    const error = { code: "terminated", message: "boom" };

    lifecycle.terminate(error);
    lifecycle.markReady();

    expect(lifecycle.isReady()).toBe(false);
    await expect(lifecycle.ready).rejects.toBe(error);
  });

  it("동작: setOnCleanup으로 등록한 콜백은 cleanup 호출 시 한 번만 실행된다", () => {
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 0,
      onTerminate: vi.fn(),
    });
    const onCleanup = vi.fn();

    lifecycle.setOnCleanup(onCleanup);
    lifecycle.cleanup();
    lifecycle.cleanup();

    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it("동작: terminate가 onTerminate 다음에 cleanup을 함께 호출한다", () => {
    const events: string[] = [];
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 0,
      onTerminate: () => events.push("onTerminate"),
    });
    lifecycle.setOnCleanup(() => events.push("onCleanup"));

    lifecycle.terminate({ code: "terminated", message: "boom" });

    expect(events).toEqual(["onTerminate", "onCleanup"]);
  });

  it("동작: setOnCleanup 호출 전에 cleanup이 발생해도 throw하지 않고 이후 setOnCleanup은 다시 호출되지 않는다", () => {
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 0,
      onTerminate: vi.fn(),
    });

    expect(() => lifecycle.cleanup()).not.toThrow();

    const onCleanup = vi.fn();
    lifecycle.setOnCleanup(onCleanup);
    lifecycle.cleanup();

    // 이미 cleanupDone 상태이므로 등록한 콜백은 호출되지 않는다.
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it("동작: ready promise rejection은 lifecycle 내부에서 swallow되어 unhandled rejection이 발생하지 않는다", async () => {
    const lifecycle = createControllerLifecycle({
      readyTimeoutMs: 0,
      onTerminate: vi.fn(),
    });

    // 별도 await 없이 terminate만 호출해도 unhandled rejection이 보고되지 않아야 한다.
    lifecycle.terminate({ code: "terminated", message: "boom" });

    // 이후 await로 검증 시점에 잘 settle 됐음을 확인한다.
    await expect(lifecycle.ready).rejects.toMatchObject({ code: "terminated" });
    await expect(lifecycle.terminated).resolves.toMatchObject({
      code: "terminated",
    });
  });
});
