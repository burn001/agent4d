#!/usr/bin/env node
// cloudflared ↔ 로컬 서버 사이의 작은 역방향 프록시 (Node 내장 모듈만)
//
// 왜 필요한가 (2026-10-23 실측):
//   quick tunnel(*.trycloudflare.com) 경로에서는 Cloudflare 엣지가 origin 에 Accept-Encoding: gzip 을 붙여 요청하고,
//   origin 이 압축하지 않은 text/event-stream 응답을 보내면 엣지가 직접 압축하느라 응답이 끝날 때까지 본문을 버퍼링한다.
//   (no-transform·X-Accel-Buffering·패딩 100KB 모두 효과 없음. WebSocket 과 origin 이 미리 gzip 한 스트림은 즉시 흐름.)
//   → 이 릴레이가 SSE 응답을 gzip(Z_SYNC_FLUSH, 이벤트마다 flush)으로 감싸 엣지가 재압축하지 않게 한다.
//   서버(server/index.mjs)와 프런트는 손대지 않아도 된다.
//
// 사용: node bin/relay.mjs --listen 7789 --target 7788 [--host 127.0.0.1]
//   그 밖의 요청·WebSocket 업그레이드는 그대로 통과. 인증은 뒤의 서버가 한다.

import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const HOST = arg("--host", "127.0.0.1");
const LISTEN = Number(arg("--listen", 7789));
const TARGET = Number(arg("--target", 7788));

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade"]);

const server = http.createServer((req, res) => {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
  headers.host = `127.0.0.1:${TARGET}`;
  const up = http.request({ host: "127.0.0.1", port: TARGET, method: req.method, path: req.url, headers }, (ur) => {
    const out = {};
    for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k)) out[k] = v;
    const isSse = String(ur.headers["content-type"] || "").includes("text/event-stream");
    const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    if (isSse && acceptsGzip && !ur.headers["content-encoding"] && req.method !== "HEAD") {
      delete out["content-length"];
      out["content-encoding"] = "gzip";
      out["vary"] = "Accept-Encoding";
      out["cache-control"] = "no-cache, no-transform";
      out["x-accel-buffering"] = "no";
      res.writeHead(ur.statusCode, ur.statusMessage, out);
      res.flushHeaders();
      const gz = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
      gz.pipe(res);
      ur.on("data", (c) => {
        gz.write(c);
        gz.flush();
      });
      ur.on("end", () => gz.end());
      ur.on("error", () => gz.end());
      res.on("close", () => ur.destroy());
      return;
    }
    res.writeHead(ur.statusCode, ur.statusMessage, out);
    ur.pipe(res);
    res.on("close", () => ur.destroy());
  });
  up.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end('{"error":"origin-down"}');
    } else res.destroy();
  });
  req.pipe(up);
  req.on("aborted", () => up.destroy());
});

// WebSocket 등 업그레이드는 TCP 로 그대로 잇는다
server.on("upgrade", (req, sock, head) => {
  const up = net.connect(TARGET, "127.0.0.1", () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      raw += `${k}: ${k.toLowerCase() === "host" ? `127.0.0.1:${TARGET}` : req.rawHeaders[i + 1]}\r\n`;
    }
    up.write(raw + "\r\n");
    if (head?.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  const done = () => {
    up.destroy();
    sock.destroy();
  };
  up.on("error", done);
  sock.on("error", done);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 0; // SSE 장시간 연결
server.listen(LISTEN, HOST, () => console.log(`CCVIZ_RELAY_READY ${JSON.stringify({ listen: LISTEN, target: TARGET, pid: process.pid })}`));
