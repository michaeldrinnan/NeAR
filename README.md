# NeAR — Newcastle Audio Ranking test (web)

A web/PWA port of the 2012 Windows app (C# WinForms; source not included). Raters play audio
samples and drag them into rank order; each session appends one row to the study's results file.

**Live app: https://michaeldrinnan.github.io/NeAR/**

It is a static site with no server: audio never leaves the device, and after the first
visit it works offline and can be installed as an app.

## User manual

- [PDF](public/manual/NeAR-user-manual.pdf), also served by the app at `manual/NeAR-user-manual.pdf`
  and linked from its header and About box
- [Word source](docs/NeAR-user-manual.docx)

## Running

```bash
npm install
npm run dev       # development server
npm test          # unit tests
npm run build     # type-check + production build into dist/
npm run preview   # serve dist/ (service worker active)
npm run test:e2e  # end-to-end tests in Google Chrome (after a build)
```

Deploy by copying `dist/` to any static HTTPS host (GitHub Pages, Netlify, a university
web server…). The build uses relative paths, so it also works from a sub-folder.

## Using it

Home has four bars, each opening its own page with a large **Back** button:

- **New to NeAR?** — a short introduction, *Try the example* and the user manual.
- **Create a study** (Chrome or Edge on a computer) — choose a study folder (`Test/` and `Ref/` sub-folders of audio files: WAV, MP3, M4A/AAC, FLAC, Ogg/Opus), set
  the options On or Off, give it a title and instructions, then *Save* (writes `study.txt`; Back
  leaves without saving; *Undo all changes* goes back to how the folder was), *Try without saving
  results* or *Save as zip…*. Editing a study means choosing its folder again.
- **Rate a study** — example studies, *Carry on* with the last study, recent studies, and
  *A study you were sent* (a `.zip` or a folder). Opening a study shows its Study info
  screen, where a session name must be entered before rating; the rating screen then holds just
  one bar (Back, Study info, player, Save and finish), the instructions and the two boxes.
  *Back* asks before leaving a session.
- **Results** — results kept in this browser: download, import, delete, and recovery of
  results saved by earlier web versions.

A link such as `…/NeAR/?study=<address of a study zip>` skips Home and opens that study.

Studies, results files and their names are specified in [docs/study-format.md](docs/study-format.md);
the agreed design is [docs/start-screen-mockup.html](docs/start-screen-mockup.html).

## Example files

Built-in example studies live in `public/studies/` and are listed in `public/studies/index.json`;
*Rate a study* offers them in a list, with a download link for each. To add one, drop its zip in
that folder and add a line to `index.json`. The two bundled examples use 8 synthetic “ah” vowels
with varying hoarseness (one with 5 references, one without). `public/examples/` holds the same
study unpacked, for the tests. Regenerate them with `npm run examples`.

## Browsers

| | Chrome / Edge (desktop) | Safari, Firefox, iPad, phones |
|---|---|---|
| Create a study | Yes | No: the Home bar says it needs Chrome or Edge on a computer |
| Open a study folder to rate | Folder picker | Folder chooser (read only) |
| Results of a folder study | `NeAR_<title>_<code>.csv` **in the study folder** | Kept in the browser; download from Results |
| Results of a study `.zip` | Kept in the browser; download from Results | Kept in the browser; download from Results |
| Recent studies | Zips and folders (one click to re-grant access) | Zips only |

Results kept in the browser are protected three ways: after each session a *Save a copy* step
offers Share… (iPad and Mac Safari) or Download; NeAR asks the browser to keep its storage
permanently; and on Safari it explains that installing NeAR stops Safari clearing its data after
about 7 days without use.

Only one NeAR session runs at a time across the windows and tabs of a browser; saves to
browser-kept results commit only if nothing changed them meanwhile, so nothing is ever
merged or overwritten.

## Results file

Same layout as the 2012 version:

```
RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,<sample 1>,<sample 2>,...
```

- The file is named `NeAR_<title>_<code>.csv` after the study, and SOURCE holds `Title #code`,
  so every change to a study (audio, options, title or instructions) starts a new file.
- Ranks count reference positions (1 = best); unrated samples are 0.
- Columns are in Windows (NTFS) file order, so a header written by the old app still matches.
- A 2012 `NeAR.csv` in a study folder with the same samples is offered once, to carry its
  sessions on into the new file; the original is never changed.

## Changes from the 2012 version

- **Studies** replace the start-screen options: a study fixes its files, options and
  instructions, and raters see none of them.
- **Results** go to `NeAR_<title>_<code>.csv` instead of `NeAR.csv` (see above).
- **Random order** is now an unbiased shuffle (the old one never deliberately placed a sample last).
- **File order** is sorted explicitly (the old sort had no effect and relied on Windows listing order).
- **DATE / TIME** are written as `2026-10-01` / `15:22:15` instead of the PC's regional format.
- **Rater ID check** compares the first column exactly (the old check gave false warnings, e.g. `1` vs `test1`).
- Windows Media Player is replaced by the browser's audio player; the *stand-alone WMP* option is gone.
- Reference tiles no longer show a meaningless number `0` when numbering is on.
- Unchanged: ranking rules, reference behaviour, the *Ctrl-click* override on *Save and finish*
  (formerly *Finished rating*), the "save elsewhere" fallback when the results file can't be
  written (e.g. open in Excel).

## Layout

- `src/lib/` — pure logic: ordering/shuffle, CSV format, tile colour art (ported from
  `Subject.DrawBackgrounds`), study format, folder and zip reading, results storage, recent studies
- `src/ui/` — the pages (`app.ts`: Home, New to NeAR, Rate a study; `create.ts`; `results.ts`),
  the rating session (`session.ts`) and screen (`rating.ts`), drag and drop (`drag.ts`),
  dialogs, About box
- `scripts/make-icons.mjs` — regenerates the PWA icons in `public/`
- `scripts/make-examples.mjs` — regenerates the example voices (`public/examples/`) and the example study zips (`public/studies/`)
- `tests/` — unit tests (Vitest); `e2e/` — browser tests of whole sessions (Playwright)

## Deployment

Every push to `main` runs the unit tests, builds, runs the end-to-end tests, and publishes to GitHub Pages
(`.github/workflows/deploy.yml`).

## Licence

MIT — see [LICENSE](LICENSE).
