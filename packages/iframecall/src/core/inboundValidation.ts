import {
  parseIframeCallMessage,
  type ParsedIframeCallMessage,
} from "./messages.ts";
import type { IframeCallTransportEvent } from "./transport.ts";

/** 수신 이벤트에 적용할 origin과 source 검증 정책. */
export type InboundPolicy = {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly expectedSource?: unknown;
};

/** 수신 이벤트 검증 결과. 거부 시 최초로 실패한 검증 단계를 나타낸다. */
export type InboundValidationResult =
  | { readonly accepted: true; readonly message: ParsedIframeCallMessage }
  | {
      readonly accepted: false;
      readonly reason: "origin" | "source" | "message";
    };

/** origin, source, message 순서로 수신 이벤트를 검증한다. */
export function validateInbound(
  event: IframeCallTransportEvent,
  policy: InboundPolicy,
): InboundValidationResult {
  if (!policy.allowedOrigins.has(event.origin)) {
    return { accepted: false, reason: "origin" };
  }

  if (
    policy.expectedSource !== undefined &&
    event.source !== policy.expectedSource
  ) {
    return { accepted: false, reason: "source" };
  }

  const message = parseIframeCallMessage(event.data);

  return message === null
    ? { accepted: false, reason: "message" }
    : { accepted: true, message };
}
