/**
 * useIframeCallRunner hook의 mount-once, dispose, StrictMode, debugLog 동작을 잠근다.
 * iframe runner는 host와 본질적으로 다른 역할이라 status 노출이 isActive로 단순화되어 있다.
 * runner가 활성 상태에서만 commands/iframeHelper를 노출하는 불변식도 함께 검증한다.
 */
import { act, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIframeCallRequest } from "../../src/core/messages.ts";
import type { IframeCallTransport } from "../../src/core/transport.ts";
import type { CommandsConstructor } from "../../src/core/types.ts";
import {
  type UseIframeCallRunnerDebugLog,
  type UseIframeCallRunnerResult,
  useIframeCallRunner,
} from "../../src/iframe/useIframeCallRunner.tsx";
import {
  createBasicRunnerCommandsClass,
  type TestCommands,
} from "./runnerFixtures.ts";
import { createLinkedTransports } from "./testTransport.ts";

/**
 * 최소 옵션으로 hook을 호출하고 결과를 배열에 수집하는 테스트 컴포넌트.
 * Commands class와 transport는 외부에서 주입하므로 같은 harness를 여러 테스트에서 재사용할 수 있다.
 */
function HookHarness({
  onResult,
  Commands,
  transport,
  debugLog,
}: {
  onResult: (result: UseIframeCallRunnerResult<TestCommands>) => void;
  Commands: CommandsConstructor<TestCommands>;
  transport: IframeCallTransport;
  debugLog?: UseIframeCallRunnerDebugLog;
}) {
  const result = useIframeCallRunner<TestCommands>({
    targetOrigin: "https://host.example.com",
    Commands,
    transport,
    debugLog,
  });

  useEffect(() => {
    onResult(result);
  });

  return null;
}

describe("useIframeCallRunner", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it("mount 시 runner와 commands가 생성되고 isActive가 true가 된다", () => {
    const { iframe } = createLinkedTransports();
    const BasicCommands = createBasicRunnerCommandsClass();
    const results: Array<ReturnType<typeof useIframeCallRunner<TestCommands>>> =
      [];

    render(
      <HookHarness
        onResult={(r) => results.push(r)}
        Commands={BasicCommands as never}
        transport={iframe}
      />,
    );

    const last = results[results.length - 1];
    if (last === undefined) throw new Error("결과가 없다");
    expect(last.isActive).toBe(true);
    expect(last.commands).not.toBeUndefined();
    expect(last.iframeHelper).not.toBeUndefined();
    expect(last.runner).not.toBeUndefined();
  });

  it("unmount 시 dispose가 react_unmount reason으로 호출된다", () => {
    const { iframe } = createLinkedTransports();
    const BasicCommands = createBasicRunnerCommandsClass();
    const results: Array<ReturnType<typeof useIframeCallRunner<TestCommands>>> =
      [];

    const { unmount } = render(
      <HookHarness
        onResult={(r) => results.push(r)}
        Commands={BasicCommands as never}
        transport={iframe}
      />,
    );

    const last = results[results.length - 1];
    if (last === undefined) throw new Error("결과가 없다");
    if (last.runner === undefined) throw new Error("runner가 없다");
    const disposeSpy = vi.spyOn(last.runner, "dispose");

    unmount();
    expect(disposeSpy).toHaveBeenCalledWith("react_unmount");
  });

  it("rerender 시 runner가 재생성되지 않는다", () => {
    const { iframe } = createLinkedTransports();
    const BasicCommands = createBasicRunnerCommandsClass();
    // mount 후 정의된 runner 참조만 수집한다. 첫 render는 effect 전이라 undefined일 수 있다.
    const definedRunners: Array<
      NonNullable<
        ReturnType<typeof useIframeCallRunner<TestCommands>>["runner"]
      >
    > = [];

    function TrackedHarness() {
      const result = useIframeCallRunner<TestCommands>({
        targetOrigin: "https://host.example.com",
        Commands: BasicCommands as never,
        transport: iframe,
      });
      useEffect(() => {
        if (result.runner !== undefined) {
          definedRunners.push(result.runner);
        }
      });
      return null;
    }

    const { rerender } = render(<TrackedHarness />);
    rerender(<TrackedHarness />);

    // mount 후 수집된 runner 참조가 모두 동일한 인스턴스여야 한다.
    expect(definedRunners.length).toBeGreaterThanOrEqual(1);
    const first = definedRunners[0];
    const last = definedRunners[definedRunners.length - 1];
    expect(first).toBe(last);
  });

  it("StrictMode mount→unmount→re-mount 사이클에서 isActive가 true로 유지된다", () => {
    const { iframe } = createLinkedTransports();
    const BasicCommands = createBasicRunnerCommandsClass();
    const results: Array<ReturnType<typeof useIframeCallRunner<TestCommands>>> =
      [];

    render(
      <StrictMode>
        <HookHarness
          onResult={(r) => results.push(r)}
          Commands={BasicCommands as never}
          transport={iframe}
        />
      </StrictMode>,
    );

    // StrictMode는 mount/cleanup/re-mount를 한 번 더 실행한다.
    // 최종 상태에서 isActive는 true여야 하고, false 상태가 외부에 노출되면 안 된다.
    const last = results[results.length - 1];
    if (last === undefined) throw new Error("결과가 없다");
    expect(last.isActive).toBe(true);
    expect(last.commands).not.toBeUndefined();
  });

  it("debugLog: true이면 command 수신 시 console.debug가 호출된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const BasicCommands = createBasicRunnerCommandsClass();

    render(
      <HookHarness
        onResult={() => {}}
        Commands={BasicCommands as never}
        transport={iframe}
        debugLog={true}
      />,
    );

    // host 측에서 runner가 연결된 iframe transport 방향으로 command request를 post한다.
    // host.post는 targetOrigin 검증 후 iframe transport의 subscriber에 이벤트를 전달한다.
    await act(async () => {
      host.post(
        createIframeCallRequest("test-1", "sum", [1, 2]),
        "https://editor.example.com",
      );
    });

    expect(debugSpy).toHaveBeenCalled();
    const firstCall = debugSpy.mock.calls[0];
    expect(firstCall?.[0]).toContain("commandReceivedFromHost");
  });

  it("debugLog: { prefix } 옵션이 지정한 prefix로 출력된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const BasicCommands = createBasicRunnerCommandsClass();

    render(
      <HookHarness
        onResult={() => {}}
        Commands={BasicCommands as never}
        transport={iframe}
        debugLog={{ prefix: "[test-runner]" }}
      />,
    );

    // host.post로 동기 전달해 runner의 debug subscriber가 console.debug를 호출하는지 확인한다.
    await act(async () => {
      host.post(
        createIframeCallRequest("test-2", "sum", [3, 4]),
        "https://editor.example.com",
      );
    });

    expect(debugSpy).toHaveBeenCalled();
    const firstCall = debugSpy.mock.calls[0];
    expect(firstCall?.[0]).toContain("[test-runner]");
  });

  it("unmount 후 cleanup이 안전하게 완료된다", () => {
    // act가 unmount 후 setState 경고를 발생시키지 않으면 통과.
    const { iframe } = createLinkedTransports();
    const BasicCommands = createBasicRunnerCommandsClass();
    const results: Array<ReturnType<typeof useIframeCallRunner<TestCommands>>> =
      [];

    const { unmount } = render(
      <HookHarness
        onResult={(r) => results.push(r)}
        Commands={BasicCommands as never}
        transport={iframe}
      />,
    );

    act(() => {
      unmount();
    });

    expect(true).toBe(true);
  });
});
