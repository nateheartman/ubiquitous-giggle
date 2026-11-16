/** The cloud this run uses: the test fake when a test provides one (development only), else Supabase. Loaded on first use. */

import type { Cloud } from './types';

let loading: Promise<Cloud> | null = null;

export function cloud(): Promise<Cloud> {
  return (loading ??=
    import.meta.env.DEV && '__fakeCloud' in window ? import('./fake').then((m) => m.fakeCloud) : import('./supabase').then((m) => m.supabaseCloud));
}

export * from './types';
