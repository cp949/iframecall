/**
 * RM-063: iframe-side runner의 inbound origin 거부 정책을 검증한다.
 * allowedOrigins에 없는 origin에서 도착한 command request가 handler를 호출하지 않고
 * response를 보내지 않는지, "null" origin string도 동일하게 drop되는지 확인한다.
 */
import { describe, expect, it } from "vitest";
import { parseIframeCallMessage } from "../../src/host/index.ts";
import { createIframeCallRunner } from "../../src/iframe/index.ts";
import { createLinkedTransports } from "./testTransport.ts";

describe("검증: runner inbound origin 거부 정책", () => {
  it("동작: allowedOrigins에 없는 origin에서 온 command request는 handler를 호출하지 않고 response를 보내지 않는다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const handledCommands: string[] = [];
    const responses: unknown[] = [];

    class TrackingCommands {
      async sum(a: number, b: number) {
        handledCommands.push("sum");
        return a + b;
      }
    }

    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      // allowedOrigins를 명시적으로 설정해 거부 경계를 확인한다.
      allowedOrigins: ["https://host.example.com"],
      transport: iframe,
      Commands: TrackingCommands,
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    // 비허용 origin에서 온 request를 직접 inject한다.
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "id-1",
        cmd: "sum",
        args: [1, 2],
      },
      origin: "https://attacker.example.com",
      source: hostSource,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(handledCommands).toEqual([]);
    expect(responses).toEqual([]);
  });

  it('동작: origin이 문자열 "null"인 message도 drop된다', async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const handledCommands: string[] = [];
    const responses: unknown[] = [];

    class TrackingCommands {
      async sum(a: number, b: number) {
        handledCommands.push("sum");
        return a + b;
      }
    }

    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      allowedOrigins: ["https://host.example.com"],
      transport: iframe,
      Commands: TrackingCommands,
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    // origin이 "null" 문자열인 message를 직접 inject한다. (opaque origin 시뮬레이션)
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "id-2",
        cmd: "sum",
        args: [3, 4],
      },
      origin: "null",
      source: hostSource,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(handledCommands).toEqual([]);
    expect(responses).toEqual([]);
  });

  it("동작: allowedOrigins에 있는 정상 origin에서 온 request는 처리되고 response를 반환한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const responses: unknown[] = [];

    class SumCommands {
      async sum(a: number, b: number) {
        return a + b;
      }
    }

    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      allowedOrigins: ["https://host.example.com"],
      transport: iframe,
      Commands: SumCommands,
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    // linked transport를 통해 정상 origin 경로로 request를 전송한다.
    // host -> iframe 방향이므로 iframe transport가 host.example.com origin으로 수신한다.
    host.post(
      {
        protocol: "iframecall",
        version: 1,
        id: "id-3",
        cmd: "sum",
        args: [5, 6],
      },
      "https://editor.example.com",
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(responses).toHaveLength(1);
    // IframeCallResponse 성공 envelope의 결과값 필드는 `value`다.
    expect(responses[0]).toMatchObject({ id: "id-3", ok: true, value: 11 });
  });
});
