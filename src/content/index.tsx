import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FloatingStudyPilot } from './FloatingStudyPilot';
import styles from '@/styles/tailwind.css?inline';

const HOST_ID = 'studypilot-extension-root';

function mountStudyPilot(): void {
  if (document.getElementById(HOST_ID)) return;

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
      <FloatingStudyPilot />
    </StrictMode>,
  );
}

mountStudyPilot();
