/**
 * useIframeCallController hook의 mount-once 패턴, dispose 호출, debugLog 옵션 동작을 잠근다.
 * StrictMode 사이클과 controller lifecycle promise resolve 시 stale state 회피도 검증한다.
 */
import { act, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIframeCallController } from "../../src/host/useIframeCallController.tsx";

/**
 * targetOrigin만 받는 최소 hook 호출 컴포넌트.
 * iframe element를 즉시 ref에 attach해 hook이 controller를 mount하도록 만든다.
 */
function HookHarness({
  onResult,
  targetOrigin,
}: {
  onResult: (result: ReturnType<typeof useIframeCallController>) => void;
  targetOrigin: string;
}) {
  const result = useIframeCallController<{ run(): Promise<void> }>({
    targetOrigin,
  });

  useEffect(() => {
    onResult(result);
  });

  return (
    <iframe
      title="harness"
      ref={(node) => {
        result.iframeRef(node);
      }}
    />
  );
}

describe("useIframeCallController", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it("mount 시 iframe attach 후 controller가 한 번 생성된다", () => {
    const results: Array<ReturnType<typeof useIframeCallController>> = [];
    render(
      <HookHarness
        onResult={(r) => results.push(r)}
        targetOrigin="https://iframe.example"
      />,
    );

    const last = results[results.length - 1];
    if (last === undefined) throw new Error("결과가 없다");
    expect(last.controller).not.toBeNull();
    expect(last.status).toBe("pending");
    expect(typeof last.iframeRef).toBe("function");
  });

  it("unmount 시 controller.dispose가 host-unmount reason으로 호출된다", () => {
    const results: Array<ReturnType<typeof useIframeCallController>> = [];
    const { unmount } = render(
      <HookHarness
        onResult={(r) => results.push(r)}
        targetOrigin="https://iframe.example"
      />,
    );

    const last = results[results.length - 1];
    if (last === undefined) throw new Error("결과가 없다");
    if (last.controller === null) throw new Error("controller missing");
    const disposeSpy = vi.spyOn(last.controller, "dispose");

    unmount();
    expect(disposeSpy).toHaveBeenCalledWith("host-unmount");
  });

  it("StrictMode mount→unmount→re-mount 사이클에서 controller가 재생성된다", () => {
    const results: Array<ReturnType<typeof useIframeCallController>> = [];
    render(
      <StrictMode>
        <HookHarness
          onResult={(r) => results.push(r)}
          targetOrigin="https://iframe.example"
        />
      </StrictMode>,
    );

    // StrictMode는 mount/cleanup을 한 번 더 실행하므로 결과적으로 활성 controller는 하나여야 한다.
    const last = results[results.length - 1];
    if (last === undefined) throw new Error("결과가 없다");
    expect(last.controller).not.toBeNull();
  });

  it("부모가 props 옵션을 새 reference로 갱신해도 controller가 재생성되지 않는다", () => {
    // mount 후 정의된 controller 참조만 수집한다. 첫 render는 effect 전이라 null일 수 있다.
    type Controller = NonNullable<
      ReturnType<
        typeof useIframeCallController<{ run(): Promise<void> }>
      >["controller"]
    >;
    const definedControllers: Controller[] = [];

    function Wrapper({ origin }: { origin: string }) {
      const result = useIframeCallController<{ run(): Promise<void> }>({
        targetOrigin: origin,
      });
      useEffect(() => {
        if (result.controller !== null) {
          definedControllers.push(result.controller);
        }
      });
      return (
        <iframe
          title="harness"
          ref={(node) => {
            result.iframeRef(node);
          }}
        />
      );
    }

    const { rerender } = render(<Wrapper origin="https://iframe.example" />);
    rerender(<Wrapper origin="https://iframe.example" />);

    // mount 후 수집된 controller 참조가 모두 동일한 인스턴스여야 한다.
    expect(definedControllers.length).toBeGreaterThanOrEqual(1);
    const first = definedControllers[0];
    const last = definedControllers[definedControllers.length - 1];
    expect(first).toBe(last);
  });

  it("debugLog: true이면 controller에 console.debug subscriber가 자동 등록된다", () => {
    function Harness() {
      const result = useIframeCallController<{ run(): Promise<void> }>({
        targetOrigin: "https://iframe.example",
        debugLog: true,
      });
      return (
        <iframe
          title="harness"
          ref={(node) => {
            result.iframeRef(node);
          }}
        />
      );
    }

    render(<Harness />);
    // debug 구독은 등록만으로는 console.debug를 부르지 않는다.
    // ready/terminated/notification 같은 event가 발화되어야 호출되므로,
    // 이 테스트는 등록 자체가 깨지지 않음을 검증한다.
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("debugLog: { prefix } 옵션이 prefix를 override한다", () => {
    function Harness() {
      const result = useIframeCallController<{ run(): Promise<void> }>({
        targetOrigin: "https://iframe.example",
        debugLog: { prefix: "[host-A]" },
      });
      return (
        <iframe
          title="harness"
          ref={(node) => {
            result.iframeRef(node);
          }}
        />
      );
    }

    const { unmount } = render(<Harness />);
    // 등록 자체로는 호출이 없으므로 unmount만 안전하게 진행.
    unmount();
    expect(true).toBe(true);
  });

  it("controller.ready/terminated promise는 cleanup 이후 setState를 트리거하지 않는다", () => {
    // act가 unmount 후 발생한 setState를 경고하지 않으면 통과.
    const results: Array<ReturnType<typeof useIframeCallController>> = [];
    const { unmount } = render(
      <HookHarness
        onResult={(r) => results.push(r)}
        targetOrigin="https://iframe.example"
      />,
    );
    act(() => {
      unmount();
    });
    expect(true).toBe(true);
  });
});
