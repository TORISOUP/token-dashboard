// Stage-3 UI discussion: memory settings, a fixed device list and fixed usage at one composition point.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = mkdtempSync(join(tmpdir(), 'turzx-style-ux-'));
const child = spawn(resolve(root, 'bin', 'token-monitor-turzx-server.exe'), [], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, WAILS_DATA_DIR: data, WAILS_SERVER_PORT: '34146', WAILS_STYLE_MOCK: '1' },
});
console.log('Style UX mock: http://127.0.0.1:34146/ (memory only; restart restores 3.5-inch + Bars)');
child.once('error', error => { console.error(error); rmSync(data, { recursive: true, force: true }); process.exitCode = 1; });
child.once('exit', code => { rmSync(data, { recursive: true, force: true }); process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
