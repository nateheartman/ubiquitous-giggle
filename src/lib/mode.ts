/**
 * School or Work: which words the app uses and what it shows.
 *
 * Work mode re-labels the school structures as PARA (Projects, Areas,
 * Resources, Archive): Courses become Areas, Assignments become Tasks, and
 * Grades are hidden. It is only a vocabulary and a few hidden things; no data
 * is changed, so switching back and forth is lossless.
 *
 * Like the language, the mode is kept in localStorage under its own key and
 * read once, when this module is first imported (the i18n layer needs it
 * before anything asks for a message), and changing it reloads the window
 * (td:reload), so every label worked out at start-up comes out in the new
 * words. A workspace that never chose is in school mode.
 */

export type Mode = 'school' | 'work';

const STORE = 'thoughtnotes.mode';

function read(): Mode {
  try {
    return localStorage.getItem(STORE) === 'work' ? 'work' : 'school';
  } catch {
    return 'school';
  }
}

/** Whether a mode was ever picked (the first-launch question has been answered). */
function picked(): boolean {
  try {
    return localStorage.getItem(STORE) !== null;
  } catch {
    return false;
  }
}

export const mode = {
  /** The mode this window started in. */
  current: read() as Mode,
  /** True once someone has chosen, in the welcome steps or in Settings. */
  chosen: picked(),
  get work(): boolean {
    return this.current === 'work';
  },
  /** Keeps a new choice for the next start; false if it couldn't be kept. The caller then reloads the window (td:reload). */
  choose(next: Mode): boolean {
    try {
      localStorage.setItem(STORE, next);
      this.current = next;
      this.chosen = true;
      return true;
    } catch {
      return false;
    }
  },
};
