# Shared Interaction Surfaces

Selection and hover feedback for neutral controls use the tokens in
`app/styles/globals.scss`. These are runtime CSS custom properties, so they
follow light and dark appearance without a separate environment setting.

| Token                                                | Role                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `--hover-color`                                      | Base neutral interaction color: `#efefef` in light appearance and `#2c2c2e` in dark appearance. |
| `--state-hover-surface`                              | Shared hover background; aliases `--hover-color`.                                               |
| `--state-selected-surface`                           | Shared selected background; aliases `--state-hover-surface`.                                    |
| `--state-selected-shadow`                            | Selected controls have no elevation (`none`).                                                   |
| `--control-hover-surface`, `--neutral-hover-surface` | Compatibility aliases of the shared hover background.                                           |

To change hover and selected backgrounds together, change `--hover-color` in
the corresponding appearance. To give selection a distinct neutral color,
override `--state-selected-surface`.

Reuse these components instead of creating another selection control:

- `ChoiceGroup` for segmented choices and visual grids.
- `SettingsSelect` for settings; it delegates to `ChoiceGroup`, `ChoiceSelect`,
  or `ChoiceButton` according to the presentation.
- `ChoiceSelect` for dropdowns and `ChoiceButton` for selectable actions.

Custom layouts such as model rows and account model groups reuse the
`hover-surface` and `selected-surface` mixins from `app/styles/_controls.scss`.
Apply the selected surface once to the interactive row or option. Its wrapper
stays transparent; do not add another white plate, border, or shadow.
Selected labels, check marks, and `aria-pressed`/`aria-checked` states continue
to identify the current choice. Keyboard focus remains a separate visible
outline and must not be replaced by hover styling.

Primary action buttons and switches retain their semantic accent colors.

Run `node scripts/verify-interaction-surfaces.cjs` against the local development
server. As with the other UI verification scripts, `PLAYWRIGHT_MODULE` can point
to an installed Playwright package and `UI_TEST_BROWSER=msedge` can use the
installed Edge browser. `UI_TEST_URL` defaults to `http://localhost:3001/`.

The check uses isolated browser contexts and existing API fixtures. It covers
desktop and mobile in light and dark appearance, verifies that selection uses
the hover color with no nested background or shadow, checks that hover feedback
clears, and changes one CSS variable at runtime to verify the shared dependency.
Screenshots are saved to `UI_TEST_OUTPUT_DIR` or a temporary folder.
