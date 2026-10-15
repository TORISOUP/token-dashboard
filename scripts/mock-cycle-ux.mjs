// UI discussion only: uses the server build, in-memory settings and a fixed Stats table.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(join(tmpdir(), 'turzx-cycle-ux-'));
const child = spawn(resolve(root, 'bin', 'token-monitor-turzx-cycle-mock.exe'), [], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, WAILS_DATA_DIR: data, WAILS_SERVER_PORT: '34145', WAILS_CYCLE_MOCK: '1' },
});
console.log('Cycle UX mock: http://127.0.0.1:34145/ (memory only; restart resets all choices)');
child.once('error', error => { console.error(error); rmSync(data, { recursive: true, force: true }); process.exit(1); });
child.once('exit', code => { rmSync(data, { recursive: true, force: true }); process.exit(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
