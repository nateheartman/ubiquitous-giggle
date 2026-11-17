import { describe, expect, it } from 'vitest';
import { parseSummary } from './meeting-summary';

const plain = (text: string) => ({ text, bold: false });

describe('parseSummary', () => {
  it('reads headings, lists and paragraphs', () => {
    const md = '## Overview\nWe reviewed the Project.\n\n## Action items\n- Send the budget\n* Book a room';
    expect(parseSummary(md)).toEqual([
      { kind: 'heading', parts: [plain('Overview')] },
      { kind: 'para', parts: [plain('We reviewed the Project.')] },
      { kind: 'heading', parts: [plain('Action items')] },
      { kind: 'list', items: [[plain('Send the budget')], [plain('Book a room')]] },
    ]);
  });

  it('keeps bold runs inside a bullet', () => {
    expect(parseSummary('- **Alice**: send the budget')).toEqual([
      { kind: 'list', items: [[{ text: 'Alice', bold: true }, plain(': send the budget')]] },
    ]);
  });

  it('shows anything else as plain text', () => {
    const lines = ['### Deep', '1. First', '<b>tag</b>', '```', 'code', '```', '# Top'];
    expect(parseSummary(lines.join('\n'))).toEqual(lines.map((l) => ({ kind: 'para', parts: [plain(l)] })));
  });

  it('leaves an unclosed ** as literal text', () => {
    expect(parseSummary('Alice said **maybe')).toEqual([{ kind: 'para', parts: [plain('Alice said **maybe')] }]);
  });

  it('separates two lists split by a blank line into two lists', () => {
    expect(parseSummary('- a\n\n- b')).toEqual([
      { kind: 'list', items: [[plain('a')]] },
      { kind: 'list', items: [[plain('b')]] },
    ]);
  });
});
