/**
 * Where a database's views are read and edited. Normally that's the
 * database itself (every place that shows it shares its views). A *linked*
 * database block, one shown in a page other than the database's own, can
 * own its views instead, as in Notion: its filters and sorts belong to that
 * page, so "This page" on a project's Tasks view doesn't empty the Tasks
 * database's own views.
 *
 * Everything that reads or changes a view goes through a ViewScope (the
 * methods mirror `databases`' own), so no edit made inside a block can land
 * in the shared views. A block starts out sharing, and copies the shared
 * views into itself on its first change (copy-on-write).
 */
import { getContext, setContext } from 'svelte';
import { databases, VIEW_NAMES, isDefaultViewName } from '../databases.svelte';
import { addTo, cloneViews, duplicateIn, moveIn, patchConfig, removeFrom, renameIn, setTemplateIn, withEdit } from './view-ops';
import { shortId } from './schema';
import { t } from '../i18n';
import type { DbView, ViewConfig, ViewType } from '../types';

/** What a block tells its scope about its own views. */
export interface ScopeHost {
  /** Whether the block is a linked one (shown outside the database's own page). */
  linked: () => boolean;
  /** The views the block owns, or null while it still shares the database's. */
  owned: () => DbView[] | null;
  /** Stores the block's own views (in the editor node's attributes). */
  setOwned: (views: DbView[]) => void;
  /** The block's views were just copied from the shared ones. */
  adopted?: () => void;
}

export class ViewScope {
  #host: ScopeHost | undefined;

  constructor(host?: ScopeHost) {
    this.#host = host;
  }

  /** Whether the views in play belong to the block. */
  get owned(): boolean {
    return !!this.#host?.owned();
  }

  /** Whether this scope's edits stay in a block (it is a linked one). */
  get local(): boolean {
    return !!this.#host?.linked();
  }

  views(dbId: string): DbView[] {
    return (this.local ? this.#host?.owned() : null) ?? databases.views(dbId);
  }

  view(dbId: string, viewId: string | null | undefined): DbView | undefined {
    const views = this.views(dbId);
    return views.find((v) => v.id === viewId) ?? views[0];
  }

  /** Changes the block's own views: copies the shared ones in first if it hasn't yet. */
  edit(dbId: string, change: (list: DbView[]) => void) {
    const host = this.#host;
    if (!host) return;
    const { views, adopted } = withEdit(host.owned(), databases.views(dbId), change);
    host.setOwned(views);
    if (adopted) host.adopted?.();
  }

  updateView(dbId: string, viewId: string, patch: Partial<ViewConfig>) {
    if (!this.local) return databases.updateView(dbId, viewId, patch);
    this.edit(dbId, (list) => patchConfig(list, viewId, patch));
  }

  renameView(dbId: string, viewId: string, name: string) {
    if (!this.local) return databases.renameView(dbId, viewId, name);
    this.edit(dbId, (list) => renameIn(list, viewId, name));
  }

  async changeViewType(dbId: string, viewId: string, type: ViewType) {
    if (!this.local) return databases.changeViewType(dbId, viewId, type);
    const v = this.views(dbId).find((x) => x.id === viewId);
    if (!v || v.type === type) return;
    const needs = await databases.defaultsFor(dbId, type);
    const c = v.config;
    const missing =
      (type === 'board' && !databases.prop(dbId, c.group)) ||
      ((type === 'calendar' || type === 'timeline') && !databases.prop(dbId, c.dateProp)) ||
      (type === 'timeline' && !c.scale) ||
      (type === 'form' && !c.form) ||
      (type === 'chart' && !c.chart) ||
      (type === 'gallery' && !c.cover);
    this.edit(dbId, (list) => {
      const w = list.find((x) => x.id === viewId);
      if (!w) return;
      w.config = missing ? { ...w.config, ...needs } : w.config;
      // A view still named after its old layout takes the new one's name.
      if (isDefaultViewName(w.name)) w.name = VIEW_NAMES[type];
      w.type = type;
    });
  }

  async addView(dbId: string, type: ViewType): Promise<DbView | null> {
    if (!this.local) return databases.addView(dbId, type);
    const config = await databases.defaultsFor(dbId, type);
    const id = shortId();
    this.edit(dbId, (list) => addTo(list, { id, type, config }, VIEW_NAMES[type], (name, number) => t('database.names.numbered', { name, number })));
    return this.views(dbId).find((v) => v.id === id) ?? null;
  }

  async duplicateView(dbId: string, viewId: string): Promise<DbView | null> {
    if (!this.local) return databases.duplicateView(dbId, viewId);
    const id = shortId();
    this.edit(dbId, (list) => duplicateIn(list, viewId, id, (name) => t('database.names.copy', { name })));
    return this.views(dbId).find((v) => v.id === id) ?? null;
  }

  async deleteView(dbId: string, viewId: string) {
    if (!this.local) return databases.deleteView(dbId, viewId);
    if (this.views(dbId).length < 2) return;
    this.edit(dbId, (list) => removeFrom(list, viewId));
  }

  moveView(dbId: string, viewId: string, toIndex: number) {
    if (!this.local) return databases.moveView(dbId, viewId, toIndex);
    this.edit(dbId, (list) => moveIn(list, viewId, toIndex));
  }

  /** The template new rows start from in a view (or every view: `viewId` null). */
  setDefaultTemplate(dbId: string, templateId: string, viewId: string | null) {
    if (!this.local) return databases.setDefaultTemplate(dbId, templateId, viewId);
    this.edit(dbId, (list) => setTemplateIn(list, templateId, viewId));
  }
}

const KEY = Symbol('view-scope');
const SHARED = new ViewScope();

/** Makes `scope` the one the views inside this component edit through. */
export function provideViewScope(scope: ViewScope) {
  setContext(KEY, scope);
}

/** The scope this component's views belong to (the database's own, outside a linked block). */
export function useViewScope(): ViewScope {
  return getContext<ViewScope | undefined>(KEY) ?? SHARED;
}

/**
 * A linked block's views: a copy of the source's current views, for a new
 * block (the ids stay, they only need to be unique within the block).
 */
export function copyViews(dbId: string): DbView[] {
  return cloneViews(databases.views(dbId));
}
