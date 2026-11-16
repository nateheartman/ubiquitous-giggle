/**
 * The two guards a database puts around formulas that read each other: one
 * against loops (a value that, worked out, needs itself) and one against
 * chains of related rows reading each other's formulas that go too deep.
 * They hold no database knowledge, so databases.svelte.ts and the tests use
 * the very same code.
 */
import { FormulaError } from './formula';

/** How many related rows' properties a formula may read through one another. */
export const MAX_HOPS = 3;

/** Stops a value from being worked out while it's already being worked out. */
export class LoopGuard {
  #open = new Set<string>();

  /** Runs `f` for `key`; when `key` is already running, gives `loop()` instead. */
  run<T>(key: string, loop: () => FormulaError, f: () => T): T | FormulaError {
    if (this.#open.has(key)) return loop();
    this.#open.add(key);
    try {
      return f();
    } finally {
      this.#open.delete(key);
    }
  }
}

/**
 * Counts how many related rows' properties are being read inside one
 * another (a formula reading a related row's formula, which reads another's…).
 * Past `max` it's an error: a long chain is slow, and one that comes back
 * round is a loop the LoopGuard would catch only after going the whole way.
 */
export class HopGuard {
  #hops = 0;

  constructor(
    readonly max: number = MAX_HOPS,
    private tooDeep: () => FormulaError = () => new FormulaError('too many linked rows'),
  ) {}

  /** Runs `f` one hop deeper; throws when that would pass the limit. */
  within<T>(f: () => T): T {
    if (this.#hops >= this.max) throw this.tooDeep();
    this.#hops++;
    try {
      return f();
    } finally {
      this.#hops--;
    }
  }
}
