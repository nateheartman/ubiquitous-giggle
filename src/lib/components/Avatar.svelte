<script lang="ts">
  import { PALETTE } from '../colors';

  let { name, url = null, seed = name, size = 28 }: { name: string; url?: string | null; seed?: string; size?: number } = $props();

  // Only Clerk's picture host (sign-in keeps everyone's pictures there): a
  // picture elsewhere would show its server who's looking, and when.
  const KNOWN = /^https:\/\/img\.clerk\.com\//;
  const src = $derived(url && KNOWN.test(url) ? url : null);
  let broken = $state(false);
  const initials = $derived(
    name
      .replace(/^@/, '')
      .split(/[\s_.-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?',
  );
  // The same person gets the same colour everywhere.
  const color = $derived.by(() => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const keys = PALETTE.filter((c) => c.key !== 'gray');
    return `var(--c-${keys[h % keys.length].key})`;
  });
</script>

{#if src && !broken}
  <img class="avatar" {src} alt="" width={size} height={size} style:--size="{size}px" referrerpolicy="no-referrer" onerror={() => (broken = true)} />
{:else}
  <span class="avatar initials" style:--size="{size}px" style:background={color} aria-hidden="true">{initials}</span>
{/if}

<style>
  .avatar {
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    object-fit: cover;
  }
  .initials {
    display: inline-grid;
    place-items: center;
    color: white;
    font-size: calc(var(--size) * 0.4);
    font-weight: 600;
    letter-spacing: 0.02em;
    user-select: none;
  }
</style>
