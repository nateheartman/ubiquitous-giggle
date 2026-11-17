/**
 * Meeting types: what tells the summarizer what kind of summary to write.
 * Four are built in (their names and instructions are messages, passed in as
 * `Defaults`); the user can edit a built-in's instructions and add types of
 * their own. Plain data and functions, kept on this Mac by meeting.svelte.ts.
 */

export type BuiltinId = 'general' | 'oneOnOne' | 'team' | 'sales';
export const BUILTIN_IDS: BuiltinId[] = ['general', 'oneOnOne', 'team', 'sales'];

export interface CustomType {
  id: string;
  name: string;
  instructions: string;
}

/** What's stored: edited built-in instructions, and the user's own types. */
export interface TypesData {
  overrides: Partial<Record<BuiltinId, string>>;
  custom: CustomType[];
}

export interface MeetingType {
  id: string;
  name: string;
  instructions: string;
  builtin: boolean;
  /** A built-in whose instructions the user changed. */
  edited: boolean;
}

export type Defaults = Record<BuiltinId, { name: string; instructions: string }>;

const isBuiltin = (id: string): id is BuiltinId => (BUILTIN_IDS as string[]).includes(id);

export function listTypes(data: TypesData, defaults: Defaults): MeetingType[] {
  const builtins = BUILTIN_IDS.map((id) => {
    const own = data.overrides[id];
    return { id, name: defaults[id].name, instructions: own ?? defaults[id].instructions, builtin: true, edited: own !== undefined };
  });
  return [...builtins, ...data.custom.map((c) => ({ ...c, builtin: false, edited: false }))];
}

/**
 * The type a meeting asks for. One this Mac doesn't know (deleted, or made on
 * another Mac) is rebuilt from the copy stored with the meeting's summary;
 * without that, it's General.
 */
export function resolveType(id: string, data: TypesData, defaults: Defaults, stored?: { typeName: string; instructions: string } | null): MeetingType {
  const all = listTypes(data, defaults);
  const found = all.find((x) => x.id === id);
  if (found) return found;
  if (stored) return { id, name: stored.typeName, instructions: stored.instructions, builtin: false, edited: false };
  return all[0];
}

/** Reads what localStorage held, keeping only what makes sense. */
export function readTypes(raw: unknown): TypesData {
  const out: TypesData = { overrides: {}, custom: [] };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { overrides?: unknown; custom?: unknown };
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [k, v] of Object.entries(r.overrides)) if (isBuiltin(k) && typeof v === 'string') out.overrides[k] = v;
  }
  if (Array.isArray(r.custom)) {
    for (const c of r.custom as Partial<CustomType>[]) {
      if (c && typeof c.id === 'string' && c.id && !isBuiltin(c.id) && typeof c.name === 'string' && typeof c.instructions === 'string') {
        out.custom.push({ id: c.id, name: c.name, instructions: c.instructions });
      }
    }
  }
  return out;
}

function newId(data: TypesData): string {
  for (;;) {
    const id = `custom-${Math.random().toString(36).slice(2, 10)}`;
    if (!data.custom.some((c) => c.id === id)) return id;
  }
}

export function addCustom(data: TypesData, name: string, instructions: string, id: string = newId(data)): TypesData {
  return { ...data, custom: [...data.custom, { id, name, instructions }] };
}

/** Built-ins take new instructions only; their names are the app's. */
export function updateType(data: TypesData, id: string, patch: { name?: string; instructions?: string }): TypesData {
  if (isBuiltin(id)) {
    return patch.instructions === undefined ? data : { ...data, overrides: { ...data.overrides, [id]: patch.instructions } };
  }
  return { ...data, custom: data.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function resetBuiltin(data: TypesData, id: BuiltinId): TypesData {
  const overrides = { ...data.overrides };
  delete overrides[id];
  return { ...data, overrides };
}

export function deleteCustom(data: TypesData, id: string): TypesData {
  return { ...data, custom: data.custom.filter((c) => c.id !== id) };
}
