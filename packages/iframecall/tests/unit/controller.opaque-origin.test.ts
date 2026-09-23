/**
 * host controller의 opaque origin 모드(opaqueOrigin: true)를 검증한다.
 * sandbox="allow-scripts"로 띄운 iframe은 origin이 "null"이고 다른 사이트의 sandboxed frame과 구별되지 않으므로,
 * 송신은 "*"로 하되 수신은 origin "null"과 expected source가 모두 일치할 때만 받는지 확인한다.
 * opt-in 없는 wildcard 거부, 옵션 충돌 거부, iframe 요소 교체 시 이전 window 메시지 차단도 함께 다룬다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIframeCallController,
  createIframeCallNotify,
  createIframeCallSuccessResponse,
  type IframeCallTransport,
} from "../../src/host/index.ts";
import { createLinkedTransports } from "./testTransport.ts";

type TestCommands = {
  sum: (a: number, b: number) => number;
};

const HOST_ORIGIN = "https://host.example.com";

/**
 * promise가 아직 settle되지 않았는지 확인한다.
 * 위조 메시지가 ready/invoke를 건드리지 않았음을 검증할 때 사용한다.
 */
async function expectPending(promise: Promise<unknown>): Promise<void> {
  await Promise.resolve();
  await expect(
    Promise.race([promise, Promise.resolve("pending")]),
  ).resolves.toBe("pending");
}

/**
 * jsdom 문서에 iframe 요소를 붙여 contentWindow가 있는 상태로 만든다.
 * 기본 iframe transport를 실제 DOM 이벤트로 검증할 때 사용한다.
 */
function appendIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return iframe;
}

/**
 * sandboxed iframe이 host window로 보낸 message event를 흉내 낸다.
 * 브라우저에서 opaque origin 문서가 보낸 메시지의 origin은 "null"이다.
 */
function dispatchFromWindow(
  source: Window | null,
  data: unknown,
  origin = "null",
): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("검증: opt-in 없는 wildcard targetOrigin 거부", () => {
  it.each(["*", "null", ""])(
    "opaqueOrigin 없이 targetOrigin %j를 넘기면 invalid_origin을 던진다",
    (targetOrigin) => {
      const { host } = createLinkedTransports();

      expect(() =>
        createIframeCallController<TestCommands>({
          iframe: {} as HTMLIFrameElement,
          targetOrigin,
          transport: host,
        }),
      ).toThrow(expect.objectContaining({ code: "invalid_origin" }));
    },
  );
});

describe("검증: controller opaque origin 모드", () => {
  it('origin "null"과 expected source가 일치하는 ready를 받고 command를 "*"로 송신한다', async () => {
    const { host, iframe } = createLinkedTransports({ iframeOrigin: "null" });

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      opaqueOrigin: true,
      generateId: () => "id-1",
      transport: host,
    });

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      HOST_ORIGIN,
    );
    await controller.ready;

    const invokePromise = controller.invoke("sum", [1, 2], { timeoutMs: 1000 });
    expect(host.getPosts().at(-1)?.targetOrigin).toBe("*");

    iframe.post(createIframeCallSuccessResponse("id-1", 3), HOST_ORIGIN);
    await expect(invokePromise).resolves.toBe(3);
  });

  it('다른 opaque frame(origin "null", 다른 source)에서 온 위조 ready와 response를 거부한다', async () => {
    const { host, iframe } = createLinkedTransports({ iframeOrigin: "null" });
    const otherSandbox = { name: "other-sandbox" };

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      opaqueOrigin: true,
      generateId: () => "id-1",
      readyTimeoutMs: 0,
      transport: host,
    });

    host.emit({
      data: createIframeCallNotify("ready", { protocolVersion: 1 }),
      origin: "null",
      source: otherSandbox,
    });
    await expectPending(controller.ready);

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      HOST_ORIGIN,
    );
    await controller.ready;

    const invokePromise = controller.invoke("sum", [1, 2], { timeoutMs: 1000 });
    host.emit({
      data: createIframeCallSuccessResponse("id-1", 99),
      origin: "null",
      source: otherSandbox,
    });
    await expectPending(invokePromise);

    iframe.post(createIframeCallSuccessResponse("id-1", 3), HOST_ORIGIN);
    await expect(invokePromise).resolves.toBe(3);
  });

  it('source가 일치해도 origin이 "null"이 아니면 거부한다', async () => {
    const { host, iframeSource } = createLinkedTransports({
      iframeOrigin: "null",
    });

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      opaqueOrigin: true,
      readyTimeoutMs: 0,
      transport: host,
    });

    host.emit({
      data: createIframeCallNotify("ready", { protocolVersion: 1 }),
      origin: "https://editor.example.com",
      source: iframeSource,
    });
    await expectPending(controller.ready);
  });

  it("생성 후 transport의 expectedSource가 사라져도 source 검사를 생략하지 않는다", async () => {
    const { host, iframeSource } = createLinkedTransports({
      iframeOrigin: "null",
    });

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      opaqueOrigin: true,
      readyTimeoutMs: 0,
      transport: host,
    });
    host.expectedSource = undefined;

    host.emit({
      data: createIframeCallNotify("ready", { protocolVersion: 1 }),
      origin: "null",
      source: iframeSource,
    });
    await expectPending(controller.ready);
  });

  it("transport에 expectedSource가 없으면 invalid_origin을 던진다", () => {
    const transport: IframeCallTransport = {
      post() {},
      subscribe() {
        return () => {};
      },
    };

    expect(() =>
      createIframeCallController<TestCommands>({
        iframe: {} as HTMLIFrameElement,
        opaqueOrigin: true,
        transport,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_origin" }));
  });

  it("iframe이 문서에 붙지 않아 contentWindow가 없으면 invalid_origin을 던진다", () => {
    const detached = document.createElement("iframe");

    expect(() =>
      createIframeCallController<TestCommands>({
        iframe: detached,
        opaqueOrigin: true,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_origin" }));
  });

  it("targetOrigin과 함께 넘기면 invalid_origin을 던진다", () => {
    const { host } = createLinkedTransports({ iframeOrigin: "null" });

    expect(() =>
      // @ts-expect-error opaqueOrigin 모드는 targetOrigin을 받지 않는다.
      createIframeCallController<TestCommands>({
        iframe: {} as HTMLIFrameElement,
        opaqueOrigin: true,
        targetOrigin: "https://editor.example.com",
        transport: host,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_origin" }));
  });

  it("allowedOrigins와 함께 넘기면 invalid_origin을 던진다", () => {
    const { host } = createLinkedTransports({ iframeOrigin: "null" });

    expect(() =>
      // @ts-expect-error opaqueOrigin 모드는 allowedOrigins를 받지 않는다.
      createIframeCallController<TestCommands>({
        iframe: {} as HTMLIFrameElement,
        opaqueOrigin: true,
        allowedOrigins: ["null"],
        transport: host,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_origin" }));
  });
});

describe("검증: opaque origin 모드의 iframe 요소 교체", () => {
  it('기본 transport는 contentWindow에 "*"로 송신하고 해당 window의 메시지만 받는다', async () => {
    const element = appendIframe();
    const contentWindow = element.contentWindow;
    if (contentWindow === null) throw new Error("contentWindow가 없다");
    const postSpy = vi.spyOn(contentWindow, "postMessage");

    const controller = createIframeCallController<TestCommands>({
      iframe: element,
      opaqueOrigin: true,
      generateId: () => "id-1",
    });

    dispatchFromWindow(
      contentWindow,
      createIframeCallNotify("ready", { protocolVersion: 1 }),
    );
    await controller.ready;

    const invokePromise = controller.invoke("sum", [1, 2], { timeoutMs: 1000 });
    expect(postSpy).toHaveBeenCalledWith(expect.anything(), "*", undefined);

    dispatchFromWindow(
      contentWindow,
      createIframeCallSuccessResponse("id-1", 3),
    );
    await expect(invokePromise).resolves.toBe(3);
    await controller.dispose("test_cleanup");
  });

  it("요소를 교체하면 이전 controller의 대기 요청은 reject되고 새 controller는 이전 window의 늦은 메시지를 버린다", async () => {
    const oldElement = appendIframe();
    const oldWindow = oldElement.contentWindow;

    const oldController = createIframeCallController<TestCommands>({
      iframe: oldElement,
      opaqueOrigin: true,
      generateId: () => "id-1",
    });
    dispatchFromWindow(
      oldWindow,
      createIframeCallNotify("ready", { protocolVersion: 1 }),
    );
    await oldController.ready;
    const pending = oldController.invoke("sum", [1, 2], { timeoutMs: 0 });

    // 소비자는 요소 교체 시 이전 controller를 dispose하고 새 요소로 새 controller를 만든다.
    await oldController.dispose("iframe-replaced");
    await expect(pending).rejects.toMatchObject({ code: "terminated" });
    oldElement.remove();

    const newElement = appendIframe();
    const newController = createIframeCallController<TestCommands>({
      iframe: newElement,
      opaqueOrigin: true,
      readyTimeoutMs: 0,
    });

    dispatchFromWindow(
      oldWindow,
      createIframeCallNotify("ready", { protocolVersion: 1 }),
    );
    await expectPending(newController.ready);

    dispatchFromWindow(
      newElement.contentWindow,
      createIframeCallNotify("ready", { protocolVersion: 1 }),
    );
    await expect(newController.ready).resolves.toBeUndefined();
    await newController.dispose("test_cleanup");
  });
});
