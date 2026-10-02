# NeAR — Newcastle Audio Ranking test (web)

A web/PWA port of the 2012 Windows app (C# WinForms; source not included). Raters play WAV
samples and drag them into rank order; each session appends one row to `NeAR.csv`.

**Live app: https://michaeldrinnan.github.io/NeAR/**

It is a static site with no server: audio never leaves the device, and after the first
visit it works offline and can be installed as an app.

## User manual

- [PDF](public/manual/NeAR-user-manual.pdf), also served by the app at `manual/NeAR-user-manual.pdf`
  and linked from its About box
- [Word source](docs/NeAR-user-manual.docx)

## Running

```bash
npm install
npm run dev       # development server
npm test          # unit tests
npm run build     # type-check + production build into dist/
npm run preview   # serve dist/ (service worker active)
npm run test:e2e  # end-to-end demo session in Google Chrome (after a build)
```

Deploy by copying `dist/` to any static HTTPS host (GitHub Pages, Netlify, a university
web server…). The build uses relative paths, so it also works from a sub-folder.

## Study packages

A study is a plain `.zip` with a human-editable `study.txt` plus `TestItems/` and optional
`RefItems/` WAV folders; options it sets to yes/no are fixed, blank ones are left to the rater.
Open one with **Open study…**, a link such as `…/NeAR/?study=<address of the zip>`, or the built-in
example; **Save as study…** writes the current set-up as a package. Full specification:
[docs/study-format.md](docs/study-format.md).

## Example files

`public/examples/` holds a demo study: 8 synthetic “ah” vowels with increasing hoarseness to rate
(`TestItems/`), 5 references (`RefItems/`), `study.txt` (with an answer key, shown after the session)
and `ANSWER-KEY.txt`; `NeAR-examples.zip` is the same study as a package. The app's
*Try with example files* button opens it. Regenerate them with `npm run examples`.

## Browsers

| | Chrome / Edge (desktop) | Safari, Firefox, iPad, phones |
|---|---|---|
| Choose samples | Folder picker | Folder or file picker |
| `NeAR.csv` | Read and appended **in the samples folder**, as before | Kept in the browser; *Download NeAR.csv* / *Import NeAR.csv…* buttons |
| Remembers folders | Yes (one click to re-grant access) | No |

### Studies kept in the browser

After selecting samples, use **Choose study…** to create a named study or explicitly
continue an existing one. Start also asks if no study has been selected. Separate studies
can use identical recordings without sharing results. Existing studies are available only
when the selected filenames and audio contents match; changed recordings need a new study.
The comparison reads files locally, one at a time, and does not upload audio.

Use **Recover older results…** to find results saved by either previous browser-storage
format. You can download these without selecting audio. To recover them into a new study,
select the original samples, check the displayed session count and matching sample columns,
and confirm recovery. The original results remain stored as a backup, including if recovery
fails or is cancelled. A column match alone cannot prove which recordings were originally used.

After finishing a session, NeAR keeps the start screen unavailable until results have been
saved, saved elsewhere, or explicitly abandoned through the save-error dialog.

## Results file

Same layout as the 2012 version, so existing `NeAR.csv` files keep working:

```
RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,<sample 1>,<sample 2>,...
```

- Ranks count reference positions (1 = best); unrated samples are 0.
- Columns are in Windows (NTFS) file order, so a header written by the old app still matches.
- With direct folder access, if sample filenames change, the app offers to save the old
  results under another name before starting a new file. Browser studies keep changed
  recordings in a separate study, preserving the earlier study's results.

## Changes from the 2012 version

- **Random order** is now an unbiased shuffle (the old one never deliberately placed a sample last).
- **File order** is sorted explicitly (the old sort had no effect and relied on Windows listing order).
- **DATE / TIME** are written as `2026-10-01` / `15:22:15` instead of the PC's regional format.
- **Rater ID check** compares the first column exactly (the old check gave false warnings, e.g. `1` vs `test1`).
- **SOURCE / REFERENCE** hold the folder name; browsers cannot see full paths.
- Windows Media Player is replaced by the browser's audio player; the *stand-alone WMP* option is gone.
- Reference tiles no longer show a meaningless number `0` when numbering is on.
- Unchanged: ranking rules, reference behaviour, the *Ctrl-click Finished rating* override, the
  "save elsewhere" fallback when `NeAR.csv` can't be written (e.g. open in Excel).

## Layout

- `src/lib/` — pure logic: ordering/shuffle, CSV format, tile colour art (ported from
  `Subject.DrawBackgrounds`), folder access, results storage
- `src/ui/` — start screen and session flow (`setup.ts`), rating screen (`rating.ts`),
  drag and drop (`drag.ts`), dialogs, About box
- `scripts/make-icons.mjs` — regenerates the PWA icons in `public/`
- `scripts/make-examples.mjs` — regenerates the example audio, answer key and zip in `public/examples/`
- `tests/` — unit tests (Vitest); `e2e/` — browser test of a whole session (Playwright)

## Deployment

Every push to `main` runs the unit tests, builds, runs the end-to-end test, and publishes to GitHub Pages
(`.github/workflows/deploy.yml`).

## Licence

MIT — see [LICENSE](LICENSE).
