import { getInstallationKey } from '@/core/device/InstallationKey';

import { replaceProviderConfig } from '../../core/providers/providerConfig';
import type { ProviderSelectionInputs } from '../../core/providers/ProviderRuntimeHost';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import type { HostnameCLIPaths } from '../../core/types/settings';
import { type CopilotModel, decodeCopilotModelId, normalizeCopilotModels } from './models';

export interface CopilotCatalogSnapshot {
  defaultModelId: string | null;
  models: CopilotModel[];
  refreshedAt: number;
}

export interface PersistedCopilotProviderSettings {
  catalogsByHost: Record<string, CopilotCatalogSnapshot>;
  cliPath: string;
  cliPathsByHost: HostnameCLIPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  preferredReasoningByModel: Record<string, string>;
  visibleModels: string[] | null;
}

export interface CopilotProviderSettings extends PersistedCopilotProviderSettings {
  currentCatalog: CopilotCatalogSnapshot | null;
}

export const DEFAULT_COPILOT_PROVIDER_SETTINGS: Readonly<PersistedCopilotProviderSettings> = Object.freeze({
  catalogsByHost: {},
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  preferredReasoningByModel: {},
  visibleModels: [],
});

/** Explicit selection order wins; an unset selection shows the catalog with its default first. */
export function getOrderedCopilotVisibleModelIds(settings: CopilotProviderSettings): string[] {
  if (settings.visibleModels !== null) return [...settings.visibleModels];
  const models = settings.currentCatalog?.models ?? [];
  const defaultModelId = settings.currentCatalog?.defaultModelId;
  if (!defaultModelId || !models.some(model => model.rawId === defaultModelId)) {
    return models.map(model => model.rawId);
  }
  return [defaultModelId, ...models.filter(model => model.rawId !== defaultModelId).map(model => model.rawId)];
}

export function getCopilotMigratedVisibleModelIds(current: CopilotProviderSettings): string[] {
  return current.visibleModels ?? [...new Set([
    ...getOrderedCopilotVisibleModelIds(current),
    ...Object.values(current.catalogsByHost).flatMap(catalog => catalog.models.map(model => model.rawId)),
  ])];
}

export function decodeCopilotConfig(
  config: Readonly<Record<string, unknown>>,
  selection: Pick<ProviderSelectionInputs, 'referencedModelIds'>,
): CopilotProviderSettings {
  const catalogsByHost = normalizeCatalogsByHost(config.catalogsByHost ?? config.selectedModelsByHost);
  const currentCatalog = catalogsByHost[getInstallationKey()] ?? null;
  const visibleModels = normalizeVisibleModels(config.visibleModels);
  const allowed = collectAllowedModelIds(currentCatalog, visibleModels, selection);
  return {
    catalogsByHost,
    cliPath: readTrimmedString(config.cliPath),
    cliPathsByHost: normalizeHostnameStringMap(config.cliPathsByHost),
    currentCatalog,
    enabled: typeof config.enabled === 'boolean' ? config.enabled : DEFAULT_COPILOT_PROVIDER_SETTINGS.enabled,
    environmentHash: readTrimmedString(config.environmentHash),
    environmentVariables: typeof config.environmentVariables === 'string' ? config.environmentVariables : '',
    modelAliases: normalizeModelStringMap(config.modelAliases, allowed),
    preferredReasoningByModel: normalizeModelStringMap(config.preferredReasoningByModel, allowed),
    visibleModels,
  };
}

/** Applies updates to a stored configuration in place. */
export function updateCopilotConfig(
  config: Record<string, unknown>,
  selection: Pick<ProviderSelectionInputs, 'referencedModelIds'>,
  updates: Partial<CopilotProviderSettings>,
): CopilotProviderSettings {
  const current = decodeCopilotConfig(config, selection);
  const hostKey = getInstallationKey();
  let cliPathsByHost = updates.cliPathsByHost !== undefined
    ? normalizeHostnameStringMap(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let cliPath = current.cliPath;
  if ('cliPath' in updates && updates.cliPathsByHost === undefined) {
    const hostCliPath = readTrimmedString(updates.cliPath);
    cliPathsByHost = { ...cliPathsByHost };
    if (hostCliPath) cliPathsByHost[hostKey] = hostCliPath;
    else delete cliPathsByHost[hostKey];
    cliPath = '';
  } else if (updates.cliPathsByHost !== undefined) {
    cliPath = readTrimmedString(updates.cliPath);
  }
  const catalogsByHost = updates.catalogsByHost !== undefined
    ? normalizeCatalogsByHost(updates.catalogsByHost)
    : { ...current.catalogsByHost };
  const currentCatalog = catalogsByHost[hostKey] ?? null;
  const visibleModels = updates.visibleModels !== undefined
    ? normalizeVisibleModels(updates.visibleModels)
    : current.visibleModels;
  const allowed = collectAllowedModelIds(currentCatalog, visibleModels, selection);
  const next: PersistedCopilotProviderSettings = {
    catalogsByHost,
    cliPath,
    cliPathsByHost,
    enabled: updates.enabled ?? current.enabled,
    environmentHash: updates.environmentHash !== undefined
      ? readTrimmedString(updates.environmentHash)
      : current.environmentHash,
    environmentVariables: updates.environmentVariables ?? current.environmentVariables,
    modelAliases: normalizeModelStringMap(updates.modelAliases ?? current.modelAliases, allowed),
    preferredReasoningByModel: normalizeModelStringMap(
      updates.preferredReasoningByModel ?? current.preferredReasoningByModel,
      allowed,
    ),
    visibleModels,
  };
  replaceProviderConfig(config, next as unknown as Record<string, unknown>);
  return { ...next, currentCatalog };
}

export function normalizeCopilotCatalogSnapshot(value: unknown): CopilotCatalogSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    defaultModelId: normalizeRawModelId(value.defaultModelId),
    models: normalizeCopilotModels(value.models),
    refreshedAt: typeof value.refreshedAt === 'number' && Number.isFinite(value.refreshedAt) && value.refreshedAt >= 0
      ? Math.floor(value.refreshedAt)
      : 0,
  };
}

function normalizeCatalogsByHost(value: unknown): Record<string, CopilotCatalogSnapshot> {
  if (!isRecord(value)) return {};
  const catalogs: Record<string, CopilotCatalogSnapshot> = {};
  for (const [hostKey, snapshot] of Object.entries(value)) {
    const key = hostKey.trim();
    const normalized = normalizeCopilotCatalogSnapshot(snapshot);
    if (key && normalized) {
      Object.defineProperty(catalogs, key, { value: normalized, enumerable: true, writable: true, configurable: true });
    }
  }
  return catalogs;
}

function normalizeVisibleModels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    const rawId = normalizeRawModelId(entry);
    if (rawId && !ids.includes(rawId)) ids.push(rawId);
  }
  return ids;
}

function collectAllowedModelIds(
  catalog: CopilotCatalogSnapshot | null,
  visibleModels: readonly string[] | null,
  selection: Pick<ProviderSelectionInputs, 'referencedModelIds'>,
): Set<string> | null {
  const catalogModels = catalog?.models ?? [];
  // Without a catalog, keep stored metadata until discovery can judge it.
  if (catalogModels.length === 0) return null;
  const allowed = new Set(catalogModels.map(model => model.rawId));
  for (const id of visibleModels ?? []) allowed.add(id);
  for (const id of selection.referencedModelIds) {
    const rawId = decodeCopilotModelId(id);
    if (rawId) allowed.add(rawId);
  }
  return allowed;
}

function normalizeModelStringMap(value: unknown, allowed: ReadonlySet<string> | null): Record<string, string> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [modelId, entry] of Object.entries(value)) {
    const rawId = normalizeRawModelId(modelId);
    const text = readTrimmedString(entry);
    if (!rawId || !text || (allowed && !allowed.has(rawId))) continue;
    Object.defineProperty(normalized, rawId, { value: text, enumerable: true, writable: true, configurable: true });
  }
  return normalized;
}

function normalizeRawModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return decodeCopilotModelId(normalized) ?? normalized;
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
