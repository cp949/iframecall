"use client";

import type { HostDebugEvent } from "@cp949/iframecall/host";
import { useIframeCallController } from "@cp949/iframecall/host";
import { useEffect, useState } from "react";

type DemoCommands = {
  greet(name: string): Promise<string>;
  add(a: number, b: number): Promise<number>;
  delay(ms: number): Promise<void>;
};

type DemoEvents = {
  "status-changed": "idle" | "processing";
};

type LogEntry = { id: number; time: string; text: string };

let nextId = 0;

function makeEntry(text: string): LogEntry {
  return {
    id: nextId++,
    time: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
    text,
  };
}

function formatDebugEvent(ev: HostDebugEvent): string {
  switch (ev.type) {
    case "commandSentToIframe":
      return `→ call ${ev.command}(${ev.args.map((a) => JSON.stringify(a)).join(", ")})`;
    case "commandResultReceivedFromIframe":
      return `← ${JSON.stringify(ev.value)}`;
    case "commandErrorReceivedFromIframe":
      return `← Error: ${ev.error.message}`;
    case "notificationReceivedFromIframe":
      return `← notify ${ev.event}: ${JSON.stringify(ev.payload)}`;
    case "readyReceived":
      return "← ready";
    case "terminatedReceived":
      return `← terminated: ${ev.reason}`;
  }
}

const IFRAME_ORIGIN = "http://localhost:3303";

export default function HostPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [greetName, setGreetName] = useState("World");
  const [addA, setAddA] = useState(1);
  const [addB, setAddB] = useState(2);
  const [delayMs, setDelayMs] = useState(1000);

  const { iframeRef, controller, status } = useIframeCallController<
    DemoCommands,
    DemoEvents
  >({
    targetOrigin: IFRAME_ORIGIN,
    allowedOrigins: [IFRAME_ORIGIN],
    debugLog: true,
  });

  useEffect(() => {
    if (!controller) return;
    return controller.debug.subscribe((ev) => {
      setLogs((prev) => [...prev, makeEntry(formatDebugEvent(ev))]);
    });
  }, [controller]);

  const disabled = status !== "ready";

  const handleGreet = () => {
    controller?.call("greet", [greetName]).catch(() => {});
  };

  const handleAdd = () => {
    controller?.call("add", [addA, addB]).catch(() => {});
  };

  const handleDelay = () => {
    controller?.call("delay", [delayMs]).catch(() => {});
  };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 4 }}>iframecall demo — host (React 18)</h1>
      <p style={{ marginBottom: 12, color: "#666" }}>
        status: <strong>{status}</strong>
      </p>

      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        {/* Commands */}
        <div
          style={{
            minWidth: 240,
            background: "#fff",
            border: "1px solid #ddd",
            padding: 12,
            borderRadius: 4,
          }}
        >
          <h2 style={{ marginBottom: 12 }}>Commands</h2>

          <section style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>greet(name)</div>
            <input
              value={greetName}
              onChange={(e) => setGreetName(e.target.value)}
              style={{ width: "100%", marginBottom: 4, padding: "2px 4px" }}
            />
            <button type="button" onClick={handleGreet} disabled={disabled}>
              Send
            </button>
          </section>

          <section style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>add(a, b)</div>
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <input
                type="number"
                value={addA}
                onChange={(e) => setAddA(Number(e.target.value))}
                style={{ width: 60, padding: "2px 4px" }}
              />
              <input
                type="number"
                value={addB}
                onChange={(e) => setAddB(Number(e.target.value))}
                style={{ width: 60, padding: "2px 4px" }}
              />
            </div>
            <button type="button" onClick={handleAdd} disabled={disabled}>
              Send
            </button>
          </section>

          <section>
            <div style={{ marginBottom: 4 }}>delay(ms)</div>
            <input
              type="number"
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              style={{ width: 80, marginBottom: 4, padding: "2px 4px" }}
            />
            <button type="button" onClick={handleDelay} disabled={disabled}>
              Send
            </button>
          </section>
        </div>

        {/* Log */}
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: 8 }}>Communication Log</h2>
          <div
            style={{
              height: 200,
              overflowY: "auto",
              border: "1px solid #ddd",
              padding: 8,
              background: "#fff",
              borderRadius: 4,
            }}
          >
            {logs.length === 0 && (
              <span style={{ color: "#aaa" }}>iframe 연결 대기 중…</span>
            )}
            {logs.map((log) => (
              <div key={log.id}>
                <span style={{ color: "#999" }}>{log.time}</span>{" "}
                <span>{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Embedded iframe */}
      <h2 style={{ marginBottom: 8 }}>iframe ({IFRAME_ORIGIN})</h2>
      <iframe
        ref={iframeRef}
        src={IFRAME_ORIGIN}
        style={{
          width: "100%",
          height: 300,
          border: "1px solid #ddd",
          borderRadius: 4,
        }}
        title="iframecall iframe demo"
      />
    </div>
  );
}
