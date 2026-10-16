import { Application, Display, Styles } from '../application/style-import-services';
import { registerTheme, unregisterTheme } from '../display/theme-renderer';
import { prepareTheme, type ThemeFiles } from './prepare';

export type StyleDefinition = { id: string; name: string };

type Manifest = { id?: string; name?: string };

const manifests = import.meta.glob<Manifest>(['../../../../themes/*/theme.json', '../../../../themes/services/*/theme.json'], { eager: true, import: 'default' });
const invalid = { code: 'INVALID', message: 'This folder is not a valid style.' };
let loading: Promise<StyleDefinition[]> | undefined;
export function invalidateStyleCatalog() { loading = undefined; }

function definitions(value: unknown): StyleDefinition[] {
  if (!Array.isArray(value)) throw new Error('Style catalog is unavailable');
  const seen = new Set<string>();
  const list: StyleDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = 'id' in item && typeof item.id === 'string' ? item.id.trim() : '';
    const name = 'name' in item && typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, name });
  }
  return list;
}

export function compiledStyles(): StyleDefinition[] {
  return definitions(Object.values(manifests));
}

function isFault(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

async function registerStored(value: ThemeFiles) {
  const icons = await Display.AgentIcons();
  const prepared = prepareTheme(value, icons);
  registerTheme(prepared.id, prepared.template, prepared.stylesheet, prepared.width, prepared.height, prepared.dataLayout);
  return { id: prepared.id, name: prepared.name };
}

export async function deleteStyle(id: string): Promise<void> {
  await Styles.Delete(id);
  unregisterTheme(id);
  invalidateStyleCatalog();
}

export function loadStyleCatalog(): Promise<StyleDefinition[]> {
  return loading ??= readStyleCatalog().catch(error => { loading = undefined; throw error; });
}

async function readStyleCatalog(): Promise<StyleDefinition[]> {
  const compiled = compiledStyles();
  const stored = (await Styles.List()) ?? [];
  const added: StyleDefinition[] = [];
  for (const style of stored) added.push(await registerStored(style));
  const seen = new Set(compiled.map(style => style.id));
  return [...compiled, ...added.filter(style => !seen.has(style.id))];
}

export async function importStyleFolder(): Promise<void> {
  const folder = await Application.ChooseStyleFolder();
  if (!folder) return;
  const draft = await Styles.BeginImport(folder, compiledStyles().map(style => style.id));
  try {
    await registerStored(draft);
    await Styles.FinishImport(draft.token);
    invalidateStyleCatalog();
  } catch (error) {
    await Styles.CancelImport(draft.token);
    unregisterTheme(draft.id);
    if (isFault(error)) throw error;
    throw invalid;
  }
}
