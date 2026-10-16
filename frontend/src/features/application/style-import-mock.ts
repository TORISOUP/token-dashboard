import { Events } from '@wailsio/runtime';
import * as RealSettings from '@bindings/token-monitor-turzx/internal/settings/service';
import * as RealDisplay from '@bindings/token-monitor-turzx/internal/display/service';
import type { SaveRequest, View } from '@bindings/token-monitor-turzx/internal/settings/models';
import type { ImportDraft, StoredStyle } from '@bindings/token-monitor-turzx/internal/styles/models';
import type { Theme } from '@bindings/token-monitor-turzx/internal/display/models';

// Fixed sources and responses at the existing service boundary, using the production contracts.
const sources = import.meta.glob<string>('../../../../examples/styles/**/*', { eager: true, query: '?raw', import: 'default' });
const fixtures: StoredStyle[] = Object.entries(sources).filter(([path]) => path.endsWith('/theme.json')).map(([path, source]) => {
  const directory = path.slice(0, path.lastIndexOf('/') + 1);
  const manifest = JSON.parse(source) as Theme;
  const files = Object.fromEntries(Object.entries(sources).filter(([name]) => name.startsWith(directory)).map(([name, text]) => {
    const bytes = new TextEncoder().encode(text);
    return [name.slice(directory.length), btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))];
  }));
  return { ...manifest, files };
});
const builtin: Record<string, string> = {
  'sample-midnight-35-landscape': 'gauges-35-landscape',
  'sample-paper-35-portrait': 'bars-35-portrait',
  'sample-terminal-35-landscape': 'bars-35-landscape',
  'sample-orbit-35-portrait': 'gauges-35-portrait',
};
const sessionKey = 'style-import-agreement';
const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? '{"ids":[],"selected":""}') as { ids: string[]; selected: string };
let imported = fixtures.filter(style => saved.ids.includes(style.id));
let selected = saved.selected;
let pending: StoredStyle | undefined;
function remember() { sessionStorage.setItem(sessionKey, JSON.stringify({ ids: imported.map(style => style.id), selected })); }
function view(base: View): View {
  const active = imported.find(style => style.id === selected);
  if (!active || builtin[active.id] !== base.limitStyle) selected = base.limitStyle;
  const extras: Theme[] = imported.map(({ id, name, width, height, dataLayout }) => ({ id, name, width, height, dataLayout }));
  return { ...base, limitStyle: selected, themes: [...base.themes ?? [], ...extras], compatibleThemeIDs: [...base.compatibleThemeIDs ?? [], ...extras.filter(style => base.compatibleThemeIDs?.includes(builtin[style.id])).map(style => style.id)] };
}
export const Settings = {
  async Get() { return view(await RealSettings.Get()); },
  async Save(request: SaveRequest) {
    const result = await RealSettings.Save({ ...request, limitStyle: builtin[request.limitStyle] ?? request.limitStyle });
    selected = builtin[request.limitStyle] === result.limitStyle ? request.limitStyle : result.limitStyle;
    remember();
    return view(result);
  },
};
export const Application = {
  async ChooseStyleFolder() {
    const next = fixtures.find(style => !imported.some(item => item.id === style.id));
    return window.prompt('Mock folder selection: enter a sample folder name, or Cancel.', next?.id ?? fixtures[0].id) ?? '';
  },
};
export const Styles = {
  async List(): Promise<StoredStyle[]> { return structuredClone(imported); },
  async BeginImport(folder: string, ids: string[] | null): Promise<ImportDraft> {
    const id = folder.replaceAll('\\', '/').replace(/\/$/, '').split('/').at(-1);
    const sample = fixtures.find(style => style.id === id);
    if (!sample) throw { code: 'INVALID', message: 'This folder is not a valid style.' };
    if (ids?.includes(sample.id) || imported.some(style => style.id === sample.id)) throw { code: 'DUPLICATE', message: 'This style id is already defined.' };
    pending = sample;
    return { ...structuredClone(sample), token: sample.id };
  },
  async FinishImport(token: string) {
    if (!pending || pending.id !== token) throw { code: 'COPY', message: 'Could not copy the style into the app.' };
    imported = [...imported, pending]; pending = undefined; remember();
    await Events.Emit('styles:changed', null);
  },
  async CancelImport(_token: string) { pending = undefined; },
  async Delete(id: string) {
    if (selected === id) throw { code: 'IN_USE', message: 'Switch to another style before deleting.' };
    imported = imported.filter(style => style.id !== id); remember();
    await Events.Emit('styles:changed', null);
  },
};
export const Display = {
  async RenderRequest() {
    const request = await RealDisplay.RenderRequest();
    return request && builtin[selected] === request.theme ? { ...request, theme: selected } : request;
  },
  async ThemePreview(id: string) { return RealDisplay.ThemePreview(builtin[id] ?? id); },
};
