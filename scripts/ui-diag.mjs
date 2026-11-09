/**
 * Diagnoses a slow/stuck sign-in: drives the real form and reports in-flight
 * requests over time.
 * Usage: node scripts/ui-diag.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] || 'https://qr-attendance-system-qardho.vercel.app';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const profileDir = join(tmpdir(), 'dsh-chrome-diag-' + Date.now());
mkdirSync(profileDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    ...(process.env.EXTRA_FLAGS ? process.env.EXTRA_FLAGS.split(' ') : []),
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + profileDir,
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
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const inflight = new Map();
const started = new Map();
const finished = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  const p = msg.params;
  if (msg.method === 'Network.requestWillBeSent') {
    inflight.set(p.requestId, p.request.url);
    started.set(p.requestId, Date.now());
  } else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
    const url = inflight.get(p.requestId);
    if (url) finished.push({ url, ms: Date.now() - (started.get(p.requestId) || Date.now()), ok: msg.method === 'Network.loadingFinished', err: p.errorText });
    inflight.delete(p.requestId);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/login' });
await sleep(5000);

const filled = await evaluate(`(() => {
  const u = document.querySelector('input[autocomplete="username"]');
  const p = document.querySelector('input[autocomplete="current-password"]');
  return { hasForm: !!u && !!p, reactKeys: u ? Object.keys(u).filter(k => k.startsWith('__react')).length : 0 };
})()`);
console.log('form state:', JSON.stringify(filled));

const typeInto = async (sel, text) => {
  await evaluate(`document.querySelector('${sel}').focus()`);
  await send('Input.insertText', { text });
  await sleep(150);
};
await typeInto('input[autocomplete="username"]', 'admin');
await typeInto('input[autocomplete="current-password"]', 'AdminPassword123!');
await sleep(600);

console.log('clicking sign in…');
const t0 = Date.now();
await evaluate(`document.querySelector('form button.primary').click()`);

for (let i = 0; i < 15; i++) {
  await sleep(2000);
  const state = await evaluate(`({
    url: location.pathname,
    busy: document.body.innerText.includes('Signing in'),
    text: document.body.innerText.replace(/\\s+/g,' ').slice(0, 160)
  })`);
  const open = [...inflight.entries()].map(([rid, url]) => `${Math.round((Date.now() - (started.get(rid) || Date.now())) / 1000)}s ${url.replace('https://', '').slice(0, 90)}`);
  console.log(`t+${Math.round((Date.now() - t0) / 1000)}s path=${state.url} busy=${state.busy} inflight=${inflight.size}`);
  if (open.length) open.forEach((o) => console.log('    PENDING', o));
  if (!state.busy && state.url !== '/login') {
    console.log('reached', state.url);
    break;
  }
}

console.log('\n--- slowest / failed requests ---');
finished
  .filter((f) => f.ms > 1500 || !f.ok)
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 15)
  .forEach((f) => console.log(`${f.ok ? 'ok  ' : 'FAIL'} ${String(f.ms).padStart(6)}ms ${f.url.slice(0, 110)}${f.err ? ' :: ' + f.err : ''}`));

console.log('\n--- last state ---');
console.log(await evaluate('document.body.innerText.slice(0, 400)'));
ws.close();
chrome.kill();
