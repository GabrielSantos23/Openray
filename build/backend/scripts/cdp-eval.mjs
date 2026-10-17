// Minimal CDP-over-WebSocket client (no deps): opens the page target on the launcher's
// --remote-debugging-port, evaluates one JavaScript expression, prints the JSON result.
// Used to exercise UI the control-channel input hook can't reach (e.g. opening the category
// dropdown) — app-internal DOM events only, never OS input injection.
//
//   node cdp-eval.mjs "<expression>" [debugPort]

import net from "node:net";
import crypto from "node:crypto";

const expression = process.argv[2];
const port = Number(process.argv[3] ?? 9223);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("main-window"));
if (!page) throw new Error("no main-window page target");

const url = new URL(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const key = crypto.randomBytes(16).toString("base64");
  const socket = net.connect(Number(url.port), url.hostname, () => {
    socket.write(
      `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
        `Host: ${url.host}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
    );
  });

  let buffer = Buffer.alloc(0);
  let upgraded = false;
  let messageId = 0;
  const pending = new Map();

  const sendFrame = (text) => {
    const payload = Buffer.from(text, "utf8");
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x81, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    socket.write(Buffer.concat([header, mask, masked]));
  };

  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      sendFrame(JSON.stringify({ id, method, params }));
    });

  const parseFrames = () => {
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (opcode === 1) {
        const message = JSON.parse(payload.toString("utf8"));
        if (message.id && pending.has(message.id)) {
          const { resolve, reject } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
      }
    }
  };

  socket.on("data", (chunk) => {
    if (!upgraded) {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf("\r\n\r\n");
      if (marker < 0) return;
      const head = buffer.subarray(0, marker).toString();
      if (!/101/.test(head.split("\r\n")[0])) {
        reject(new Error(`upgrade failed: ${head.split("\r\n")[0]}`));
        return;
      }
      upgraded = true;
      buffer = buffer.subarray(marker + 4);
      resolve();
      parseFrames();
      void (async () => {
        try {
          const result = await call("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          console.log(JSON.stringify(result.result?.value ?? result.result ?? result, null, 1));
        } catch (error) {
          console.error(String(error));
          process.exitCode = 1;
        } finally {
          socket.end();
          setTimeout(() => process.exit(0), 100);
        }
      })();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    parseFrames();
  });
  socket.on("error", reject);
  setTimeout(() => reject(new Error("timeout")), 15000);
});
