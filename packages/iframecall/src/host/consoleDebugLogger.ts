// host 측 통신 흐름을 한 줄짜리 console.debug로 출력하는 dev 전용 helper.
// raw payload를 그대로 흘리므로 production logging에는 사용하지 않는다.

import type { HostDebugEvent } from "../core/types.ts";

/** consoleDebugLogger 옵션. prefix를 명시하지 않으면 [iframecall:host]가 기본값이다. */
export type ConsoleDebugLoggerOptions = {
  readonly prefix?: string;
};

/**
 * host controller.debug.subscribe에 그대로 넘길 수 있는 console.debug 출력 함수.
 * event type별로 핵심 식별자(command/event/reason)를 첫 인자에 포함하고,
 * raw payload(args/value/error/payload)를 두 번째 인자로 전달해 DevTools에서 펼쳐 볼 수 있게 한다.
 */
export function consoleDebugLogger(
  options: ConsoleDebugLoggerOptions = {},
): (event: HostDebugEvent) => void {
  const prefix = options.prefix ?? "[iframecall:host]";
  const head = prefix.length > 0 ? `${prefix} ` : "";

  return (event) => {
    switch (event.type) {
      case "commandSentToIframe":
        console.debug(`${head}${event.type} ${event.command}`, event.args);
        return;
      case "commandResultReceivedFromIframe":
        console.debug(`${head}${event.type} ${event.command}`, event.value);
        return;
      case "commandErrorReceivedFromIframe":
        console.debug(`${head}${event.type} ${event.command}`, event.error);
        return;
      case "notificationReceivedFromIframe":
        console.debug(`${head}${event.type} ${event.event}`, event.payload);
        return;
      case "readyReceived":
        console.debug(`${head}${event.type}`, event.payload);
        return;
      case "terminatedReceived":
        console.debug(`${head}${event.type} ${event.reason}`, event.error);
        return;
    }
  };
}
