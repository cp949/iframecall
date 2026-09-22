import { describe, expect, it, vi } from "vitest";
import { createIframeCallError } from "../../src/core/errors.ts";
import {
  createIframeCallSuccessResponse,
  parseIframeCallMessage,
} from "../../src/core/messages.ts";
import { createInvocationLedger } from "../../src/host/invocationLedger.ts";
import { createLinkedTransports } from "./testTransport.ts";

describe("검증: host invocation ledger", () => {
  it("동작: ready flush 중 동기 response가 와도 queued invocation을 한 번만 settle한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const sent: string[] = [];
    const ledger = createInvocationLedger({
      transport: host,
      targetOrigin: "https://editor.example.com",
      readyPolicy: "queue",
      readyQueueLimit: Number.POSITIVE_INFINITY,
      onCommandSent(command) {
        sent.push(command);
      },
    });
    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") ledger.settle(parsed.message);
    });

    iframe.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type !== "request") return;
      iframe.post(
        createIframeCallSuccessResponse(parsed.message.id, 3),
        "https://host.example.com",
      );
    });
    const result = ledger.invoke(() => "id-1", "sum", [1, 2], {
      timeoutMs: 0,
    });
    ledger.acceptReady();

    await expect(result).resolves.toBe(3);
    expect(sent).toEqual(["sum"]);
  });

  it("동작: queued invocation은 ready 전에 deadline이 지나면 이후 ready에서도 post하지 않는다", async () => {
    vi.useFakeTimers();
    const { host } = createLinkedTransports();
    const ledger = createInvocationLedger({
      transport: host,
      targetOrigin: "https://editor.example.com",
      readyPolicy: "queue",
      readyQueueLimit: Number.POSITIVE_INFINITY,
      onCommandSent() {},
    });

    const result = ledger.invoke(() => "id-1", "sum", [1, 2], {
      timeoutMs: 10,
    });
    const timedOut = expect(result).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10);
    ledger.acceptReady();

    await timedOut;
    expect(host.getPosts()).toEqual([]);
    vi.useRealTimers();
  });

  it("동작: post failure는 해당 invocation만 invalid_args로 reject하고 다음 invocation은 계속 보낸다", async () => {
    const { host, iframe } = createLinkedTransports();
    const ledger = createInvocationLedger({
      transport: host,
      targetOrigin: "https://editor.example.com",
      readyPolicy: "queue",
      readyQueueLimit: Number.POSITIVE_INFINITY,
      onCommandSent() {},
    });
    ledger.acceptReady();
    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") ledger.settle(parsed.message);
    });
    host.failNextPost(new DOMException("Cannot clone.", "DataCloneError"));

    const failed = ledger.invoke(() => "id-1", "sum", [1, 2], { timeoutMs: 0 });
    const sent = ledger.invoke(() => "id-2", "sum", [3, 4], { timeoutMs: 0 });
    iframe.post(
      createIframeCallSuccessResponse("id-2", 7),
      "https://host.example.com",
    );

    await expect(failed).rejects.toMatchObject({ code: "invalid_args" });
    await expect(sent).resolves.toBe(7);
  });

  it("동작: termination은 queued와 pending invocation을 기존 lifecycle error로 reject한다", async () => {
    const { host } = createLinkedTransports();
    const ledger = createInvocationLedger({
      transport: host,
      targetOrigin: "https://editor.example.com",
      readyPolicy: "queue",
      readyQueueLimit: Number.POSITIVE_INFINITY,
      onCommandSent() {},
    });

    const queued = ledger.invoke(() => "queued", "sum", [1, 2], { timeoutMs: 0 });
    ledger.acceptReady();
    const pending = ledger.invoke(() => "pending", "sum", [3, 4], { timeoutMs: 0 });
    ledger.terminate((command) =>
      createIframeCallError("terminated", "Iframe terminated.", { command }),
    );

    await expect(queued).rejects.toMatchObject({ code: "terminated", command: "sum" });
    await expect(pending).rejects.toMatchObject({ code: "terminated", command: "sum" });
  });
});
