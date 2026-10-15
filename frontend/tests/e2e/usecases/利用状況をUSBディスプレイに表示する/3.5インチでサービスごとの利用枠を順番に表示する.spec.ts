import { test, expect, type Page } from '@playwright/test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FrameRequest, ThemeData } from '../../../../bindings/token-monitor-turzx/internal/display/models';
import type { View } from '../../../../bindings/token-monitor-turzx/internal/settings/models';
import { startServer } from '../../support/server';
import { startHub } from '../../support/hub';
import { localHome } from '../../support/local';

// A distinct hardware suffix keeps this saved selection disconnected when the real device is plugged in.
const smallID = 'USB\\VID_1A86&PID_5722&E2E\\USB35INCHIPSV2';
const settingsGet = 'token-monitor-turzx/internal/settings.Service.Get';
const display = 'token-monitor-turzx/internal/display.Service.';
const skipName = 'Skip full 5h or missing limits';
test.use({ actionTimeout: 15_000 });
const styles = [
  ['Gauges 3.5" Landscape', 'gauges-35-landscape', 480, 320],
  ['Gauges 3.5" Portrait', 'gauges-35-portrait', 320, 480],
  ['Bars 3.5" Landscape', 'bars-35-landscape', 480, 320],
  ['Bars 3.5" Portrait', 'bars-35-portrait', 320, 480],
] as const;

async function rpc<T>(page: Page, method: string, args: unknown[] = []): Promise<T> {
  return page.evaluate(async ({ method, args }) => {
    const response = await fetch('/wails/runtime', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wails-client-id': 'service-display-e2e' },
      body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': crypto.randomUUID(), methodName: method, args } }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { method, args });
}

function stats(remaining = 20) {
  const window = (label: string, kind: string, remainingPercent: number | null) => ({ label, kind, remainingPercent, showMeter: true });
  const period = { totalTokens: 987654, costUsd: 99, clients: { Claude: 0, Codex: 123456, Copilot: 10, 'antigravity-cli': 20 }, clientCosts: { Claude: 0, Codex: 1.25 } };
  return {
    periods: { today: period, month: period, allTime: period },
    limits: { providers: [
      { provider: 'Claude', accountLabel: 'one', planLabel: 'Pro', windows: [window('Alpha 5h', 'session', 100), window('Beta 5h', 'session', 100), window('Gamma Weekly', 'weekly', 80), window('Delta Weekly', 'weekly', null)] },
      { provider: 'Codex', accountLabel: 'two', planLabel: 'Low', windows: [window('5h', 'session', remaining), window('Weekly', 'weekly', 90)] },
      { provider: 'Codex', accountLabel: 'three', planLabel: 'High', windows: [window('5h', 'session', 80)] },
    ] },
  };
}

test('3.5インチのスタイル、サービス別巡回、スキップと保存を維持する', async ({ page, context }) => {
  test.setTimeout(120_000);
  const dataDir = mkdtempSync(join(tmpdir(), 'turzx-services-e2e-'));
  const settingsFile = join(dataDir, 'settings.json');
  const { home, env } = localHome();
  const hub = await startHub();
  // A saved explicit selection remains selectable while unplugged. No physical USB is opened.
  writeFileSync(settingsFile, JSON.stringify({ source: 'Local', displayID: smallID, displayName: 'TURZX 3.5"', limitStyle: 'Gauges' }));
  let server = await startServer(dataDir, 34137, env);
  let frame: FrameRequest | undefined;
  let completed: { request: FrameRequest; png: string; device: string } | undefined;
  const requests = new Map<number, FrameRequest>();
  const observe = (target: Page) => target.on('response', async response => {
    if (!response.url().endsWith('/wails/runtime')) return;
    try {
      const call = response.request().postDataJSON()?.args;
      if (call?.methodName === display + 'RenderRequest' && response.ok()) {
        const request = await response.json() as FrameRequest | null;
        if (request) { frame = request; requests.set(request.id, request); }
      }
      if (call?.methodName === display + 'CompleteFrame' && response.ok() && call.args[1] && call.args[2] && !call.args[3]) {
        const request = requests.get(call.args[0]);
        if (request) completed = { request, png: call.args[1], device: call.args[2] };
      }
    } catch { /* Ignore unrelated runtime responses. */ }
  });
  observe(page);
  const file = () => JSON.parse(readFileSync(settingsFile, 'utf8'));
  const preview = () => page.getByRole('img', { name: 'Display preview', exact: true });
  const selectStyle = async (label: string, id: string, width: number, height: number) => {
    await page.getByRole('textbox', { name: 'Display style' }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect.poll(() => file().limitStyle).toBe(id);
    // Reopening the server page can leave one old Canvas request pending until its 10s deadline.
    await expect.poll(() => completed?.request.theme, { timeout: 20_000 }).toBe(id);
    await expect.poll(() => preview().evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([width, height]);
  };
  const openServices = async () => {
    const summary = page.locator('summary').filter({ hasText: 'Service content' });
    if (!(await summary.locator('..').evaluate(el => el.hasAttribute('open')))) await summary.click();
  };
  const content = (name: string) => page.getByRole('article', { name: `${name} content`, exact: true });
  try {
    await test.step('分岐条件', async () => {
      await page.goto(server.url);
      await page.getByRole('link', { name: 'Connection', exact: true }).click();
      await page.getByRole('textbox', { name: 'Data source' }).click();
      await page.getByRole('option', { name: 'Hub', exact: true }).click();
      await page.getByLabel('Hub URL').fill(hub.url);
      await page.getByLabel(/Access token/).fill('service-e2e-token');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
      await expect.poll(() => hub.streams()).toBe(1);
      await page.getByRole('link', { name: 'Display', exact: true }).click();
    });
    await test.step('手順1', async () => {
      await expect(page.getByRole('textbox', { name: 'Output device' })).toHaveValue(/3.5.*Disconnected/);
      await page.getByRole('textbox', { name: 'Display style' }).click();
      await expect(page.getByRole('option')).toHaveCount(4);
      await expect(page.getByRole('option', { name: 'Gauges', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByText(/Selected style size is not supported/)).toBeVisible();
      expect(file().limitStyle).toBe('Gauges');
    });
    await test.step('手順2', async () => {
      for (const [label, id, width, height] of styles) {
        await selectStyle(label, id, width, height);
        expect(completed!.request.outputFormat).toBe('png');
        expect(completed!.request.data.available).toBe(false);
      }
      await selectStyle(...styles[0]);
      await page.getByRole('switch', { name: 'Rotate 180°', exact: true }).click();
      await expect.poll(() => file().presentation.reverse180).toBe(true);
      await expect.poll(() => completed?.request.reverse180).toBe(true);
      // Both images come from the same Canvas. Every sampled device pixel is the opposite preview pixel.
      const differences = await page.evaluate(async ({ png, device }) => {
        const read = async (encoded: string) => {
          const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
        };
        const a = await read(png); const b = await read(device); let differences = 0;
        for (let y = 0; y < a.height; y += 7) for (let x = 0; x < a.width; x += 11) for (let c = 0; c < 4; c++) {
          if (a.pixels[(y * a.width + x) * 4 + c] !== b.pixels[((a.height - 1 - y) * a.width + a.width - 1 - x) * 4 + c]) differences++;
        }
        return differences;
      }, completed!);
      expect(differences).toBe(0);
    });
    await test.step('手順3', async () => {
      hub.send('snapshot', stats());
      await expect.poll(() => frame?.data.service?.provider).toBe('Claude');
      await expect.poll(() => frame?.data.service?.count).toBe(6);
      expect(frame!.data.service!.tokens![0].tokensText).toBe('0');
      expect(frame!.data.service!.tokens![0].costText).toBe('$0.00');
      expect(frame!.data.service!.circles!.length).toBe(3);
    });
    await test.step('手順4', async () => {
      const summary = page.locator('summary').filter({ hasText: 'Service content' });
      await expect(summary.locator('..')).not.toHaveAttribute('open');
      await summary.focus(); await page.keyboard.press('Enter');
      await expect(content('Claude')).toBeVisible();
      await content('Claude').getByText('Tokens', { exact: true }).click();
      await expect.poll(() => file().presentation.services.Hub.Claude.content).toBe('Tokens');
      await page.getByRole('switch', { name: 'Show Claude', exact: true }).click();
      await expect(content('Claude').getByRole('radio', { name: 'Tokens', exact: true })).toBeDisabled();
      await expect(content('Claude').getByRole('radio', { name: 'Tokens', exact: true })).toBeChecked();
      await page.getByRole('switch', { name: 'Show Claude', exact: true }).click();
      await content('Claude').getByText('Both', { exact: true }).click();
      await expect.poll(() => frame?.data.service?.count).toBe(6);
    });
    await test.step('手順5', async () => {
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('textbox', { name: 'Cycle time' }).fill('50');
      await page.getByRole('textbox', { name: 'Cycle time' }).press('Enter');
      await expect.poll(() => file().cycleSeconds).toBe(50);
      await page.getByRole('switch', { name: 'Cycle', exact: true }).click();
      await expect.poll(() => file().cycle).toBe(true);
      await page.getByRole('link', { name: 'Display', exact: true }).click();
      await expect.poll(() => frame?.data.service?.number, { timeout: 10_000 }).toBe(2);
    });
    await test.step('手順6', async () => {
      const current = frame!;
      hub.send('stats', stats(21));
      await expect.poll(() => frame?.id).toBeGreaterThan(current.id);
      expect(frame!.data.service!.key).toBe(current.data.service!.key);
      await expect(page.getByRole('checkbox', { name: 'Codex Low 5h', exact: true })).toContainText('21%');
    });
    await test.step('手順7', async () => {
      const services = JSON.stringify(file().presentation.services);
      await page.getByRole('checkbox', { name: 'Claude Pro Alpha 5h', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: 'Claude Pro Alpha 5h', exact: true })).toHaveAttribute('aria-checked', 'false');
      expect(JSON.stringify(file().presentation.services)).toBe(services);
      expect(file().hiddenLimits).toHaveLength(1);
      await expect(page.getByRole('checkbox', { name: 'Claude Pro', exact: true })).toHaveCount(0);
    });
    await test.step('手順8', async () => {
      // Unplug/replug and COM resolution are exercised on hardware. This server checks continued preview/cycling while the explicit device is absent.
      const view = await rpc<View>(page, settingsGet);
      expect(view.displayID).toBe(smallID);
      expect(view.displays!.find(d => d.deviceID === smallID)).toMatchObject({ connected: false });
      expect(view.compatibleThemeIDs).toHaveLength(4);
      const current = frame!.data.service!.key;
      await expect.poll(() => frame?.data.service?.key, { timeout: 10_000 }).not.toBe(current);
      await expect(preview()).toBeVisible();
      expect(hub.streams()).toBe(1);
    });
    await test.step('手順9', async () => {
      // Native window hiding keeps the renderer resident; a server page stands in for reopening the window.
      await page.close();
      expect((await context.request.get(`${server.url}/health`)).ok()).toBe(true);
      expect(hub.streams()).toBe(1);
      page = await context.newPage(); observe(page);
      await page.goto(server.url);
      await expect(preview()).toBeVisible();
    });
    await test.step('手順10', async () => {
      await selectStyle(...styles[3]);
      await page.close(); await server.stop();
      await expect.poll(() => hub.streams()).toBe(0);
      frame = undefined; completed = undefined; requests.clear();
      server = await startServer(dataDir, 34137, env);
      await expect.poll(() => hub.streams()).toBe(1);
      hub.send('snapshot', stats(21));
      page = await context.newPage(); observe(page); await page.goto(server.url);
      await expect.poll(() => frame?.data.service?.number).toBe(1);
      await expect(page.getByRole('textbox', { name: 'Display style' })).toHaveValue(styles[3][0]);
      await expect(page.getByRole('switch', { name: 'Rotate 180°', exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('checkbox', { name: 'Claude Pro Alpha 5h', exact: true })).toHaveAttribute('aria-checked', 'false');
      expect(file().cycle).toBe(true);
      expect(file().cycleSeconds).toBe(50);
    });
    await test.step('受け入れ条件', async () => {
      // Freeze on page one to compare selection and failure states independently of cycling.
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('switch', { name: 'Cycle', exact: true }).click();
      await expect.poll(() => file().cycle).toBeFalsy();
      await page.getByRole('link', { name: 'Display', exact: true }).click();
      await page.getByRole('switch', { name: skipName, exact: true }).click();
      await expect.poll(() => frame?.data.service?.provider).toBe('Codex');
      await expect.poll(() => frame?.data.service?.count).toBe(2);
      await openServices();
      await expect(content('Copilot').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      await expect(content('antigravity-cli').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      await content('Codex').getByText('Tokens', { exact: true }).click();
      await expect.poll(() => frame?.data.service?.count).toBe(1);
      await expect.poll(() => frame?.data.service?.showLimits).toBe(false);
      expect(file().hiddenLimits).toHaveLength(1);

      // A real replacement failure preserves the file, generation, page, and checked state.
      const before = readFileSync(settingsFile); const view = await rpc<View>(page, settingsGet); const key = frame!.data.service!.key;
      chmodSync(settingsFile, 0o444);
      try {
        await page.getByRole('switch', { name: skipName, exact: true }).click();
        await expect(page.getByRole('alert').first()).toBeVisible();
        expect(readFileSync(settingsFile).equals(before)).toBe(true);
        expect((await rpc<View>(page, settingsGet)).generation).toBe(view.generation);
        await expect(page.getByRole('switch', { name: skipName, exact: true })).toHaveAttribute('aria-checked', 'true');
        expect(frame!.data.service!.key).toBe(key);
      } finally { chmodSync(settingsFile, 0o600); }

      // Candidate refresh errors disable selection without saving; the next successful poll recovers it.
      const savedBeforeLookup = readFileSync(settingsFile);
      await page.route('**/wails/runtime', async route => {
        if (route.request().postDataJSON()?.args?.methodName === settingsGet) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'UNEXPECTED', message: 'candidate lookup failed' }) });
        } else await route.continue();
      });
      try {
        await expect(page.getByRole('textbox', { name: 'Display style' })).toBeDisabled({ timeout: 10_000 });
        await expect(page.getByRole('alert').first()).toBeVisible();
        expect(readFileSync(settingsFile).equals(savedBeforeLookup)).toBe(true);
      } finally { await page.unroute('**/wails/runtime'); }
      await expect(page.getByRole('textbox', { name: 'Display style' })).toBeEnabled({ timeout: 10_000 });

      await page.setViewportSize({ width: 1200, height: 850 });
      const wide = await content('Claude').boundingBox(); const wideNext = await content('Codex').boundingBox();
      expect(Math.abs(wide!.y - wideNext!.y)).toBeLessThan(1);
      await page.setViewportSize({ width: 640, height: 850 });
      const narrow = await content('Claude').boundingBox(); const narrowNext = await content('Codex').boundingBox();
      expect(narrowNext!.y).toBeGreaterThan(narrow!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

      // Styles compares all six definitions without changing the selected style or preferences.
      const saved = readFileSync(settingsFile);
      await page.getByRole('link', { name: 'Styles', exact: true }).click();
      await expect(page.getByRole('article')).toHaveCount(6);
      expect(readFileSync(settingsFile).equals(saved)).toBe(true);
      await page.getByRole('link', { name: 'Display', exact: true }).click(); await openServices();
      for (const id of ['Claude', 'Codex', 'Copilot', 'antigravity-cli']) {
        await page.getByRole('switch', { name: `Show ${id}`, exact: true }).click();
        await expect(page.getByRole('switch', { name: `Show ${id}`, exact: true })).toHaveAttribute('aria-checked', 'false');
        if (id === 'Codex') await expect.poll(() => frame?.data.serviceMessage).toBe('All services skipped');
      }
      await expect.poll(() => frame?.data.serviceMessage).toBe('No services selected');
      const prepared = await rpc<ThemeData>(page, display + 'ThemePreview', [styles[3][1]]);
      expect(prepared.serviceMessage).toBe('No services selected');
      expect(file().connection).not.toContain('service-e2e-token');
      await expect(page.getByText('service-e2e-token', { exact: true })).toHaveCount(0);
      expect(hub.requests.every(r => r.headers.authorization === 'Bearer service-e2e-token')).toBe(true);
    });
  } finally {
    chmodSync(settingsFile, 0o600);
    await server.stop(); await hub.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
