// iframe 측 통신 흐름을 한 줄짜리 console.debug로 출력하는 dev 전용 helper.
// raw payload를 그대로 흘리므로 production logging에는 사용하지 않는다.

import type { IframeDebugEvent } from "../core/types.ts";

/** consoleDebugLogger 옵션. prefix를 명시하지 않으면 [iframecall:iframe]가 기본값이다. */
export type ConsoleDebugLoggerOptions = {
  readonly prefix?: string;
};

/**
 * iframe runner의 iframeHelper.debug.subscribe에 그대로 넘길 수 있는 console.debug 출력 함수.
 * event type별로 핵심 식별자(command/event)를 첫 인자에 포함하고,
 * raw payload(args/value/error/payload)를 두 번째 인자로 전달한다.
 */
export function consoleDebugLogger(
  options: ConsoleDebugLoggerOptions = {},
): (event: IframeDebugEvent) => void {
  const prefix = options.prefix ?? "[iframecall:iframe]";
  const head = prefix.length > 0 ? `${prefix} ` : "";

  return (event) => {
    switch (event.type) {
      case "commandReceivedFromHost":
        console.debug(`${head}${event.type} ${event.command}`, event.args);
        return;
      case "commandResultSentToHost":
        console.debug(`${head}${event.type} ${event.command}`, event.value);
        return;
      case "commandErrorSentToHost":
        console.debug(`${head}${event.type} ${event.command}`, event.error);
        return;
      case "notificationSentToHost":
        console.debug(`${head}${event.type} ${event.event}`, event.payload);
        return;
      case "notificationReceivedFromHost":
        console.debug(`${head}${event.type} ${event.event}`, event.payload);
        return;
    }
  };
}
