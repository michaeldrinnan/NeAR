import { enableDrag } from './drag';
import type { AudioItem } from '../lib/sources';
import type { StudyOptions } from '../lib/studyFormat';
import { shuffle, stem } from '../lib/order';
import { makeTileImages } from '../lib/tileArt';
import { alertBox, yesNo } from './dialog';

const ANIMATE_KEY = 'near.animate';

/** Animating the tiles is each rater's own preference, kept in this browser. */
export function animatePreference(): boolean {
  try {
    const stored = localStorage.getItem(ANIMATE_KEY);
    if (stored !== null) return stored === '1';
  } catch {
    /* storage unavailable */
  }
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setAnimatePreference(on: boolean) {
  try {
    localStorage.setItem(ANIMATE_KEY, on ? '1' : '0');
  } catch {
    /* a convenience only */
  }
}

export interface RatingSession {
  /** Resolves with the final contents of the rated box, best first, references included, once the rater finishes. */
  done: Promise<string[]>;
  /** Locks the board (no playing, dragging or finishing), e.g. until a session name is entered. */
  setLocked(locked: boolean, message?: string): void;
  /** Ends the session without saving (Back). */
  stop(): void;
}

/**
 * Runs one rating session (the old RaterInterface window) in `root`. `beforeFinish`
 * is asked first when the rater presses Save and finish; returning false carries on rating.
 */
export function runRating(
  root: HTMLElement,
  samples: readonly AudioItem[],
  refs: readonly AudioItem[] | null,
  opts: StudyOptions,
  beforeFinish: () => Promise<boolean> = async () => true,
): RatingSession {
  root.innerHTML = `
    <section class="rating">
      <p class="hint">In the top box you should arrange the rated samples. Click <b>Play</b> to listen,
        then drag them around until you are happy with the order.
        ${refs ? 'The plain blue samples are references; their order cannot be changed.' : ''}</p>
      <div class="board" data-locked="true">
        <p class="best">Put the BEST sample here at top left.</p>
        <div class="box rated" aria-label="Rated samples"></div>
        <p class="hint">In the box below are the unrated samples. You can also use this area to hold samples you are not sure about.</p>
        <div class="box unrated" aria-label="Unrated samples"></div>
        <div class="lockmsg"><span></span></div>
      </div>
      <div class="rating-bar">
        <span class="count" aria-live="polite"></span>
        <button type="button" class="primary finish">Save and finish</button>
      </div>
      <div class="player">
        <span class="now-playing">Use the player to pause, seek or change the volume.</span>
        <audio controls preload="auto"></audio>
      </div>
      <label class="check animate-pref"><input type="checkbox" name="animate">
        <span>Animate the samples as they are moved. Untick if movement on screen is uncomfortable.</span></label>
    </section>`;

  const board = root.querySelector<HTMLElement>('.board')!;
  const ratedBox = root.querySelector<HTMLElement>('.rated')!;
  const unratedBox = root.querySelector<HTMLElement>('.unrated')!;
  const countLabel = root.querySelector<HTMLElement>('.count')!;
  const finishBtn = root.querySelector<HTMLButtonElement>('.finish')!;
  const audio = root.querySelector('audio')!;
  const nowPlaying = root.querySelector<HTMLElement>('.now-playing')!;
  const animateBox = root.querySelector<HTMLInputElement>('input[name="animate"]')!;
  animateBox.checked = animatePreference();
  animateBox.addEventListener('change', () => setAnimatePreference(animateBox.checked));

  const urls = new Map<string, string>();
  const playing = { id: '' };
  let playRequest = 0; // the most recent Play click wins, however long its file takes to load

  async function play(item: AudioItem, label: string) {
    const request = ++playRequest;
    try {
      let url = urls.get(item.id);
      if (!url) {
        const file = await item.getFile();
        url = urls.get(item.id) ?? URL.createObjectURL(file);
        urls.set(item.id, url);
      }
      if (request !== playRequest) return; // a later Play click has taken over
      if (playing.id === item.id) audio.currentTime = 0;
      else audio.src = url;
      playing.id = item.id;
      nowPlaying.textContent = label ? `Playing: ${label}` : 'Playing';
      await audio.play();
    } catch (e) {
      if (request !== playRequest || (e as DOMException).name === 'AbortError') return; // superseded by another Play
      await alertBox(
        `There was a problem trying to play this file:\n  ${item.name}\n\n` +
          `Has it been moved or renamed since starting? Is it a valid audio file?`,
      );
    }
  }

  function makeTile(item: AudioItem, isRef: boolean, index: number): HTMLElement {
    const tile = document.createElement('div');
    tile.className = isRef ? 'tile ref' : 'tile';
    tile.dataset.id = item.id;

    const parts: string[] = [];
    if (opts.numbers && !isRef) parts.push(String(index));
    if (opts.names) parts.push(stem(item.name));
    const text = parts.join('.  ');
    if (text) {
      const label = document.createElement('span');
      label.className = 'tile-label';
      label.textContent = text;
      tile.append(label);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'play';
    btn.textContent = 'Play';
    btn.setAttribute('aria-label', text ? `Play ${text}` : 'Play sample');
    let plays = 0;
    btn.addEventListener('click', () => {
      plays++;
      if (opts.showCount) btn.textContent = String(plays); // references are counted too, as in 2012
      void play(item, text);
    });
    tile.append(btn);

    if (!isRef) {
      const art = makeTileImages();
      tile.style.setProperty('--bg-unrated', `url(${art.unrated})`);
      tile.style.setProperty('--bg-moving', `url(${art.moving})`);
      tile.style.setProperty('--bg-rated', `url(${art.rated})`);
    }
    return tile;
  }

  for (const r of refs ?? []) ratedBox.append(makeTile(r, true, 0));
  const order = opts.random ? shuffle(samples) : samples;
  order.forEach((s, i) => unratedBox.append(makeTile(s, false, i + 1)));

  const total = samples.length;
  const unratedCount = () => unratedBox.querySelectorAll('.tile').length;
  const updateCount = () => {
    countLabel.textContent = `${unratedCount()} of ${total} left to rate`;
  };
  updateCount();

  const disableDrag = enableDrag([ratedBox, unratedBox], updateCount, () => animateBox.checked);

  const warnOnLeave = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener('beforeunload', warnOnLeave);

  let ended = false;
  function end() {
    if (ended) return;
    ended = true;
    playRequest++;
    audio.pause();
    window.removeEventListener('beforeunload', warnOnLeave);
    disableDrag();
    audio.removeAttribute('src');
    urls.forEach((u) => URL.revokeObjectURL(u));
  }

  function setLocked(locked: boolean, message = 'Enter a session name above to start rating') {
    board.dataset.locked = String(locked);
    board.inert = locked;
    board.querySelector('.lockmsg span')!.textContent = message;
    finishBtn.disabled = locked;
    if (locked) {
      playRequest++;
      audio.pause();
    }
  }
  setLocked(true);

  const done = new Promise<string[]>((resolve) => {
    finishBtn.addEventListener('click', async (e) => {
      // Ctrl-click lets the supervisor end early even when all samples must be rated.
      const override = e.ctrlKey || e.metaKey;
      audio.pause();
      const left = unratedCount();
      if (left > 0 && !opts.canLeave && !override) {
        await alertBox("Sorry, you haven't finished yet.\nAll the samples must be rated.");
        return;
      }
      if (!(await beforeFinish())) return;
      const question =
        left > 0
          ? "You haven't rated all the samples - are you SURE you've finished?\n\n"
          : "Are you SURE you've finished rating?\n\n";
      const key = await yesNo(
        question +
          'If you choose YES, the rating session will be finished and no further changes are possible.\n' +
          'Choose NO to go back to where you were.',
      );
      if (key === 'no' || ended) return;

      const result = [...ratedBox.querySelectorAll<HTMLElement>('.tile')].map((t) => t.dataset.id!);
      end();
      resolve(result);
    });
  });

  return { done, setLocked, stop: end };
}
