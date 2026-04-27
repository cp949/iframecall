"use client";

import type { IframeDebugEvent, IframeHelper } from "@cp949/iframecall/iframe";
import { useIframeCallRunner } from "@cp949/iframecall/iframe";
import { useEffect, useState } from "react";

type DemoCommands = {
  greet(name: string): Promise<string>;
  add(a: number, b: number): Promise<number>;
  delay(ms: number): Promise<void>;
};

type DemoEvents = {
  "status-changed": string;
};

class DemoCommandsImpl {
  constructor(private iframeHelper: IframeHelper<DemoEvents>) {}

  async greet(name: string): Promise<string> {
    this.iframeHelper.sendNotificationToHost("status-changed", "processing");
    const result = `Hello, ${name}!`;
    this.iframeHelper.sendNotificationToHost("status-changed", "idle");
    return result;
  }

  async add(a: number, b: number): Promise<number> {
    this.iframeHelper.sendNotificationToHost("status-changed", "processing");
    const result = a + b;
    this.iframeHelper.sendNotificationToHost("status-changed", "idle");
    return result;
  }

  async delay(ms: number): Promise<void> {
    this.iframeHelper.sendNotificationToHost("status-changed", "processing");
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    this.iframeHelper.sendNotificationToHost("status-changed", "idle");
  }
}

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

const HOST_ORIGIN = "http://localhost:3302";

export default function IframePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const { iframeHelper, isActive } = useIframeCallRunner<
    DemoCommands,
    DemoEvents
  >({
    targetOrigin: HOST_ORIGIN,
    allowedOrigins: [HOST_ORIGIN],
    Commands: DemoCommandsImpl,
    debugLog: true,
  });

  useEffect(() => {
    if (!iframeHelper) return;

    iframeHelper.sendNotificationToHost("status-changed", "ready");
    iframeHelper.sendReadyToHost();

    const unsubscribe = iframeHelper.debug.subscribe((ev) => {
      setLogs((prev) => [...prev, makeEntry(formatDebugEvent(ev))]);
    });

    return unsubscribe;
  }, [iframeHelper]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 4 }}>iframecall demo — iframe (React 18)</h1>
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
