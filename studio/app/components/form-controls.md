# Shared Form Controls

Settings, mask editors and chat presets share these controls. Extend these
components instead of adding page-specific borders, checkbox marks or input sizes.

| Purpose                         | Component       | Source              |
| ------------------------------- | --------------- | ------------------- |
| Text, password or numeric value | `TextField`     | `form-controls.tsx` |
| Boolean setting                 | `Checkbox`      | `form-controls.tsx` |
| Form action or picker trigger   | `FieldButton`   | `form-controls.tsx` |
| A selectable option             | `ChoiceButton`  | `form-controls.tsx` |
| Native dropdown                 | `Select`        | `ui-lib.tsx`        |
| Multiline text                  | `Input`         | `ui-lib.tsx`        |
| Numeric range with value        | `InputRange`    | `input-range.tsx`   |
| Setting title and description   | `ListItem`      | `ui-lib.tsx`        |
| Dialog actions                  | `Modal.actions` | `ui-lib.tsx`        |

## Usage

```tsx
<ListItem title={Locale.Settings.CompressThreshold.Title}>
  <TextField
    type="number"
    aria-label={Locale.Settings.CompressThreshold.Title}
    value={threshold}
    onChange={(event) => setThreshold(event.currentTarget.valueAsNumber)}
  />
</ListItem>

<Checkbox
  aria-label={Locale.Settings.ReduceMotion}
  checked={reduceMotion}
  onChange={(event) => setReduceMotion(event.currentTarget.checked)}
/>

<FieldButton text={modelName} title={modelName} constrained onClick={openPicker} />
```

- Shared dimensions, surfaces and focus states live in `../styles/_controls.scss`.
  Form controls use a 36px minimum height and 8px radius.
  Checkboxes use a fixed 20px square, a theme border when off and theme fill when on.
- Use `fullWidth` for search fields and vertically arranged editors.
  Numeric fields reserve 120px for six-digit values and native spinner controls.
- Use `constrained` on model picker buttons. Long labels truncate visually;
  provide the full value through `title`.
- Keep visible strings and accessible labels in `Locale`. Preserve native
  `checked`, `disabled`, `readOnly`, keyboard behavior and change events.
- Keep action buttons in `Modal.actions`; reserve `footer` for supporting content.
- Page styles may arrange controls, but should not override their colors,
  borders, heights or checkbox pseudo-elements. Use component props for variants.
- Verify desktop and mobile layouts, long labels, six-digit values, checked and
  unchecked states, keyboard focus and theme changes after editing shared styles.

## Shared Interaction Colors

Ordinary buttons, menus, selection lists and parameter controls use
`controls.hover-surface` for hover/press and `controls.selected-surface` for
selected/open feedback. Both mixins control the surface and foreground together.
Configure their CSS variables in `../styles/globals.scss`; do not add local
theme-colored text to these states.

| Variable                   | Default                 | Purpose                    |
| -------------------------- | ----------------------- | -------------------------- |
| `--state-hover-surface`    | `--hover-color`         | Shared feedback background |
| `--state-selected-surface` | `--state-hover-surface` | Selected/open background   |
| `--state-hover-text`       | `--black`               | Shared text and icon color |
| `--state-selected-text`    | `--state-hover-text`    | Selected/open foreground   |
| `--state-selected-shadow`  | `none`                  | Selected/open shadow       |

Nested labels and monochrome icons inherit their control's feedback color.
Mobile controls may paint the background on a pseudo-element to keep a 44px
touch target, but must paint only one background layer. Primary actions, danger
actions, status indicators, content links and vendor logos retain their semantic
colors; define a semantic token override or exclude them from ordinary feedback.

`node scripts/verify-interaction-surfaces.cjs` overrides the shared background
and foreground variables and verifies that controls update together in both
themes at desktop and mobile widths.

## Browser Regression Check

Run `node scripts/verify-form-controls.cjs` against the running development server.
The script uses isolated browser contexts and mocks API requests. It checks settings,
mask editors and chat presets at desktop and mobile widths, including theme changes,
prompt editor widths, checkbox states, keyboard activation and clipped borders.
Screenshots are written to the OS temporary directory.

The default URL is `http://localhost:3001/`; set `UI_TEST_URL` to change it.
Provide an existing Playwright installation through `PLAYWRIGHT_MODULE` if it is
not installed in this workspace. `UI_TEST_BROWSER=msedge` selects installed Edge;
otherwise the script uses Playwright's Chromium.
