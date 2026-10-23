<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Swatches from '../ui/Swatches.svelte';
  import Switch from '../ui/Switch.svelte';
  import ColorWheel from '../ui/ColorWheel.svelte';
  import ShortcutsEditor from './ShortcutsEditor.svelte';
  import { oklchHex, parseHex, rgbToOklch } from '../color-math';
  import { shortcuts } from '../shortcuts.svelte';
  import { api } from '../api';
  import { ACCENTS, PALETTE, PALETTES, colorVar, nextColor, type Accent } from '../colors';
  import { planner } from '../planner.svelte';
  import { prefs, type Font, type TextSize, type RemindAssignments, type RemindEvents, type Theme, type WeekStart } from '../prefs.svelte';
  import { importCalendar } from '../ics-import.svelte';
  import { exportWorkspace } from '../export-workspace';
  import { chooseDataFolder, useDefaultDataFolder } from '../data-folder';
  import { SIDEBAR_ITEMS, setShownInSidebar, shownInSidebar } from '../sidebar-items';
  import { changeLook } from '../look-transition';
  import { ui } from '../ui.svelte';
  import { updates } from '../updates.svelte';
  import { MAX_ZOOM, MIN_ZOOM, zoomIn, zoomLabel, zoomOut, zoomReset } from '../zoom.svelte';
  import { formatBytes } from '../time';
  import { isMac } from '../platform';
  import type { DataInfo } from '../types';

  let info = $state<DataInfo | null>(null);

  onMount(() => {
    api.dataInfo().then((d) => (info = d), ui.error);
    if (ui.settingsSection) {
      document.getElementById(`settings-${ui.settingsSection}`)?.scrollIntoView({ block: 'start' });
      ui.settingsSection = null;
    }
    // Settings is the most expensive screen to draw. Chromium keeps those
    // graphics around for minutes; let it go as soon as Settings closes.
    return () => void api.trimMemory().catch(() => {});
  });

  const themes: { value: Theme; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
    { value: 'system', label: 'Auto', icon: 'monitor' },
  ];
  const fonts: { value: Font; label: string }[] = [
    { value: 'sans', label: 'Default' },
    { value: 'serif', label: 'Serif' },
    { value: 'mono', label: 'Mono' },
  ];
  const textSizes: { value: TextSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'default', label: 'Default' },
    { value: 'large', label: 'Large' },
    { value: 'xlarge', label: 'Larger' },
  ];
  const weekStarts: { value: WeekStart; label: string }[] = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
  ];
  const remindAssignments: { value: RemindAssignments; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'evening', label: 'Evening Before' },
    { value: 'morning', label: 'That Morning' },
  ];
  const remindEvents: { value: RemindEvents; label: string }[] = [
    { value: 0, label: 'Off' },
    { value: 5, label: '5 min' },
    { value: 10, label: '10 min' },
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
  ];

  /** The wheel's rim is this much chroma (as vivid as sRGB gets for most hues). */
  const MAX_CHROMA = 0.3;
  const customAccentHex = $derived(oklchHex(prefs.customAccent.lightness, prefs.customAccent.chroma, prefs.customAccent.hue));
  const accentLabel = $derived(
    prefs.accent === 'custom' ? `Custom · ${customAccentHex.toUpperCase()}` : (ACCENTS.find((a) => a.key === prefs.accent)?.label ?? 'Graphite'),
  );
  let hexDraft = $state('');
  $effect(() => {
    hexDraft = customAccentHex.toUpperCase();
  });

  function setAccentHex(raw: string) {
    const rgb = parseHex(raw);
    if (!rgb) {
      hexDraft = customAccentHex.toUpperCase();
      return;
    }
    const { l, c, h } = rgbToOklch(rgb);
    prefs.customAccent = { hue: c < 0.01 ? prefs.customAccent.hue : h, chroma: Math.min(MAX_CHROMA, c), lightness: l };
  }

  /** The custom theme's sidebar, page and text, for its preview tile and the wheel's knob. */
  const customTheme = $derived.by(() => {
    const { hue: h, tint: t } = prefs.customTheme;
    return prefs.resolvedTheme === 'dark'
      ? { bg: oklchHex(0.17, 0.028 * t, h), side: oklchHex(0.2, 0.032 * t, h), ink: oklchHex(0.95, 0.018 * t, h), knob: oklchHex(0.5, 0.12 * t, h) }
      : { bg: oklchHex(0.982, 0.028 * t, h), side: oklchHex(0.952, 0.042 * t, h), ink: oklchHex(0.25, 0.045 * t, h), knob: oklchHex(0.8, 0.12 * t, h) };
  });

  /** Starting points for a custom theme. */
  const themeIdeas = [
    { label: 'Ocean', hue: 235, tint: 0.7 },
    { label: 'Forest', hue: 150, tint: 0.6 },
    { label: 'Sand', hue: 75, tint: 0.65 },
    { label: 'Blush', hue: 15, tint: 0.55 },
    { label: 'Lavender', hue: 295, tint: 0.65 },
    { label: 'Mint', hue: 175, tint: 0.5 },
  ];

  async function copyPath() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.dataDir);
      ui.toast('Folder path copied');
    } catch (e) {
      ui.error(e);
    }
  }

  const addCourse = () => planner.promptCourse();

  async function renameCourse(id: string, name: string) {
    const res = await ui.prompt({ title: 'Rename Course', value: name, confirmLabel: 'Rename', icon: 'book' });
    if (res) void planner.updateCourse(id, { name: res.value });
  }

  function colorMenu(e: MouseEvent, id: string, current: string) {
    ui.openMenuAt(
      e.currentTarget as Element,
      PALETTE.map((p) => ({
        label: p.label,
        dot: colorVar(p.key),
        checked: current === p.key,
        action: () => void planner.updateCourse(id, { color: p.key }),
      })),
    );
  }

  const stats = $derived(
    info
      ? [
          { n: info.pageCount, one: 'Page', many: 'Pages' },
          { n: info.assignmentCount, one: 'Assignment', many: 'Assignments' },
          { n: info.eventCount, one: 'Event', many: 'Events' },
          { n: info.fileCount, one: 'File', many: 'Files' },
        ]
      : [],
  );
</script>

<Modal onclose={() => (ui.settingsOpen = false)} label="Settings">
  <header class="modal-head">
    <h2>Settings</h2>
    <button class="icon-btn" onclick={() => (ui.settingsOpen = false)} aria-label="Close"><Icon name="x" /></button>
  </header>

  <div class="modal-body fade">
    <h3 class="group-title">You</h3>
    <div class="group">
      <div class="group-row">
        <div class="row-label">
          Name
          <small>Home greets you by it</small>
        </div>
        <input
          class="field name-field"
          value={prefs.name}
          placeholder="Your name"
          maxlength="40"
          spellcheck="false"
          aria-label="Your name"
          onchange={(e) => (prefs.name = e.currentTarget.value.trim())}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
    </div>

    <h3 class="group-title">Appearance</h3>
    <div class="group">
      <div class="group-row">
        <div class="row-label">Theme</div>
        <Segmented options={themes} value={prefs.theme} onchange={(v) => changeLook(() => (prefs.theme = v))} label="Theme" />
      </div>
      <div class="group-row stack">
        <div class="row-label">
          Color theme
          <small>Backgrounds and text, in light and dark</small>
        </div>
        <div class="palettes" role="radiogroup" aria-label="Color theme">
          {#each PALETTES as p (p.key)}
            {@const [bg, side, ink] = prefs.resolvedTheme === 'dark' ? p.dark : p.light}
            <button class="palette" class:on={prefs.palette === p.key} role="radio" aria-checked={prefs.palette === p.key} onclick={() => (prefs.palette = p.key)}>
              <span class="mini" style:--bg={bg} style:--side={side} style:--ink={ink}>
                <span class="mini-side"><i></i><i></i><i></i></span>
                <span class="mini-page"><b></b><i></i><i></i><i class="short"></i></span>
              </span>
              <span class="pname">{p.label}</span>
            </button>
          {/each}
          <button class="palette" class:on={prefs.palette === 'custom'} role="radio" aria-checked={prefs.palette === 'custom'} onclick={() => (prefs.palette = 'custom')}>
            <span class="mini" style:--bg={customTheme.bg} style:--side={customTheme.side} style:--ink={customTheme.ink}>
              <span class="mini-side"><i></i><i></i><i></i></span>
              <span class="mini-page"><b></b><i></i><i></i><i class="short"></i></span>
              <span class="mini-wheel round"></span>
            </span>
            <span class="pname">Custom</span>
          </button>
        </div>
        {#if prefs.palette === 'custom'}
          <div class="picker">
            <ColorWheel
              kind="theme"
              label="Theme color"
              hue={prefs.customTheme.hue}
              amount={prefs.customTheme.tint}
              knob={customTheme.knob}
              onchange={(hue, tint) => (prefs.customTheme = { hue, tint })}
            />
            <div class="picker-side">
              <div class="picker-text">
                <strong>Your own theme</strong>
                <span>Turn the wheel to choose a color, and move out toward the edge for a stronger tint. Light and dark versions are made to match, with text kept easy to read.</span>
              </div>
              <label class="slider">
                <span>Tint</span>
                <input
                  class="range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={prefs.customTheme.tint}
                  style:--track="linear-gradient(to right, {oklchHex(0.9, 0, 0)}, {oklchHex(0.82, 0.12, prefs.customTheme.hue)})"
                  oninput={(e) => (prefs.customTheme = { ...prefs.customTheme, tint: Number(e.currentTarget.value) })}
                />
              </label>
              <div class="ideas">
                {#each themeIdeas as idea (idea.label)}
                  <button
                    class="chip idea"
                    style:--c={oklchHex(0.8, 0.1, idea.hue)}
                    onclick={() => (prefs.customTheme = { hue: idea.hue, tint: idea.tint })}
                  ><span class="dot"></span>{idea.label}</button>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>
      <div class="group-row">
        <div class="row-label">
          Accent color
          <small>{accentLabel}</small>
        </div>
        <Swatches keys={[...ACCENTS]} value={prefs.accent} onchange={(k) => (prefs.accent = k as Accent)} label="Accent color" custom={customAccentHex} />
      </div>
      {#if prefs.accent === 'custom'}
        <div class="group-row stack">
          <div class="picker">
            <ColorWheel
              kind="accent"
              label="Accent color"
              hue={prefs.customAccent.hue}
              amount={Math.min(1, prefs.customAccent.chroma / MAX_CHROMA)}
              knob={customAccentHex}
              onchange={(hue, amount) => (prefs.customAccent = { ...prefs.customAccent, hue, chroma: amount * MAX_CHROMA })}
            />
            <div class="picker-side">
              <label class="slider">
                <span>Brightness</span>
                <input
                  class="range"
                  type="range"
                  min="0.35"
                  max="0.9"
                  step="0.005"
                  value={prefs.customAccent.lightness}
                  style:--track="linear-gradient(to right, {oklchHex(0.35, prefs.customAccent.chroma, prefs.customAccent.hue)}, {oklchHex(0.62, prefs.customAccent.chroma, prefs.customAccent.hue)}, {oklchHex(0.9, prefs.customAccent.chroma, prefs.customAccent.hue)})"
                  oninput={(e) => (prefs.customAccent = { ...prefs.customAccent, lightness: Number(e.currentTarget.value) })}
                />
              </label>
              <div class="hex-row">
                <label class="field hex">
                  <span class="swatch-dot round" style:background={customAccentHex}></span>
                  <input
                    value={hexDraft}
                    spellcheck="false"
                    aria-label="Hex color"
                    maxlength="7"
                    oninput={(e) => (hexDraft = e.currentTarget.value)}
                    onchange={(e) => setAccentHex(e.currentTarget.value)}
                    onkeydown={(e) => e.key === 'Enter' && setAccentHex(e.currentTarget.value)}
                  />
                </label>
                <div class="accent-preview" aria-hidden="true">
                  <span class="pv-btn">Button</span>
                  <span class="pv-check round"></span>
                  <span class="pv-sel">selected</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
      <div class="group-row tall">
        <div class="row-label">
          Page font
          <small>Titles and writing</small>
        </div>
        <div class="fonts" role="radiogroup" aria-label="Page font">
          {#each fonts as f}
            <button class="font" class:on={prefs.font === f.value} data-font={f.value} role="radio" aria-checked={prefs.font === f.value} onclick={() => (prefs.font = f.value)}>
              <span class="ag">Ag</span>
              <span class="fname">{f.label}</span>
            </button>
          {/each}
        </div>
      </div>
      <div class="group-row">
        <div class="row-label">
          Zoom
          <small>Everything bigger or smaller, also with {isMac ? '⌘ and the scroll wheel, or a pinch' : 'Ctrl and the scroll wheel'}</small>
        </div>
        <div class="stepper" role="group" aria-label="Zoom">
          <button onclick={zoomOut} disabled={prefs.zoom <= MIN_ZOOM} aria-label="Zoom out" data-tip="Zoom out" data-tip-key={shortcuts.label('zoomOut')}><Icon name="minus" size={14} stroke={2} /></button>
          <button class="level" onclick={zoomReset} disabled={prefs.zoom === 1} aria-label="Zoom {zoomLabel(prefs.zoom)}, reset to 100%" data-tip="Actual size" data-tip-key={shortcuts.label('zoomReset')}>{zoomLabel(prefs.zoom)}</button>
          <button onclick={zoomIn} disabled={prefs.zoom >= MAX_ZOOM} aria-label="Zoom in" data-tip="Zoom in" data-tip-key={shortcuts.label('zoomIn')}><Icon name="plus" size={14} stroke={2} /></button>
        </div>
      </div>
      <div class="group-row">
        <div class="row-label">
          Text size
          <small>How big writing is on pages</small>
        </div>
        <Segmented options={textSizes} value={prefs.textSize} onchange={(v) => (prefs.textSize = v)} label="Text size" />
      </div>
    </div>

    <h3 class="group-title">Sidebar</h3>
    <div class="group">
      {#each SIDEBAR_ITEMS as item (item.key)}
        <div class="group-row">
          <div class="row-label">{item.label}</div>
          <Switch on={shownInSidebar(item.key)} label="Show {item.label} in the sidebar" onchange={() => setShownInSidebar(item.key, !shownInSidebar(item.key))} />
        </div>
      {/each}
    </div>
    <p class="group-note">Hidden ones are still a shortcut or a search away. Right-click an item in the sidebar to hide it from there.</p>

    <h3 class="group-title">Writing</h3>
    <div class="group">
      <div class="group-row">
        <div class="row-label">
          Check spelling
          <small>Underline words that look misspelled</small>
        </div>
        <Switch on={prefs.spellcheck} label="Check spelling" onchange={() => (prefs.spellcheck = !prefs.spellcheck)} />
      </div>
    </div>

    <h3 class="group-title">Quick Capture</h3>
    <div class="group">
      <div class="group-row">
        <div class="row-label">
          Capture from anywhere
          <small>{shortcuts.label('capture') || 'Its shortcut'} opens Quick Capture even when ThoughtNotes is in the background</small>
        </div>
        <Switch on={prefs.globalCapture} label="Capture from anywhere" onchange={() => (prefs.globalCapture = !prefs.globalCapture)} />
      </div>
    </div>

    <h3 class="group-title">Calendar</h3>
    <div class="group">
      <div class="group-row">
        <div class="row-label">Week starts on</div>
        <Segmented options={weekStarts} value={prefs.weekStart} onchange={(v) => (prefs.weekStart = v)} label="Week starts on" />
      </div>
      <div class="group-row">
        <div class="row-label">
          Import a calendar
          <small>Class schedules and due dates from a .ics file (Canvas, Google, Outlook)</small>
        </div>
        <button class="btn small raised" onclick={importCalendar}><Icon name="download" size={13} stroke={2.2} /> Import…</button>
      </div>
    </div>

    <h3 class="group-title">Reminders</h3>
    <div class="group">
      <div class="group-row">
        <div class="row-label">
          Assignments
          <small>Plus one an hour before anything with a due time</small>
        </div>
        <Segmented options={remindAssignments} value={prefs.remindAssignments} onchange={(v) => (prefs.remindAssignments = v)} label="Assignment reminders" />
      </div>
      <div class="group-row">
        <div class="row-label">
          Before events
          <small>Only events with a start time</small>
        </div>
        <Segmented options={remindEvents} value={prefs.remindEvents} onchange={(v) => (prefs.remindEvents = v)} label="Event reminders" />
      </div>
    </div>

    <h3 class="group-title">
      <span>Courses</span>
      <button class="btn small raised" onclick={addCourse}><Icon name="plus" size={13} stroke={2.2} /> Add Course</button>
    </h3>
    <div class="group">
      {#each planner.courses as c (c.id)}
        {@const used = planner.live.filter((a) => a.courseId === c.id).length}
        <div class="group-row compact course">
          <button class="course-color" onclick={(e) => colorMenu(e, c.id, c.color)} data-tip="Change color" aria-label="Change color">
            <span class="dot" style:--dot={colorVar(c.color)}></span>
          </button>
          <div class="row-label course-name">
            {c.name || 'Untitled'}
            <small>{used} assignment{used === 1 ? '' : 's'}</small>
          </div>
          <div class="course-actions">
            <button class="icon-btn" onclick={() => renameCourse(c.id, c.name)} data-tip="Rename" aria-label="Rename"><Icon name="pencil" size={15} /></button>
            <button class="icon-btn" onclick={() => planner.deleteCourse(c.id)} data-tip="Delete" aria-label="Delete"><Icon name="trash" size={15} /></button>
          </div>
        </div>
      {:else}
        <div class="group-row"><div class="row-label"><small>Courses group assignments and events and give them a color.</small></div></div>
      {/each}
    </div>

    <h3 class="group-title">Storage</h3>
    <div class="group">
      {#if info}
        <div class="group-row stats">
          {#each stats as st}
            <div class="stat"><strong>{st.n}</strong><span>{st.n === 1 ? st.one : st.many}</span></div>
          {/each}
        </div>
        <div class="group-row">
          <div class="row-label">Size</div>
          <span class="value">{formatBytes(info.dbBytes)} database · {formatBytes(info.fileBytes)} files</span>
        </div>
        <div class="group-row">
          <div class="row-label path-label">
            Location
            <small class="path" data-tip={info.dataDir}>{info.dataDir}</small>
          </div>
          <button class="btn small raised" onclick={copyPath}>Copy Path</button>
          {#if !info.envDir}
            <button class="btn small raised" onclick={() => void chooseDataFolder()}>Change…</button>
          {/if}
        </div>
        {#if info.missingDir}
          <div class="group-row">
            <div class="row-label path-label">
              Chosen folder not found
              <small class="path" data-tip={info.missingDir}>{info.missingDir} wasn't there when ThoughtNotes started, so these are the notes in its own folder. Connect the drive and restart, or keep using this folder.</small>
            </div>
            <button class="btn small raised" onclick={() => void useDefaultDataFolder(true)}>Use This Folder</button>
          </div>
        {:else if info.chosenDir && !info.envDir}
          <div class="group-row">
            <div class="row-label path-label">
              ThoughtNotes' own folder
              <small class="path" data-tip={info.defaultDir}>{info.defaultDir}</small>
            </div>
            <button class="btn small raised" onclick={() => void useDefaultDataFolder()}>Use Default</button>
          </div>
        {/if}
        <div class="group-row">
          <div class="row-label">
            Export All Notes
            <small>Every page as a Markdown file, in folders like the sidebar, with databases as CSV and the files they use.</small>
          </div>
          <button class="btn small raised" onclick={() => void exportWorkspace()}>Export…</button>
        </div>
      {:else}
        <div class="group-row"><div class="row-label"><small>Loading…</small></div></div>
      {/if}
    </div>
    <p class="group-note">Everything is stored in one SQLite file plus a files folder, in the folder above. Back it up to keep your work safe, or keep it in a folder that's backed up already (Change…).</p>

    <ShortcutsEditor />

    <p class="about">
      ThoughtNotes {info?.version ?? ''} ·
      <button
        class="link"
        onclick={() => {
          ui.settingsOpen = false;
          prefs.welcomed = false;
        }}>Show the welcome again</button
      >
    </p>
  </div>
</Modal>

<style>
  /* Colour themes: a tiny window drawn in each theme's colours. */
  .palettes {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }
  .palette {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 4px;
    border-radius: var(--r-md);
    color: var(--text-2);
    transition: color var(--dur) var(--ease);
  }
  .palette:hover,
  .palette.on {
    color: var(--text);
  }
  /* 10px tile − 4px padding = 6px picture corners. */
  .mini {
    position: relative;
    display: flex;
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: var(--r-xs);
    background: var(--bg);
    box-shadow: 0 0 0 1px var(--hairline);
    overflow: hidden;
    transition: box-shadow var(--dur) var(--ease);
  }
  .palette.on .mini {
    box-shadow:
      0 0 0 2px var(--bg-grouped),
      0 0 0 4px var(--accent);
  }
  .mini-side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 30%;
    padding: 8px 4px;
    background: var(--side);
  }
  .mini-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 6px;
  }
  .mini i,
  .mini b {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--ink);
    opacity: 0.22;
  }
  .mini b {
    width: 60%;
    height: 5px;
    opacity: 0.85;
  }
  .mini i.short {
    width: 50%;
  }
  .pname {
    font-size: var(--fs-footnote);
    font-weight: var(--fw-500);
  }

  /* The custom tile shows a little wheel in its corner. */
  .palettes {
    grid-template-columns: repeat(7, 1fr);
  }
  .mini-wheel {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: conic-gradient(
      oklch(0.75 0.15 0),
      oklch(0.75 0.15 90),
      oklch(0.75 0.15 180),
      oklch(0.75 0.15 270),
      oklch(0.75 0.15 360)
    );
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  /* Colour wheel rows */
  .picker {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 8px 0 4px;
  }
  .picker-side {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .picker-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .picker-text strong {
    font-size: var(--fs-body-ui);
    font-weight: var(--fw-600);
  }
  .picker-text span {
    font-size: var(--fs-footnote);
    line-height: 16px;
    color: var(--text-2);
  }
  .slider {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .slider > span {
    font-size: var(--fs-footnote);
    font-weight: var(--fw-500);
    color: var(--text-2);
  }
  .ideas {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .idea {
    gap: 6px;
    height: var(--h-xs);
    padding: 0 10px 0 8px;
    font-size: var(--fs-footnote);
    background: var(--raised);
    box-shadow: 0 0 0 0.5px var(--hairline);
  }
  .idea .dot {
    --dot: var(--c);
  }
  .hex-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .field.hex {
    width: 128px;
    font-family: var(--font-mono);
    font-size: var(--fs-ui);
  }
  .swatch-dot {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.2);
  }
  .accent-preview {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pv-btn {
    display: inline-grid;
    place-items: center;
    height: var(--h-sm);
    padding: 0 12px;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--fs-ui);
    font-weight: var(--fw-600);
  }
  .pv-check {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent) var(--check) center / 72% no-repeat;
  }
  .pv-sel {
    padding: 1px 3px;
    border-radius: 3px;
    background: var(--selection);
    font-size: var(--fs-ui);
  }

  /* Font picker */
  /* Zoom: minus, the level (click for 100%), plus, on one track like a segmented control. */
  .stepper {
    display: flex;
    flex: none;
    padding: 2px;
    border-radius: var(--r-sm);
    background: var(--fill-2);
  }
  .stepper button {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: var(--h-sm);
    border-radius: var(--r-xs);
    color: var(--text-2);
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  .stepper button:hover:not(:disabled) {
    background: var(--knob);
    color: var(--text);
    box-shadow:
      0 0 0 0.5px var(--hairline),
      var(--shadow-sm);
  }
  .stepper button:disabled {
    color: var(--text-4);
  }
  .stepper .level {
    width: 56px;
    font-size: var(--fs-ui);
    font-weight: var(--fw-500);
    font-variant-numeric: tabular-nums;
  }
  .stepper .level:disabled {
    color: var(--text);
  }
  .fonts {
    display: flex;
    gap: 8px;
    flex: none;
  }
  .font {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    width: 64px;
    height: 56px;
    border-radius: var(--r-sm);
    background: var(--raised);
    box-shadow: 0 0 0 1px var(--hairline);
    color: var(--text-2);
    transition:
      box-shadow var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .font:hover {
    color: var(--text);
  }
  .font.on {
    color: var(--text);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .ag {
    font-size: 21px;
    line-height: 1.15;
  }
  .font[data-font='sans'] .ag {
    font-family: var(--font-sans);
    font-weight: var(--fw-500);
  }
  .font[data-font='serif'] .ag {
    font-family: var(--font-serif);
  }
  .font[data-font='mono'] .ag {
    font-family: var(--font-mono);
    font-size: 18px;
  }
  .fname {
    font-size: var(--fs-caption);
    font-weight: var(--fw-500);
  }

  /* Courses */
  .course {
    justify-content: flex-start;
    gap: 12px;
    min-height: 48px;
  }
  .course-color {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-xs);
    transition: background-color var(--dur-fast) var(--ease);
  }
  .course-color:hover {
    background: var(--fill-2);
  }
  .course-color .dot {
    width: 12px;
    height: 12px;
  }
  .course-name {
    flex: 1;
  }
  .course-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
  }
  .course:hover .course-actions,
  .course-actions:focus-within {
    opacity: 1;
  }
  .course + :global(.course)::before {
    left: 52px;
  }

  /* Storage */
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    padding: 14px 16px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .stat + .stat {
    padding-left: 16px;
    box-shadow: inset 1px 0 0 var(--hairline);
  }
  .stat strong {
    font-size: 17px;
    font-weight: var(--fw-600);
    letter-spacing: -0.012em;
    font-variant-numeric: tabular-nums;
  }
  .stat span {
    font-size: var(--fs-footnote);
    color: var(--text-3);
  }
  .value {
    font-size: var(--fs-ui);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .path-label {
    flex: 1;
  }
  .path {
    font-family: var(--font-mono);
    font-size: 12px !important;
    color: var(--text-2) !important;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }

  .about {
    margin: 20px 0 0;
    text-align: center;
    font-size: var(--fs-footnote);
    color: var(--text-3);
  }
  .about .link {
    font-size: inherit;
    color: var(--text-2);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .about .link:hover {
    color: var(--text);
  }
  .name-field {
    width: 220px;
  }
</style>
