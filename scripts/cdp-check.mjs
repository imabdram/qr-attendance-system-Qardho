/**
 * Minimal Chrome DevTools Protocol driver used for local UI verification.
 * Usage: node scripts/cdp-check.mjs <url> [waitMs] [screenshotPath]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const url = process.argv[2] || 'http://localhost:5173/';
const waitMs = Number(process.argv[3] || 8000);
const shot = process.argv[4];

const profileDir = join(tmpdir(), 'dsh-chrome-profile');
mkdirSync(profileDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + process.cwd() + '\\.tmp\\chrome-profile',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let target;
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch {}
  await sleep(250);
}
if (!target) {
  chrome.kill();
  throw new Error('Chrome DevTools endpoint did not start');
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(waitMs);

const text = await send('Runtime.evaluate', {
  expression: 'document.body.innerText',
  returnByValue: true,
});

if (shot) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(png.data, 'base64'));
}

for (const e of events) {
  if (e.method === 'Runtime.consoleAPICalled') {
    console.log('console:', e.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (e.method === 'Runtime.exceptionThrown') {
    console.log('exception:', e.params.exceptionDetails.text, e.params.exceptionDetails.exception?.description);
  }
  if (e.method === 'Log.entryAdded' && e.params.entry.level !== 'verbose') {
    console.log('log:', e.params.entry.level, e.params.entry.text);
  }
  if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) {
    console.log('http', e.params.response.status, e.params.response.url);
  }
}

console.log('--- page text ---');
console.log(text.result.value);
ws.close();
chrome.kill();
