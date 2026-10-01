import { enableDrag } from './drag';
import type { AudioItem } from '../lib/sources';
import { shuffle, stem } from '../lib/order';
import { makeTileImages } from '../lib/tileArt';
import { alertBox, yesNo } from './dialog';

export interface RatingOptions {
  random: boolean;
  numbers: boolean;
  names: boolean;
  showCount: boolean;
  canLeave: boolean;
}

/**
 * Runs one rating session (the old RaterInterface window). Resolves with the
 * final contents of the rated box, best first, references included.
 */
export function runRating(
  root: HTMLElement,
  samples: readonly AudioItem[],
  refs: readonly AudioItem[] | null,
  opts: RatingOptions,
): Promise<string[]> {
  root.innerHTML = `
    <section class="rating">
      <p class="hint">In the top box you should arrange the rated samples. Click <b>Play</b> to listen,
        then drag them around until you are happy with the order.
        ${refs ? 'The plain blue samples are references; their order cannot be changed.' : ''}</p>
      <p class="best">Put the BEST sample here at top left.</p>
      <div class="box rated" aria-label="Rated samples"></div>
      <p class="hint">In the box below are the unrated samples. You can also use this area to hold samples you are not sure about.</p>
      <div class="box unrated" aria-label="Unrated samples"></div>
      <div class="rating-bar">
        <span class="count" aria-live="polite"></span>
        <button type="button" class="finish">Finished rating</button>
      </div>
      <div class="player">
        <span class="now-playing">Use the player to pause, seek or change the volume.</span>
        <audio controls preload="auto"></audio>
      </div>
    </section>`;

  const ratedBox = root.querySelector<HTMLElement>('.rated')!;
  const unratedBox = root.querySelector<HTMLElement>('.unrated')!;
  const countLabel = root.querySelector<HTMLElement>('.count')!;
  const finishBtn = root.querySelector<HTMLButtonElement>('.finish')!;
  const audio = root.querySelector('audio')!;
  const nowPlaying = root.querySelector<HTMLElement>('.now-playing')!;

  const urls = new Map<string, string>();
  const playing = { id: '' };

  async function play(item: AudioItem, label: string) {
    try {
      let url = urls.get(item.id);
      if (!url) {
        url = URL.createObjectURL(await item.getFile());
        urls.set(item.id, url);
      }
      if (playing.id === item.id) audio.currentTime = 0;
      else audio.src = url;
      playing.id = item.id;
      nowPlaying.textContent = label ? `Playing: ${label}` : 'Playing';
      await audio.play();
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return; // superseded by another Play
      await alertBox(
        `There was a problem trying to play this file:\n  ${item.name}\n\n` +
          `Has it been moved or renamed since starting? Is it a valid WAV file?`,
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
      if (opts.showCount && !isRef) btn.textContent = String(plays);
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

  const disableDrag = enableDrag([ratedBox, unratedBox], updateCount);

  const warnOnLeave = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener('beforeunload', warnOnLeave);

  return new Promise<string[]>((resolve) => {
    finishBtn.addEventListener('click', async (e) => {
      // Ctrl-click lets the supervisor end early even when all samples must be rated.
      const override = e.ctrlKey || e.metaKey;
      audio.pause();
      const left = unratedCount();
      if (left > 0 && !opts.canLeave && !override) {
        await alertBox("Sorry, you haven't finished yet.\nAll the samples must be rated.");
        return;
      }
      const question =
        left > 0
          ? "You haven't rated all the samples - are you SURE you've finished?\n\n"
          : "Are you SURE you've finished rating?\n\n";
      const key = await yesNo(
        question +
          'If you choose YES, the rating session will be finished and no further changes are possible.\n' +
          'Choose NO to go back to where you were.',
      );
      if (key === 'no') return;

      const result = [...ratedBox.querySelectorAll<HTMLElement>('.tile')].map((t) => t.dataset.id!);
      window.removeEventListener('beforeunload', warnOnLeave);
      disableDrag();
      audio.removeAttribute('src');
      urls.forEach((u) => URL.revokeObjectURL(u));
      resolve(result);
    });
  });
}
