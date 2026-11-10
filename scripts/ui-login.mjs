/**
 * Drives the real login form in headless Chrome and screenshots the result.
 * Usage: node scripts/ui-login.mjs <emailOrUsername> <password> <out.png>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const [, , identifier, password, outFile, path] = process.argv;
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const profileDir = join(tmpdir(), 'dsh-chrome-profile-login');
mkdirSync(profileDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
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
const errors = [];
const pendingRequests = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  } else if (msg.method === 'Network.requestWillBeSent') {
    pendingRequests.set(msg.params.requestId, msg.params.request.url);
  } else if (msg.method === 'Network.loadingFailed') {
    const url = pendingRequests.get(msg.params.requestId) || '?';
    errors.push(`FAILED ${msg.params.errorText} ${url}`);
  } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    errors.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/login' });
await sleep(2000);

// Wait until React has attached to the inputs, otherwise the click submits nothing.
for (let i = 0; i < 40; i++) {
  const ready = await evaluate(
    `(() => { const el = document.querySelector('form input'); return !!(el && Object.keys(el).some(k => k.startsWith('__reactProps'))); })()`
  );
  if (ready) break;
  await sleep(250);
}
await sleep(400);

await evaluate(`document.querySelector('input[autocomplete="username"]').focus()`);
await send('Input.insertText', { text: identifier });
await evaluate(`document.querySelector('input[autocomplete="current-password"]').focus()`);
await send('Input.insertText', { text: password });
await sleep(300);
await evaluate(`document.querySelector('form button.primary').click()`);
await sleep(6000);

if (path) {
  await send('Page.navigate', { url: BASE + path });
  await sleep(4000);
}

// Optional: pick a value in the "Show" select (reports status filter).
if (process.env.SELECT_SHOW) {
  await evaluate(`(() => {
    const sel = [...document.querySelectorAll('select')].find(
      (s) => [...s.options].some((o) => o.textContent === 'Absent only')
    );
    if (!sel) return 'no select';
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, ${JSON.stringify(process.env.SELECT_SHOW)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'selected';
  })()`);
  await sleep(2500);
}

const url = await evaluate('location.href');
const text = await evaluate('document.body.innerText');
const png = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(outFile, Buffer.from(png.data, 'base64'));

console.log('url:', url);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
console.log('--- page text ---');
console.log(text);
ws.close();
chrome.kill();
