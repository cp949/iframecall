/**
 * 수신 이벤트의 origin, source, message 검증 순서와 source 미지정 정책을 검증한다.
 */
import { describe, expect, it } from "vitest";
import { validateInbound } from "../../src/core/inboundValidation.ts";

describe("검증: 수신 이벤트", () => {
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
});
