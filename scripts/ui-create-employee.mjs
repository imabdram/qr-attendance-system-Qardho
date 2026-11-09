/**
 * Creates an employee through the real admin UI, then reports the result.
 * Usage: node scripts/ui-create-employee.mjs
 * Cleanup is done separately (see scripts/e2e-neon.mjs or admin_delete_employee).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const profileDir = join(tmpdir(), 'dsh-chrome-profile-create');
mkdirSync(profileDir, { recursive: true });

const stamp = Date.now().toString().slice(-6);
const emp = {
  fullName: 'UI Test Employee',
  username: 'uitest' + stamp,
  phone: 'UI-' + stamp,
  password: 'UiPass123!',
};
console.log('creating', JSON.stringify(emp));

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
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
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

const typeInto = async (selectorExpr, text) => {
  await evaluate(`(${selectorExpr}).focus()`);
  await send('Input.insertText', { text });
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:5173/login' });
await sleep(2500);
await typeInto(`document.querySelector('input[autocomplete="username"]')`, 'admin');
await typeInto(`document.querySelector('input[autocomplete="current-password"]')`, 'AdminPassword123!');
await evaluate(`document.querySelector('form button.primary').click()`);
await sleep(5000);

await send('Page.navigate', { url: 'http://localhost:5173/admin/employees' });
await sleep(3000);

await evaluate(
  `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Add Employee')).click()`
);
await sleep(1200);

await typeInto(`document.querySelector('input[placeholder="e.g. Ahmed Ali"]')`, emp.fullName);
await typeInto(`document.querySelector('input[placeholder="e.g. ahmed01"]')`, emp.username);
await typeInto(`document.querySelector('input[placeholder="e.g. 071xxxxxxx"]')`, emp.phone);
await typeInto(`document.querySelector('input[placeholder="Minimum 8 characters"]')`, emp.password);
await sleep(400);

const t0 = Date.now();
await evaluate(
  `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Create Employee Account')).click()`
);
await sleep(9000);

const text = await evaluate('document.body.innerText');
const png = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('.tmp/employee-created.png', Buffer.from(png.data, 'base64'));

console.log('waited', Date.now() - t0, 'ms');
console.log('errors:', errors.length ? errors.join('\n') : 'none');
console.log('created visible:', text.includes(emp.username));
console.log('--- page text ---');
console.log(text);
ws.close();
chrome.kill();
