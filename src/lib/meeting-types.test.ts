import { describe, expect, it } from 'vitest';
import { addCustom, deleteCustom, listTypes, readTypes, resetBuiltin, resolveType, updateType, type Defaults, type TypesData } from './meeting-types';

const DEFAULTS: Defaults = {
  general: { name: 'General', instructions: 'Overview, decisions, action items.' },
  oneOnOne: { name: '1:1', instructions: 'Feedback and follow-ups.' },
  team: { name: 'Team meeting', instructions: 'Updates by person.' },
  sales: { name: 'Sales call', instructions: 'Customer needs and next steps.' },
};
const EMPTY: TypesData = { overrides: {}, custom: [] };

describe('meeting types', () => {
  it('lists built-ins in order, then custom types', () => {
    const data = addCustom(EMPTY, 'Project review', 'List risks first.', 'c1');
    expect(listTypes(data, DEFAULTS).map((x) => [x.id, x.name, x.builtin])).toEqual([
      ['general', 'General', true],
      ['oneOnOne', '1:1', true],
      ['team', 'Team meeting', true],
      ['sales', 'Sales call', true],
      ['c1', 'Project review', false],
    ]);
  });

  it('marks an edited built-in, and reset restores it', () => {
    const edited = updateType(EMPTY, 'team', { instructions: 'Blockers first.' });
    const team = listTypes(edited, DEFAULTS).find((x) => x.id === 'team')!;
    expect(team).toMatchObject({ instructions: 'Blockers first.', edited: true });
    const reset = listTypes(resetBuiltin(edited, 'team'), DEFAULTS).find((x) => x.id === 'team')!;
    expect(reset).toMatchObject({ instructions: 'Updates by person.', edited: false });
  });

  it("doesn't rename a built-in", () => {
    const data = updateType(EMPTY, 'sales', { name: 'Deals' });
    expect(listTypes(data, DEFAULTS).find((x) => x.id === 'sales')!.name).toBe('Sales call');
  });

  it('adds, updates and deletes custom types', () => {
    let data = addCustom(EMPTY, 'Project review', 'List risks first.', 'c1');
    data = updateType(data, 'c1', { name: 'Review', instructions: 'Risks, then tasks.' });
    expect(resolveType('c1', data, DEFAULTS)).toMatchObject({ name: 'Review', instructions: 'Risks, then tasks.', builtin: false });
    data = deleteCustom(data, 'c1');
    expect(listTypes(data, DEFAULTS)).toHaveLength(4);
  });

  it('gives a new custom type a fresh id', () => {
    const data = addCustom(addCustom(EMPTY, 'A', ''), 'B', '');
    const ids = data.custom.map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => !(id in DEFAULTS))).toBe(true);
  });

  it('resolveType falls back to the stored copy', () => {
    const got = resolveType('gone', EMPTY, DEFAULTS, { typeName: 'Old review', instructions: 'Risks.' });
    expect(got).toEqual({ id: 'gone', name: 'Old review', instructions: 'Risks.', builtin: false, edited: false });
  });

  it('resolveType with nothing stored falls back to General', () => {
    expect(resolveType('gone', EMPTY, DEFAULTS)).toMatchObject({ id: 'general', name: 'General' });
  });

  it('readTypes ignores junk', () => {
    expect(readTypes(null)).toEqual(EMPTY);
    expect(readTypes('x')).toEqual(EMPTY);
    expect(
      readTypes({
        overrides: { team: 'Blockers first.', nope: 'x', sales: 3 },
        custom: [{ id: 'c1', name: 'Review', instructions: 'Risks.' }, { id: 2 }, null, { id: 'general', name: 'Clash', instructions: '' }],
      }),
    ).toEqual({ overrides: { team: 'Blockers first.' }, custom: [{ id: 'c1', name: 'Review', instructions: 'Risks.' }] });
  });
});
