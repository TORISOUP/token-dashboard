import * as RealApplication from '@bindings/token-monitor-turzx/internal/desktop/service';
import * as RealDisplay from '@bindings/token-monitor-turzx/internal/display/service';
import * as RealSettings from '@bindings/token-monitor-turzx/internal/settings/service';
import * as RealStyles from '@bindings/token-monitor-turzx/internal/styles/service';
import type { SaveRequest } from '@bindings/token-monitor-turzx/internal/settings/models';

// One composition point for stage-3 agreement. Normal builds only use the real services.
const mock = import.meta.env.VITE_STYLE_IMPORT_MOCK === '1' ? import('./style-import-mock') : null;

export const Application = {
  ...RealApplication,
  async ChooseStyleFolder() { return mock ? (await mock).Application.ChooseStyleFolder() : RealApplication.ChooseStyleFolder(); },
};
export const Settings = {
  ...RealSettings,
  async Get() { return mock ? (await mock).Settings.Get() : RealSettings.Get(); },
  async Save(request: SaveRequest) { return mock ? (await mock).Settings.Save(request) : RealSettings.Save(request); },
};
export const Display = {
  ...RealDisplay,
  async RenderRequest() { return mock ? (await mock).Display.RenderRequest() : RealDisplay.RenderRequest(); },
  async ThemePreview(id: string) { return mock ? (await mock).Display.ThemePreview(id) : RealDisplay.ThemePreview(id); },
};
export const Styles = {
  ...RealStyles,
  async List() { return mock ? (await mock).Styles.List() : RealStyles.List(); },
  async BeginImport(folder: string, ids: string[] | null) { return mock ? (await mock).Styles.BeginImport(folder, ids) : RealStyles.BeginImport(folder, ids); },
  async FinishImport(token: string) { return mock ? (await mock).Styles.FinishImport(token) : RealStyles.FinishImport(token); },
  async CancelImport(token: string) { return mock ? (await mock).Styles.CancelImport(token) : RealStyles.CancelImport(token); },
  async Delete(id: string) { return mock ? (await mock).Styles.Delete(id) : RealStyles.Delete(id); },
};
