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

// Browsers that can install PWAs (Chrome, Edge, Android) announce it with
// beforeinstallprompt; only then is the Install button shown.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const installBtn = document.querySelector<HTMLButtonElement>('#install')!;
let installPrompt: InstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  // A prompt can only be used once; the browser fires a fresh event if it may ask again.
  installPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
  installPrompt = null;
});

document.querySelector('#about')!.addEventListener('click', showAbout);
showSetup(document.querySelector<HTMLElement>('#app')!);
