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
```

Deploy by copying `dist/` to any static HTTPS host (GitHub Pages, Netlify, a university
web server…). The build uses relative paths, so it also works from a sub-folder.

## Browsers

| | Chrome / Edge (desktop) | Safari, Firefox, iPad, phones |
|---|---|---|
| Choose samples | Folder picker | Folder or file picker |
| `NeAR.csv` | Read and appended **in the samples folder**, as before | Kept in the browser; *Download NeAR.csv* / *Import NeAR.csv…* buttons |
| Remembers folders | Yes (one click to re-grant access) | No |

## Results file

Same layout as the 2012 version, so existing `NeAR.csv` files keep working:

```
RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,<sample 1>,<sample 2>,...
```

- Ranks count reference positions (1 = best); unrated samples are 0.
- Columns are in Windows (NTFS) file order, so a header written by the old app still matches.
- If the WAV files change, the app offers to save the old results under another name before
  starting a new file — exactly as before.

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

## Deployment

Every push to `main` runs the tests, builds, and publishes to GitHub Pages
(`.github/workflows/deploy.yml`).

## Licence

MIT — see [LICENSE](LICENSE).
