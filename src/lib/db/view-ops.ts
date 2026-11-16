/**
 * The plain parts of a linked block's own views (see view-scope.svelte.ts):
 * copy-on-write and the edits to a list of views. Nothing here touches the
 * database store, so it can be tested on its own.
 */
import { byKey, keyBetween } from './order';
import type { DbView, ViewConfig } from '../types';

/** A deep, plain copy (views may arrive as reactive proxies). */
export const cloneViews = (views: DbView[]): DbView[] => JSON.parse(JSON.stringify(views)) as DbView[];

/**
 * Applies `change` to the block's views: its own if it has them, otherwise a
 * copy of the shared ones, which then become its own (`adopted`). Neither
 * list is modified.
 */
export function withEdit(owned: DbView[] | null, shared: DbView[], change: (list: DbView[]) => void): { views: DbView[]; adopted: boolean } {
  const list = cloneViews(owned ?? shared);
  change(list);
  return { views: list.sort(byKey), adopted: !owned };
}

export function patchConfig(list: DbView[], id: string, patch: Partial<ViewConfig>) {
  const v = list.find((x) => x.id === id);
  if (v) v.config = { ...v.config, ...patch };
}

export function renameIn(list: DbView[], id: string, name: string) {
  const v = list.find((x) => x.id === id);
  if (v) v.name = name;
}

/** Adds a view after the last one; `name` is the layout's name, numbered if taken. */
export function addTo(list: DbView[], view: Pick<DbView, 'id' | 'type' | 'config'>, name: string, numbered: (name: string, n: number) => string) {
  const taken = new Set(list.map((v) => v.name));
  let label = name;
  for (let i = 2; taken.has(label); i++) label = numbered(name, i);
  list.push({ ...view, name: label, sortKey: keyBetween(list.at(-1)?.sortKey ?? null, null) });
}

export function duplicateIn(list: DbView[], id: string, newId: string, name: (src: string) => string) {
  const src = list.find((v) => v.id === id);
  if (!src) return;
  const next = [...list].sort(byKey).find((v) => v.sortKey > src.sortKey);
  list.push({ ...JSON.parse(JSON.stringify(src)), id: newId, name: name(src.name), sortKey: keyBetween(src.sortKey, next?.sortKey ?? null) });
}

/** Removes a view (never the last one). */
export function removeFrom(list: DbView[], id: string) {
  const at = list.findIndex((v) => v.id === id);
  if (at >= 0 && list.length > 1) list.splice(at, 1);
}

export function moveIn(list: DbView[], id: string, toIndex: number) {
  const v = list.find((x) => x.id === id);
  if (!v) return;
  const rest = list.filter((x) => x !== v).sort(byKey);
  v.sortKey = keyBetween(rest[toIndex - 1]?.sortKey ?? null, rest[toIndex]?.sortKey ?? null);
}

/** The template new rows start from, in one view or (id null) every view. */
export function setTemplateIn(list: DbView[], templateId: string, id: string | null) {
  for (const v of list) if (id === null || v.id === id) v.config = { ...v.config, template: templateId };
}
