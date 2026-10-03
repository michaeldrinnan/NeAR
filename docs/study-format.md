# NeAR study format — specification

Status: agreed 2026-10-02 (branch `study-format`), revised for the redesigned start screens
(design reference: [start-screen-mockup.html](start-screen-mockup.html)). One question remains
open (see the end).

A **study** is a ready-made rating set-up: the test voices, optional reference voices,
the rating options and the instructions. Anyone who opens it gets exactly the same set-up;
raters can't change any of it.

## 1. The study folder

A study is a folder (or a plain **`.zip`** of one) containing:

```
study.txt     the definition (optional: without it, the defaults below apply)
Test/          the voices to rate (at least two audio files)
Ref/           reference voices (optional)
anything else is ignored by NeAR (and counted on the Create page)
```

- Folder names are matched in any case. The older names **`TestItems/`** and **`RefItems/`**
  are accepted too; if both a new and an old name are present, `Test` and `Ref` win.
- **2012-style folders:** if there is no `Test` folder, audio files loose in the study folder
  are the voices to rate. If there is a `Test` folder, loose audio files are ignored.
- **References are used if, and only if, the `Ref` folder contains audio files.** An empty or
  missing `Ref` means no references.
- Only audio files directly inside `Test` and `Ref` count; sub-folders are ignored. File order
  is the usual Windows (NTFS) order.
- In a zip, everything may also sit inside a single top-level folder (as zips made with
  *Send to → Compressed folder* or the Finder's *Compress* often are).
- A folder that can't be a study is refused with a plain message: no audio files, fewer than
  two voices to rate, or a file this browser can't play (each file is decoded when the study
  is opened, and the message names the first that fails).

### Audio files

| Extension (any case) | Format | Plays in |
|---|---|---|
| `.wav` | WAV (PCM) | every browser |
| `.mp3` | MP3 | every browser |
| `.m4a`, `.aac` | AAC | every browser |
| `.flac` | FLAC | every current browser |
| `.ogg`, `.opus` | Ogg Vorbis / Opus | Chrome, Edge, Firefox; **may not play in Safari or on iPads** |

Formats can be mixed in one study. Other files (e.g. `.wma`) are ignored and counted. The
Create page notes any Ogg or Opus files, and a browser that can't play one refuses the study,
suggesting WAV, MP3 or M4A instead. Results columns use the full file names, extension included.

## 2. The definition file, `study.txt`

**A folder without `study.txt`** opens anywhere a folder can be opened and runs with the
defaults: the title is the folder's name and there are no instructions. In Chrome/Edge, once
the first session's results have been saved into the folder, NeAR also writes a `study.txt`
there with exactly those settings (laid out as the Create page writes it), so the
folder keeps its title and options even if it is renamed later. This needs no extra
permission, and if the folder can't be written to NeAR carries on without it. The study code
is the same before and after, because it is computed from the effective definition, not the
file's text (§5), so the results file name doesn't change. Safari and Firefox never write it.

Plain text, one `key = value` per line. Lines starting with `#` are comments; text after
` #` on a line is also a comment. Keys are case-insensitive; spaces around `=` don't matter.

```
# NeAR study definition
title         = Dysphonia ranking 2026
instructions  = Rank the voices by overall severity of dysphonia, least severe at top left.
random        = on
numbers       = on
names         = off
play_count    = off
leave_unrated = off
```

| Key | Value | Default | Meaning |
|---|---|---|---|
| `title` | text | the folder's name | Shown to raters, recorded in the results, used in file names |
| `instructions` | text | none | Shown at the top of the rating screen. Repeat the key for more lines |
| `random` | on / off | on | Present the samples in a random order for each session |
| `numbers` | on / off | on | Label samples with numbers |
| `names` | on / off | off | Label samples with their file names |
| `play_count` | on / off | off | Show play counts on the Play buttons |
| `leave_unrated` | on / off | off | Allow the rater to leave samples unrated |

- **on / off** also accept `yes/no`, `true/false` and `1/0`.
- **Every option is fixed for the study.** A blank or missing option takes the default, so
  older files (and files with blank options) still load.
- Unknown keys are reported as warnings and otherwise ignored, so a file written for a later
  version still loads. Invalid values (e.g. `random = maybe`) stop loading with a message
  naming the line; the Create page then offers to start from the defaults instead.
- Retired keys are ignored without comment: `version` (studies no longer have a version
  number; see §5) and `animate` (animation is now each rater's own preference, a tick box
  on the rating screen kept in their browser).
- There is deliberately **no answer key**: ranking voices is a subjective judgement, and NeAR
  never marks a rater's order as right or wrong. (`answer_key` and `show_answers` lines in
  study files made by an early test version are ignored with a warning.)

### Titles

Titles are used in file names, so the Create page refuses `\ / : * ? " < > |` and control
characters (with a note under the box), trims spaces and a trailing full stop, and allows
at most 80 characters. A hand-edited `study.txt` with such a title still loads, with a
warning; file names then use the title with each of those characters replaced by `_`.

## 3. Opening a study to rate

*Rate a study* lists, in order:

1. **Example studies** — the built-in studies (§6), with *Try it*.
2. **Carry on with …** — the study used most recently in this browser.
3. **Recent studies** — the last ten studies used in this browser, each with *Open*.
   Studies from a `.zip` are kept in the browser so they can be reopened; folders are
   remembered in Chrome/Edge (one click to grant access again). Folders opened in other
   browsers can't be reopened this way.
4. **A study you were sent** — *Open study file…* (a `.zip`) or *Open study folder…*.

A **web link** — `https://…/NeAR/?study=<address of the zip>` — skips Home and goes
straight to the study. Best effort: the server holding the zip must allow downloads from
other web sites (CORS). Links to files on the NeAR site itself (e.g.
`?study=studies/example-files.zip`) always work.

Every way of opening a study (examples, carry on, recent studies, a file, a folder, a link,
*Try it now*) leads to its **Study info** screen: the title, what it holds, the instructions,
how to rate, where results go, the rater's *Animate* preference, and a required **Session
name**. *Start rating* stays unavailable until a name is entered (a name containing a comma
is refused, with a note). *Back* there returns to wherever the study was opened from.

The **rating screen** itself is one slim bar (*Back*, *Study info*, the player and *Save and
finish*), the study's instructions, and the two boxes (rated above, unrated below, as in 2012),
each with its short prompt (*Put the BEST sample here at top left.*, and the unrated-box note).

- The session name is fixed once rating has started, so the saved row always carries the name
  the session started with. *Study info* shows the same information read-only, and *Return to
  rating* leaves every tile where it was.
- *Back* always asks *Leave this rating session?*, with *Keep rating* as the default (Escape
  keeps rating too) and *Leave without saving* in red; closing or reloading the tab mid-session
  triggers the browser's own warning.
- After saving, *Start another session* returns to Study info with the name filled in, to keep
  or change.

## 4. Creating or editing a study

*Create a study* needs a browser that can give NeAR access to a folder: Chrome or Edge on a
computer, opened directly (not inside another app's preview frame, such as VS Code's Simple
Browser, where the folder picker is refused). This is detected from the browser's abilities,
not its name. Elsewhere (Safari, Firefox, iPad) the Home bar is greyed out with *Creating a
study needs Chrome or Edge on a computer.*, and the page can't be opened. Rating works in
every browser. If the folder picker still fails in a capable browser, the page says
*This window can't open folders…*.

*Create a study* works on one study folder:

1. **Choose study folder…** — shows what was found (voices, references, `study.txt`, results
   files, other files ignored), or why the folder can't be a study. Steps 2 and 3 and the
   buttons stay unavailable until a usable folder is chosen. Without `study.txt`, NeAR starts
   from the defaults with the folder's name as the title.
2. **Options** — each one On or Off.
3. **Title and instructions.**

The page shows the **study code** as it stands and the results file it goes with.

The buttons:

- **Save** — writes `study.txt` into the folder (available when there are unsaved changes, or
  no `study.txt` yet). A title that breaks the rules above can't be saved until corrected.
  Saving a change to a study that already has sessions asks first: *This study has N sessions
  saved. Saving these changes makes a new version with its own results file…*, with *Save as a
  new version* or *Cancel*.
- **Back** leaves without saving. If there are unsaved changes it asks first (*Leave without
  saving?*, with *Keep editing* as the default); what was saved stays saved.
- **Undo all changes** goes back to how the folder was when it was chosen: `study.txt` exactly
  as it was (comments and all), or no `study.txt` if there wasn't one, with the page to match.
- **Try without saving results** opens the study as it stands on the Study info screen (session
  name *Try-out*) and rating screen. Nothing is read or written: no results file, no browser
  results, no Recent studies entry. *Finish try-out* ends it, and Back returns to the page.
- **Save as zip…** downloads the whole study as `NeAR_<title>_<code>.zip` (`study.txt`,
  `Test/`, `Ref/`), to email, put on a web server, or open with *Open study file…*.

**Editing** a study means choosing its folder again: its settings are read from `study.txt`.

## 5. Identity, results and uniqueness

- A study's **identity** is a SHA-256 hash of its definition (title, instructions and every
  option, as values: comments, spacing and key order don't count) together with the name and
  SHA-256 checksum of every test and reference file. Its **code** is the first 8 hex digits.
  **Any change** — audio, options, instructions or title — makes it a different study with a
  new code, so its results start afresh in a new file.
- **Results file:** `NeAR_<title>_<code>.csv`, e.g. `NeAR_Dysphonia ranking 2026_3fa9c21b.csv`.
  - In Chrome/Edge, for a study opened from a folder, it is kept **in the study folder**.
  - Otherwise (a `.zip`, a link, an example, or any study in Safari/Firefox) results are kept
    **in this browser** under the study's identity, and can be downloaded under that name on
    the *Results* page at any time. If a folder picked in Safari/Firefox holds a copy of the
    study's results file, NeAR uses it (asking which to keep if the browser's copy differs).
  - **Keeping browser-kept results safe:**
    - After each saved session, a **Save a copy of your results** step offers *Share…* (to
      Files, iCloud Drive, OneDrive, email, AirDrop…, where the browser can share files, e.g.
      Safari on iPad and Mac) and *Download*. It isn't compulsory, but only *Not now* skips it;
      Escape doesn't. A share or download counts as downloaded for the warnings on *Remove*
      and *Delete*.
    - On the first save NeAR asks the browser to keep its storage permanently
      (`navigator.storage.persist()`, so it isn't cleared to free space); the *Results* page
      says whether the browser has agreed.
    - Safari may clear a website's data after about 7 days without use, but not an installed
      app's. On Safari (iPad and Mac) NeAR therefore explains how to install it, in a
      dismissible banner, in the Save a copy step and on the *Results* page; not when it is
      already installed.
  - If saving fails, *save elsewhere* suggests `NeAR_<title>_<code> (copy).csv`.
  - Names can be read back: they start `NeAR_` and end with `_` and the 8-hex code.
- **A plain `NeAR.csv`** (from the 2012 version) in the study folder, with the same sample
  columns, is offered once: *Carry them on* copies its sessions into the study's new
  results file; `NeAR.csv` itself is never changed. The offer stops once the study's own
  file exists.
- In the results file the column layout is unchanged from 2012:
  `RATER,DATE,TIME,SOURCE,REFERENCE,NREFS,<sample 1>,…`. **SOURCE** records `Title #code`,
  e.g. `Dysphonia ranking 2026 #3fa9c21b`; REFERENCE is `Ref` when references are used.

## 6. Built-in examples

Built-in studies are ordinary study zips in the site's `public/studies/` folder, listed in
`public/studies/index.json`:

```json
{
  "studies": [
    { "title": "Example files: 8 voices with 5 references", "file": "example-files.zip" },
    { "title": "Example: no references, play counts shown", "file": "example-no-references.zip" }
  ]
}
```

- *Rate a study* lists them in this order; the first is the default (also used by
  *Try the example* on *New to NeAR?*).
- **To add one:** put its `.zip` in `public/studies/` and add a line to `index.json`. No code
  changes are needed.
- *Download this example (.zip)* gives exactly the zip that is opened.
- The two bundled examples use the same synthetic voices (generated by
  `scripts/make-examples.mjs`): one with five references and the default options, one with
  no references, no number labels, play counts shown and unrated samples allowed.

## Open question

1. **Rater / session name rules.** Should a study be able to restrict the session name —
   e.g. a pattern such as `R01`–`R30`, or a pick-list? For now it is free text (no commas).
