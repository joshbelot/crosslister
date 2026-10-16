# Job traces

Every job (publish, update, deactivate, connect, status check, import) writes a folder in `data/traces/<jobId>/` that explains, after the fact, exactly what happened. Traces stay on this Mac. Settings → General → Diagnostics turns them off or changes how long they are kept (30 days by default).

## What a trace folder contains

| File | What it holds |
|---|---|
| `meta.json` | Job id, type, marketplace, listing, start/finish time, final state, error, the fields left for the user, the job input, and (for publish/update) the listing as the app saw it, including the mapping it computed. |
| `trace.jsonl` | One JSON event per line, in order. Kinds: `step.start` / `step.end` (every step and how it ended), `locator` (every selector tried: each candidate with how many elements matched and how many were visible, and which one was used), `options` (the option list the page offered, what the app wanted, and the best match), `fill` (value length, what the page read back, ok / mismatch), `click`, `upload`, `upload.timeout`, `typeahead.custom`, `nav` (navigations), `console` (page errors and warnings), `request.failed`, `response.error` (HTTP 400+), `dialog`, `error`, `needs_user`, `user.answer`, `snapshot`, `job.end`. |
| `snapshots/NNN-<label>.png` | Full-page screenshot at the end of every step (and when the job waits for you). |
| `snapshots/NNN-<label>.html` | The page HTML at that moment. |
| `snapshots/NNN-<label>.aria.yml` | The page's accessibility tree. |
| `snapshots/NNN-<label>.controls.json` | A list of every form control on the page with every label-like text that could be used to find it (`labels`, `ariaLabel`, `placeholder`, `testId`, `near`, `css`, current `value`). |
| `snapshots/user-filled-*.controls.json` | While the job waits for you, the app refreshes this every few seconds, so it shows what **you** filled in by hand. |
| `report.md` | A readable summary built from the files above. Paste it to Claude for analysis. |

Login pages get a screenshot only: no HTML, accessibility tree or control list is saved there.

## How to get one

- In **Activity**, open a finished job and click **Download trace** (a ZIP) or **Show trace folder**.
- Or in a terminal:

```bash
npm run trace:report -- latest poshmark
```

`npm run trace:report -- --list` lists the newest traces; `npm run trace:report -- <jobId>` prints one.

## How to fix a field from a trace

1. Open `report.md` and find the step that did not finish `done`.
2. Read the `locator` lines for that step. Every candidate is listed with its match counts.
3. Open the step's `.controls.json` (or `user-filled-*.controls.json` to see what you picked by hand) and find the real control: its `labels`, `ariaLabel`, `placeholder`, `testId`, `near` and `css`.
4. Add a candidate built from those at the **top** of the spec in `src/server/marketplaces/<mp>/selectors.ts`.
5. For option lists, compare `wanted` with `seen` in the `options` lines and add synonyms in `<mp>/mapping.ts`.
6. Mirror the real markup in `fixtures/marketplace-pages/<mp>/sell.html` and run `npm run test:browser`.
