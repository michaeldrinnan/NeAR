import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import { showSetup } from './ui/setup';
import { showAbout } from './ui/about';

declare global {
  const __APP_VERSION__: string;
  const __BUILD_DATE__: string;
}

// Never reload by itself: a new version waits until the user chooses to update,
// so a rating session in progress is never interrupted.
const updateSW = registerSW({
  onNeedRefresh() {
    const btn = document.querySelector<HTMLButtonElement>('#update')!;
    btn.hidden = false;
    btn.onclick = () => void updateSW(true);
  },
});

document.querySelector('#about')!.addEventListener('click', showAbout);
showSetup(document.querySelector<HTMLElement>('#app')!);
