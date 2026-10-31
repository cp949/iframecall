/**
 * File/Blob/ArrayBuffer 같은 구조화 복제 값이 command args와 응답 value로 전달되는지 검증한다.
 * 실제 구조화 복제와 transfer 의미를 얻기 위해 MessageChannel 기반 transport를 사용한다.
 * jsdom의 Blob/File은 Node의 구조화 복제를 통과하지 못하므로 node:buffer 구현체를 쓴다.
 */
import { Blob, File } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import { createIframeCallController } from "../../src/host/index.ts";
import { createIframeCallRunner } from "../../src/iframe/index.ts";
import { createMessageChannelTransports } from "./messageChannelTransport.ts";

type BinaryCommands = {
  play: (
    file: File,
    blob: Blob,
    buffer: ArrayBuffer,
    nested: { cover: Blob },
  ) => Promise<string>;
  take: (buffer: ArrayBuffer) => Promise<number>;
  makeBlob: () => Promise<Blob>;
  makeFile: () => Promise<File>;
  makeBuffer: () => Promise<ArrayBuffer>;
};

const textEncoder = new TextEncoder();

/** 바이트 배열을 ArrayBuffer로 복사해 만든다. 보낸 쪽 버퍼 detach 검증에 쓴다. */
function toArrayBuffer(text: string): ArrayBuffer {
  return textEncoder.encode(text).buffer as ArrayBuffer;
}

/**
 * ArrayBuffer 여부를 realm과 무관하게 판별한다.
 * jsdom 환경의 전역 ArrayBuffer는 Node 것과 달라 instanceof가 항상 false가 된다.
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/** Blob/File/ArrayBuffer 내용을 UTF-8 문자열로 읽는다. */
async function readText(value: Blob | ArrayBuffer): Promise<string> {
  const buffer = isArrayBuffer(value) ? value : await value.arrayBuffer();
  return new TextDecoder().decode(buffer);
}

describe("검증: File/Blob/ArrayBuffer 전달", () => {
  const openedTransports: Array<{ close(): void }> = [];

  afterEach(() => {
    for (const transport of openedTransports.splice(0)) {
      transport.close();
    }
  });

  /** host controller와 iframe runner를 MessageChannel로 연결한다. */
  function connect(Commands: new () => Partial<BinaryCommands>) {
    const channel = createMessageChannelTransports();
    openedTransports.push(channel);

    const controller = createIframeCallController<BinaryCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: channel.host,
    });
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: channel.iframe,
      Commands: Commands as new () => BinaryCommands,
    });
    runner.sendLifecycleReady();

    return { controller, runner };
  }

  it("host → iframe: File, Blob, ArrayBuffer args가 같은 종류와 내용으로 handler에 도착한다", async () => {
    const received: {
      file?: File;
      blob?: Blob;
      buffer?: ArrayBuffer;
      cover?: Blob;
    } = {};

    class Commands {
      async play(
        file: File,
        blob: Blob,
        buffer: ArrayBuffer,
        nested: { cover: Blob },
      ) {
        received.file = file;
        received.blob = blob;
        received.buffer = buffer;
        received.cover = nested.cover;
        return "ok";
      }
    }
    const { controller } = connect(Commands);

    const file = new File(["audio-bytes"], "track.mp3", {
      type: "audio/mpeg",
      lastModified: 1_700_000_000_000,
    });
    const blob = new Blob(["blob-bytes"], { type: "application/x-test" });
    const buffer = toArrayBuffer("buffer-bytes");
    const cover = new Blob(["cover-bytes"], { type: "image/png" });

    await expect(
      controller.invoke("play", [file, blob, buffer, { cover }]),
    ).resolves.toBe("ok");

    expect(received.file).toBeInstanceOf(File);
    expect(received.file).not.toBe(file);
    expect(received.file?.name).toBe("track.mp3");
    expect(received.file?.type).toBe("audio/mpeg");
    expect(received.file?.size).toBe(file.size);
    expect(received.file?.lastModified).toBe(1_700_000_000_000);
    await expect(readText(received.file!)).resolves.toBe("audio-bytes");

    expect(received.blob).toBeInstanceOf(Blob);
    expect(received.blob).not.toBeInstanceOf(File);
    expect(received.blob?.type).toBe("application/x-test");
    expect(received.blob?.size).toBe(blob.size);
    await expect(readText(received.blob!)).resolves.toBe("blob-bytes");

    expect(isArrayBuffer(received.buffer)).toBe(true);
    expect(received.buffer?.byteLength).toBe(buffer.byteLength);
    await expect(readText(received.buffer!)).resolves.toBe("buffer-bytes");
    // transfer를 지정하지 않으면 보낸 쪽 버퍼는 그대로 남는다.
    expect(buffer.byteLength).toBe(12);

    expect(received.cover).toBeInstanceOf(Blob);
    expect(received.cover?.type).toBe("image/png");
    await expect(readText(received.cover!)).resolves.toBe("cover-bytes");
  });

  it("iframe → host: handler가 Blob을 반환하면 invoke 결과로 도착한다", async () => {
    class Commands {
      async makeBlob() {
        return new Blob(["result-blob"], { type: "text/plain" });
      }
    }
    const { controller } = connect(Commands);

    const result = await controller.invoke("makeBlob", []);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("text/plain");
    expect(result.size).toBe(11);
    await expect(readText(result)).resolves.toBe("result-blob");
  });

  it("iframe → host: handler가 File을 반환하면 name과 type이 유지된다", async () => {
    class Commands {
      async makeFile() {
        return new File(["result-file"], "out.wav", { type: "audio/wav" });
      }
    }
    const { controller } = connect(Commands);

    const result = await controller.invoke("makeFile", []);

    expect(result).toBeInstanceOf(File);
    expect(result.name).toBe("out.wav");
    expect(result.type).toBe("audio/wav");
    await expect(readText(result)).resolves.toBe("result-file");
  });

  it("iframe → host: handler가 ArrayBuffer를 반환하면 같은 바이트로 도착한다", async () => {
    class Commands {
      async makeBuffer() {
        return toArrayBuffer("result-buffer");
      }
    }
    const { controller } = connect(Commands);

    const result = await controller.invoke("makeBuffer", []);

    expect(isArrayBuffer(result)).toBe(true);
    expect(result.byteLength).toBe(13);
    await expect(readText(result)).resolves.toBe("result-buffer");
  });

  it("transfer: ArrayBuffer를 넘기면 보낸 쪽 버퍼가 detach되고 받은 쪽에 내용이 도착한다", async () => {
    let received: ArrayBuffer | undefined;

    class Commands {
      async take(buffer: ArrayBuffer) {
        received = buffer;
        return buffer.byteLength;
      }
    }
    const { controller } = connect(Commands);

    const buffer = toArrayBuffer("transferred");
    expect(buffer.byteLength).toBe(11);

    await expect(
      controller.invoke("take", [buffer], { transfer: [buffer] }),
    ).resolves.toBe(11);

    expect(buffer.byteLength).toBe(0);
    expect(received?.byteLength).toBe(11);
    await expect(readText(received!)).resolves.toBe("transferred");
  });
});
