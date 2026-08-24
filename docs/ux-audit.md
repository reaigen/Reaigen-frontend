# Automated UX audit

The audit signs into the local frontend, captures the dashboard at desktop,
tablet, and mobile sizes, runs Axe accessibility checks, measures common
ergonomic problems, and records browser errors. It does not copy credentials
or save authenticated browser state.

## Create a baseline

```bash
npm run ux:audit -- \
  --base-url http://127.0.0.1:3056 \
  --credentials /absolute/path/to/sec.txt \
  --output .ux-audit/baseline
```

The credential file may contain email and password on separate lines, JSON
with `email` and `password`, or `EMAIL=...` and `PASSWORD=...` pairs. Never add
the credential file to this repository.

## Compare an iteration

```bash
npm run ux:audit -- \
  --base-url http://127.0.0.1:3056 \
  --credentials /absolute/path/to/sec.txt \
  --output .ux-audit/iteration-01 \
  --compare .ux-audit/baseline
```

Open `report.md` in the output directory for the summary. `report.json`
contains full machine-readable findings, and the generated diff images mark
changed pixels in pink. Dynamic listing images and content can create visual
noise, so interpret screenshot percentages together with the ergonomic and
accessibility results.

Use `--headed` when the sign-in flow itself needs to be watched or debugged.

## Full product audit

The full audit discovers real draft and tour identifiers from the signed-in
workspace, then checks the collections, settings tabs, creation form, draft
details and side panels, virtual-tour viewer, saved-camera UI, and tour editor
tools at wide desktop, desktop, tablet, and mobile sizes.

```bash
npm run ux:audit:full -- \
  --base-url http://127.0.0.1:3056 \
  --credentials /absolute/path/to/sec.txt \
  --output .ux-audit/full-baseline
```

The full run is read-only. It navigates, changes tabs, and opens panels, but it
does not submit forms or invoke save, delete, publish, restore, or editing
actions. Scenarios at the same viewport reuse one isolated browser context so
large SOG assets stay in the browser cache during an iteration.

For fast iteration on expensive 3D states, filter by comma-separated scenario
and viewport names:

```bash
npm run ux:audit:full -- \
  --credentials /absolute/path/to/sec.txt \
  --tour-route '/tour/10140?tourId=48' \
  --scenario tour-editor-cameras,tour-camera-editor \
  --viewport desktop,mobile
```

`--tour-route` pins camera/editor checks to a known tour, so changes in dashboard
ordering do not silently move the audit onto an empty camera set.
