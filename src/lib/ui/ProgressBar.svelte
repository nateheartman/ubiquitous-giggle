<script lang="ts">
  /** A thin bar filled to `done` of `total`, in the colour it's given (a project's). */
  let { done, total, color, label, thin = false }: { done: number; total: number; color: string; label: string; thin?: boolean } = $props();
  const pct = $derived(total ? Math.round((done / total) * 100) : 0);
</script>

<div class="bar" class:thin role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct} style:--fill={color}>
  <span style:width="{pct}%"></span>
</div>

<style>
  .bar {
    height: 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fill) 18%, var(--fill-2));
    overflow: hidden;
  }
  .bar.thin {
    height: 5px;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--fill);
    transition: width var(--dur-fast) var(--ease);
  }
</style>
