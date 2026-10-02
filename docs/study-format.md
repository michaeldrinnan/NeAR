# NeAR study format — specification

Status: agreed 2026-10-02 (branch `study-format`). Two questions remain open (see the end).

A **study** is a ready-made rating set-up: the test voices, optional reference voices,
the rating options and the instructions. Anyone who loads it gets exactly the same set-up,
and options the study fixes can't be changed.

## 1. The package

A study is a plain **`.zip`** file containing:

```
study.txt          the definition (required)
TestItems/*.wav    the voices to rate (required, at least one)
RefItems/*.wav     reference voices (optional)
README.txt         anything else is ignored by NeAR
```

- The three items may also sit inside a single top-level folder (as zips made with
  *Send to → Compressed folder* or the Finder's *Compress* often are).
- **References are used if, and only if, `RefItems/` contains WAV files.** There is no
  separate setting for it.
- Only WAV files directly inside `TestItems/` and `RefItems/` count; sub-folders are
  ignored, as with ordinary folders. File order is the usual Windows (NTFS) order.

## 2. The definition file, `study.txt`

Plain text, one `key = value` per line. Lines starting with `#` are comments; text after
` #` on a line is also a comment. Keys are case-insensitive; spaces around `=` don't matter.

```
# NeAR study definition
title         = Dysphonia ranking 2026
version       = 1
instructions  = Rank the voices by overall severity of dysphonia, least severe at top left.
random        = yes
numbers       = no
names         = no
play_count    =            # blank: the rater may choose
leave_unrated = no
animate       =
answer_key    = sample-E, sample-B, sample-G, sample-A, sample-H, sample-D, sample-F, sample-C
show_answers  = no
```

| Key | Value | Meaning |
|---|---|---|
| `title` | text (required) | Shown on the start screen and recorded in the results |
| `version` | text, default `1` | Recorded in the results |
| `instructions` | text | Shown at the top of the rating screen. Repeat the key for more lines |
| `random` | yes / no / blank | Present the samples in random order |
| `numbers` | yes / no / blank | Label samples with numbers |
| `names` | yes / no / blank | Label samples with their file names |
| `play_count` | yes / no / blank | Show play counts on the Play buttons |
| `leave_unrated` | yes / no / blank | Allow the rater to leave samples unrated |
| `animate` | yes / no / blank | Animate drag and drop |
| `answer_key` | file names (without `.wav`), best first, comma-separated | Expected order of the test voices, for teaching |
| `show_answers` | yes / no, default `no` | After finishing, show the rater how their order compares with `answer_key` |

- **yes / no** also accept `true/false`, `1/0`, `on/off`.
- **A blank or missing option is not fixed**: the rater may change it as usual.
- **A yes/no option is fixed**: shown ticked or unticked but greyed out, marked
  *set by this study*. Fixed means fixed — there is no unlock.
- Unknown keys are reported as warnings and otherwise ignored, so a file written for a
  later version still loads. Invalid values (e.g. `random = maybe`) stop loading with a
  message naming the line.
- The answer key is never shown while rating. When `show_answers = yes`, after the
  session NeAR shows the rater's order beside the key and the Spearman rank correlation.

## 3. Loading a study

1. **Built-in studies** — listed on the start screen (e.g. *Example files*).
2. **Open study…** — choose a `.zip` from disk, email attachment, etc.
3. **Web link** — `https://…/NeAR/?study=<address of the zip>`. Best effort: the server
   holding the zip must allow downloads from other web sites (CORS). Links to files on
   the NeAR site itself (e.g. `?study=studies/examples.zip`) always work.

While a study is loaded, the samples and references come from it (the folder buttons are
disabled), its fixed options are locked, and a **Close study** button returns to the
ordinary start screen.

## 4. Saving the current set-up as a study

When no study is loaded and samples are chosen, **Save as study…** asks for a title and
writes a `.zip` (as §1) containing:

- `study.txt` with the title, `version = 1` and every current rating option written as a
  fixed `yes`/`no` (edit the file to blank any that raters should choose);
- copies of all the test voices, and of the reference voices if references are in use.

The result can be emailed, put on a web server, or loaded straight back into NeAR.

## 5. Identity, results and uniqueness

- A study's **identity** is a SHA-256 hash of its definition (normalised: keys, values,
  comments and spacing ignored) together with the name and SHA-256 checksum of every
  test and reference file. **Any change** — audio, options, instructions, title or version —
  makes it a different study, so its results start fresh.
- Results are kept **in this browser, per study identity**, exactly like other browser
  studies (Download / Import / Choose study…). Loading the same study again carries on
  with its results; nothing needs choosing.
- In `NeAR.csv` the column layout is unchanged. The **SOURCE** column records
  `title vVERSION #HASH` (first 8 characters of the identity), e.g.
  `Dysphonia ranking 2026 v1 #3fa9c21b`; REFERENCE is `RefItems` when references are used.

## 6. Built-in examples

The bundled example voices become a study package (`study.txt` with an answer key), served
by the app and listed as a built-in study. The same zip is what *download the example
files* gives you, so it can be emailed or loaded back as it is.

## Open questions

1. **Rater / session ID rules.** Should a study be able to restrict the session ID — e.g. a
   pattern such as `R01`–`R30`, or a pick-list? For now the ID stays free text.
2. **Where results go for a study loaded from a zip in Chrome/Edge.** A zip isn't a folder,
   so for now results are kept in the browser (with Download / Import). Alternative: ask
   once for a results folder and write `NeAR.csv` there, as in 2012.
