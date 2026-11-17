import { describe, expect, it } from 'vitest';
import { meetingText, readAttrs, summaryLines, type MeetingSummary } from './meeting-text';

const SUMMARY: MeetingSummary = {
  md: '## Overview\nWe reviewed the Project.',
  typeId: 'team',
  typeName: 'Team meeting',
  instructions: 'Updates by person.',
  at: 1_763_000_000_000,
  model: 'qwen3.5-4b-q4_k_m',
};
const TURNS = [
  { sp: '1', s: 5_000, e: 8_000, t: 'Hello everyone.' },
  { sp: 'me', s: 65_000, e: 70_000, t: 'Thanks.' },
];

describe('meeting summary attributes', () => {
  it('keeps a valid summary', () => {
    expect(readAttrs({ summary: SUMMARY, typeId: 'team' })).toMatchObject({ summary: SUMMARY, typeId: 'team' });
  });

  it('drops a malformed summary', () => {
    expect(readAttrs({ summary: { typeId: 'team' } }).summary).toBeNull();
    expect(readAttrs({ summary: { ...SUMMARY, md: 3 } }).summary).toBeNull();
    expect(readAttrs({ summary: 'x' }).summary).toBeNull();
  });

  it('defaults typeId to general', () => {
    expect(readAttrs({}).typeId).toBe('general');
    expect(readAttrs({ typeId: '' }).typeId).toBe('general');
  });

  it('summaryLines uses the names given and the clock', () => {
    expect(summaryLines(TURNS, { '1': 'Alice' })).toEqual(['Alice (0:05): Hello everyone.', expect.stringMatching(/^.+ \(1:05\): Thanks\.$/)]);
  });

  it('meetingText puts the summary between title and transcript', () => {
    const text = meetingText({ title: 'Project sync', turns: TURNS, names: { '1': 'Alice' }, summary: SUMMARY });
    const [title, ...rest] = text.split('\n');
    expect(title).toBe('Project sync');
    expect(rest.slice(0, 2)).toEqual(['## Overview', 'We reviewed the Project.']);
    expect(rest[2]).toMatch(/^Alice · 0:05 · Hello everyone\.$/);
  });
});
