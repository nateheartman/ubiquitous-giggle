# 06 — Formula editor with property pills (Notion-style)

## Why
In Notion's formula editor, properties appear as **pills** (an icon for the type plus the name), not as `prop("Status")` text. You insert them by typing the name and picking from suggestions, and that includes properties of *related* databases after `current.` inside `map`/`filter`. The owner wants the same. Reference screenshot from the owner (Notion):

```
[↗ People].map(
    current.[↗ Tasks]
        .filter(
            current.[✳ Status] != "Done"
        ).filter(current.[Σ Next Due].empty())
).flat().unique()
```

## Decisions (orchestrator's calls)
- **Storage doesn't change.** The saved formula stays plain text (`prop("Status")`, and `current.prop("Status")` for related rows), so old formulas, `renameProperty`, `references`, sync and export are untouched. Pills are purely how the editor shows and edits it.
- Build the editor on **Tiptap/ProseMirror**, which is already a dependency: a small schema with text, hard breaks, and an inline **atom node `propRef`** (attrs: `name`, `scope: 'this' | 'related'`). Parse formula text → doc on open and serialize doc → text on every change. Round-trip tests must prove `serialize(parse(x)) === x` for every golden formula in `formula.golden.test.ts`, modulo the documented normalisation (`{Prop}` and bare names become `prop("Prop")` *only* when the user edits them; untouched text keeps its spelling).
- Replace the `<textarea>` in `FormulaEditor.svelte` with this component, keeping the existing reference panel, error display (underline at `FormulaError.at`, mapped to the doc position) and live preview.

## Behaviour
- **Pills** show the property's type icon (the same icons as the property menu) and its name, styled like Notion's: a grey rounded chip with monospace text around it. A pill is one atom: Backspace deletes it whole, and arrows move over it.
- **Inserting**: typing letters offers matching properties (and functions) in the existing suggestion list. Picking a property inserts a pill. Clicking a property in the reference panel inserts a pill at the cursor.
- **Related properties**: after `current.` inside a callback whose list is a relation (`prop("Tasks").filter(current.…`), suggestions list the **related database's** properties, and the pill renders with `scope: 'related'`. Work out the related database from the relation property's config. Nested callbacks (People → Tasks → Status, as in the screenshot) must resolve the right database at each level. If it can't be resolved, fall back to plain suggestions.
- **Syntax colouring** for functions/methods (pink/red), strings (green), operators, and numbers, like the screenshot. Use theme tokens for both themes.
- **Multi-line**: Enter inserts a newline (⌘Enter or the Done button saves), Tab indents by 4 spaces, and pasting plain text keeps line breaks. Check the parser treats newlines as whitespace, with tests.
- Pasting `prop("X")` text converts it to pills. Copying out gives the text form.
- A pill whose property no longer exists renders red with a strikethrough, and the formula shows the existing "no property called…" error.
- Keyboard and screen readers: each pill has `aria-label="property Status"`.

## Constraints
- Don't change `formula.ts`'s language or evaluation (task 03 owns that). You may export helpers from it (tokenizer positions) if needed.
- Bundle: no new dependencies beyond what's in package.json.

## Done when
- Checks in `00-conventions.md` pass, including Vitest round-trip tests (parse/serialize over all golden formulas, nested related scopes, paste) and the existing formula suites untouched.
- Playwright: type `Sta`, pick Status → pill; build `prop("Tasks").filter(current.Status != "Done").length()` purely through suggestions, with the related pill showing; Backspace deletes a pill whole; save and reopen keeps pills; the saved text is the expected `prop(...)` form; and the result value is correct.
