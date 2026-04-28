"use client";

import type { IframeDebugEvent } from "@cp949/iframecall/iframe";
import { useIframeCallRunner } from "@cp949/iframecall/iframe";
// monorepo에 react 18/19 typings이 동시 존재해 함수 반환 타입 추론이 portable하지 않다는 TS2883 회피용.
import type React from "react";
import { useEffect, useState } from "react";
import { AppCommands, type AppNotifications } from "./appCommands";

type LogEntry = { id: number; time: string; text: string };

let nextId = 0;

function makeEntry(text: string): LogEntry {
  return {
    id: nextId++,
    time: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
    text,
  };
}

function formatDebugEvent(ev: IframeDebugEvent): string {
  switch (ev.type) {
    case "commandReceivedFromHost":
      return `← call ${ev.command}(${ev.args.map((a) => JSON.stringify(a)).join(", ")})`;
    case "commandResultSentToHost":
      return `→ ${JSON.stringify(ev.value)}`;
    case "commandErrorSentToHost":
      return `→ Error: ${ev.error.message}`;
    case "notificationSentToHost":
      return `→ notify ${ev.event}: ${JSON.stringify(ev.payload)}`;
    case "notificationReceivedFromHost":
      return `← notify ${ev.event}: ${JSON.stringify(ev.payload)}`;
  }
}

const HOST_ORIGIN = "http://localhost:3300";

export default function IframePage(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const { iframeHelper, commands, isActive } = useIframeCallRunner<
    AppCommands,
    AppNotifications
  >({
    targetOrigin: HOST_ORIGIN,
    allowedOrigins: [HOST_ORIGIN],
    Commands: AppCommands,
    debugLog: true,
  });

  useEffect(() => {
    if (!iframeHelper || !commands) return;

    commands._sendLifecycleReady();

    const offStatus = commands._onStatusChange((s) => {
      setLogs((prev) => [...prev, makeEntry(`local status: ${s}`)]);
    });
    const offDebug = iframeHelper.debug.subscribe((ev) => {
      setLogs((prev) => [...prev, makeEntry(formatDebugEvent(ev))]);
    });

    return () => {
      offStatus();
      offDebug();
    };
  }, [iframeHelper, commands]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 4 }}>iframecall demo — iframe (React 19)</h1>
      <p style={{ marginBottom: 12, color: "#666" }}>
        status: <strong>{isActive ? "active" : "initializing"}</strong>
      </p>

      <h2 style={{ marginBottom: 8 }}>Communication Log</h2>
      <div
        style={{
          height: 300,
          overflowY: "auto",
          border: "1px solid #ddd",
          padding: 8,
          background: "#fff",
          borderRadius: 4,
        }}
      >
        {logs.length === 0 && (
          <span style={{ color: "#aaa" }}>host 연결 대기 중…</span>
        )}
        {logs.map((log) => (
          <div key={log.id}>
            <span style={{ color: "#999" }}>{log.time}</span> {log.text}
          </div>
        ))}
      </div>
    </div>
  );
}
