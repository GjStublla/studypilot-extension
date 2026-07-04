import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingStudyPilot } from './FloatingStudyPilot';
import styles from '@/styles/tailwind.css?inline';

const HOST_ID = 'studypilot-extension-root';
const FONT_STYLE_ID = 'studypilot-extension-fonts';

function assetUrl(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    return chrome.runtime.getURL(path);
  }
  return `/${path}`;
}

// @font-face does not resolve inside shadow roots, so the font registration
// has to live in the top-level document. Only the font files leak out of the
// shadow boundary; every other style is scoped.
function injectFonts(): void {
  if (document.getElementById(FONT_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = FONT_STYLE_ID;
  style.textContent = `
@font-face {
  font-family: 'Geist SP';
  src: url('${assetUrl('fonts/geist-latin-400-600.woff2')}') format('woff2');
  font-weight: 400 600;
  font-style: normal;
  font-display: swap;
}`;
  document.head.appendChild(style);
}

export function mountStudyPilot(options: { defaultOpen?: boolean } = {}): void {
  if (document.getElementById(HOST_ID)) return;

  injectFonts();

  const host = document.createElement('div');
  host.id = HOST_ID;

  const shadowRoot = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;

  const mount = document.createElement('div');
  mount.className = 'sp-shadow-mount';

  shadowRoot.append(style, mount);
  document.documentElement.appendChild(host);

  createRoot(mount).render(
    <StrictMode>
      <FloatingStudyPilot defaultOpen={options.defaultOpen} />
    </StrictMode>,
  );
}
