// Stage-3 composition: fixed service responses in the UI, fixed Local CLI responses at its boundary.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const runDir = mkdtempSync(join(tmpdir(), 'turzx-style-import-'));
if (dirname(resolve(runDir)) !== resolve(tmpdir())) throw new Error('Mock directory must be inside the system temporary directory');
const dataDir = join(runDir, 'data');
mkdirSync(join(dataDir, 'logs'), { recursive: true });
const write = (name, value) => writeFileSync(join(dataDir, name), JSON.stringify(value));
const build = spawnSync(join(root, '.tools', process.platform === 'win32' ? 'wails3.exe' : 'wails3'), ['task', 'build:server'], {
  cwd: root, env: { ...process.env, VITE_STYLE_IMPORT_MOCK: '1' }, stdio: 'inherit', windowsHide: true,
});
if (build.error || build.status !== 0) throw build.error ?? new Error('Cannot build the style import mock');
writeFileSync(join(dataDir, 'fake-tokscale'), '');
write('settings.json', { source: 'Local', displayID: 'USB\\VID_1A86&PID_5722\\USB35INCHIPSV2', displayName: 'TURZX 3.5-inch', limitStyle: 'gauges-35-landscape', serviceCycleSeconds: 10 });
const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
write('graph.json', { summary: { clients: ['claude', 'codex'] }, contributions: [{ date, totals: { cost: 3.75 }, tokenBreakdown: { input: 2468135 }, clients: [
  { client: 'claude', tokens: { input: 1234567 }, cost: 1.25 }, { client: 'codex', tokens: { input: 1233568 }, cost: 2.5 },
] }] });
write('usage.json', [
  { provider: 'Claude', plan: 'Pro', metrics: [{ label: 'Session', remaining_percent: 40 }, { label: 'Weekly', remaining_percent: 68 }, { label: 'Monthly', remaining_percent: 85 }] },
  { provider: 'Codex', plan: 'Plus', metrics: [{ label: 'Session', remaining_percent: 70 }, { label: 'Weekly', remaining_percent: 82 }] },
]);
write('clients.json', { clients: [{ client: 'claude', sessionsPath: join(dataDir, 'logs') }] });
write('cursor.json', { synced: false, rows: 0, error: 'Not authenticated' });
const fixture = spawnSync('go', ['test', '-c', '-o', join(runDir, 'tokscale.exe'), './internal/localusage'], { cwd: root, stdio: 'inherit', windowsHide: true });
if (fixture.error || fixture.status !== 0) throw fixture.error ?? new Error('Cannot build the Local CLI fixture');
copyFileSync(join(root, 'bin/token-monitor-turzx-server.exe'), join(runDir, 'server.exe'));
const home = join(runDir, 'home'); mkdirSync(home);
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(_HOME|_DIR|_PATH)$|^(XDG_|CODEX|CLAUDE|TOKSCALE)/i.test(name)));
Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'roaming'), LOCALAPPDATA: join(home, 'local'), WAILS_DATA_DIR: dataDir, WAILS_SERVER_PORT: '34139' });
const app = spawn(join(runDir, 'server.exe'), [], { cwd: root, env, stdio: 'inherit', windowsHide: true });
const cleanup = () => rmSync(runDir, { recursive: true, force: true });
app.on('error', error => { console.error(error); cleanup(); process.exitCode = 1; });
app.on('exit', code => { cleanup(); process.exitCode = code || 0; });
process.on('SIGINT', () => app.kill()); process.on('SIGTERM', () => app.kill());
console.log(`Style import mock: http://127.0.0.1:34139/; PID: ${app.pid}; fixture: ${dataDir}`);
console.log('Folder selection uses a browser prompt. Imports and selection use session-only fixed responses. No USB output. Stop with Ctrl+C; close the browser tab to reset the fixture.');
