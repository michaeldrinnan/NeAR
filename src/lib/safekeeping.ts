/**
 * Keeping browser-kept results safe: persistent storage, installing NeAR on Safari (whose
 * website data may be cleared after about 7 days without use), and sharing a copy.
 */

const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);

/** True when NeAR runs as an installed app rather than in a browser tab. */
export const installed = () =>
  matchMedia('(display-mode: standalone)').matches || !!(navigator as { standalone?: boolean }).standalone;

/** How to install NeAR here, for Safari (which has no install prompt), or null. */
export function installSteps(): string | null {
  if (isIOS) return 'tap Share, then “Add to Home Screen”';
  if (isMacSafari) return 'choose File › Add to Dock';
  return null;
}

/**
 * On Safari, when NeAR isn't installed: why installing keeps results safe, and how. Otherwise null.
 */
export function installAdvice(): string | null {
  const steps = installSteps();
  if (!steps || installed()) return null;
  return (
    `Results are kept in this browser. Safari may clear a website’s data after about 7 days without use, ` +
    `but an installed app keeps its data. To install NeAR, ${steps}.`
  );
}

/** Asks the browser to keep NeAR's storage rather than clear it when space runs low. Never throws. */
export async function requestPersistence(): Promise<boolean | undefined> {
  try {
    if (!navigator.storage?.persist) return undefined;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return undefined;
  }
}

/** Whether the browser has agreed to keep NeAR's storage, or undefined if it can't say. */
export async function storagePersisted(): Promise<boolean | undefined> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : undefined;
  } catch {
    return undefined;
  }
}

/** True if this browser can share a file (to Files, email, AirDrop…), e.g. Safari on iPad and Mac. */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/** Opens the share sheet for a file. Resolves false if the user cancelled or it failed. */
export async function shareFile(file: File, title: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch {
    return false;
  }
}
