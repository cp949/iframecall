/**
 * 수신 이벤트의 origin, source, message 검증 순서와 source 미지정 정책을 검증한다.
 * opaque origin 모드가 쓰는 source 필수 정책(requireSource)도 함께 다룬다.
 */
import { describe, expect, it } from "vitest";
import { validateInbound } from "../../src/core/inboundValidation.ts";

describe("검증: 수신 이벤트", () => {
  it("origin이 거부되면 source와 data를 읽지 않는다", () => {
    let sourceReads = 0;
    let dataReads = 0;
    const event = {
      origin: "https://evil.example.com",
      get source() {
        sourceReads += 1;
        return { name: "host" };
      },
      get data() {
        dataReads += 1;
        return { protocol: "iframecall" };
      },
    };

    expect(
      validateInbound(event, {
        allowedOrigins: new Set(["https://host.example.com"]),
        expectedSource: { name: "host" },
      }),
    ).toEqual({ accepted: false, reason: "origin" });
    expect(sourceReads).toBe(0);
    expect(dataReads).toBe(0);
  });

  it("source가 거부되면 data를 읽지 않는다", () => {
    let dataReads = 0;
    const event = {
      origin: "https://host.example.com",
      source: { name: "evil" },
      get data() {
        dataReads += 1;
        return { protocol: "iframecall" };
      },
    };

    expect(
      validateInbound(event, {
        allowedOrigins: new Set(["https://host.example.com"]),
        expectedSource: { name: "host" },
      }),
    ).toEqual({ accepted: false, reason: "source" });
    expect(dataReads).toBe(0);
  });

  it("origin, source, message 순서로 거부하고 source 미지정 시 검증을 생략한다", () => {
    const policy = {
      allowedOrigins: new Set(["https://host.example.com"]),
      expectedSource: { name: "host" },
    };

    expect(
      validateInbound(
        {
          data: { protocol: "iframecall" },
          origin: "https://evil.example.com",
          source: policy.expectedSource,
        },
        policy,
      ),
    ).toEqual({ accepted: false, reason: "origin" });

    expect(
      validateInbound(
        {
          data: { protocol: "iframecall" },
          origin: "https://host.example.com",
          source: {},
        },
        policy,
      ),
    ).toEqual({ accepted: false, reason: "source" });

    expect(
      validateInbound(
        {
          data: { protocol: "iframecall", version: 1 },
          origin: "https://host.example.com",
          source: policy.expectedSource,
        },
        policy,
      ),
    ).toEqual({ accepted: false, reason: "message" });

    expect(
      validateInbound(
        {
          data: {
            protocol: "iframecall",
            version: 1,
            id: "1",
            cmd: "sum",
            args: [],
          },
          origin: "https://host.example.com",
          source: {},
        },
        { allowedOrigins: policy.allowedOrigins },
      ),
    ).toMatchObject({ accepted: true, message: { type: "request" } });
  });

  it("requireSource가 켜져 있으면 expectedSource가 없을 때 source 단계에서 거부한다", () => {
    expect(
      validateInbound(
        {
          data: {
            protocol: "iframecall",
            version: 1,
            id: "1",
            cmd: "sum",
            args: [],
          },
          origin: "null",
          source: {},
        },
        { allowedOrigins: new Set(["null"]), requireSource: true },
      ),
    ).toEqual({ accepted: false, reason: "source" });
  });
});
