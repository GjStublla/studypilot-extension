import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';
import symbolLogoUrl from '../../02_symbol_mark_transparent.png';
import { DASHBOARD_URL } from '@/shared/mockDashboard';
import '@/styles/tailwind.css';

function Popup() {
  const [status, setStatus] = useState('Ready on this tab');

  async function openStudyPilot() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('No active tab found.');

      await chrome.tabs.sendMessage(tab.id, { type: 'STUDYPILOT_OPEN_MODAL' });
      setStatus('Opening StudyPilot');
      window.close();
    } catch {
      setStatus('Refresh this page, then open StudyPilot again');
    }
  }

  async function openDashboard() {
    await chrome.runtime.sendMessage({
      type: 'STUDYPILOT_OPEN_DASHBOARD',
      payload: { url: DASHBOARD_URL },
    });
    window.close();
  }

  return (
    <main className="sp-popup">
      <header className="sp-popup-header">
        <img className="sp-popup-logo" src={symbolLogoUrl} alt="" />
        <div>
          <strong>Study Pilot</strong>
          <span>{status}</span>
        </div>
      </header>

      <section className="sp-popup-hero">
        <div className="sp-popup-mini-ring">
          <img src={symbolLogoUrl} alt="" />
        </div>
        <h1>Ask about this screen.</h1>
        <p>Open the on-page companion for screenshots, live help, and saved explanations.</p>
      </section>

      <div className="sp-popup-actions">
        <button type="button" className="sp-popup-primary" onClick={openStudyPilot}>
          <MessageCircle size={16} />
          <span>Open on this page</span>
        </button>
        <button type="button" className="sp-popup-secondary" onClick={openDashboard}>
          <ExternalLink size={16} />
          <span>Open dashboard</span>
        </button>
      </div>

      <footer className="sp-popup-note">
        <BookOpen size={14} />
        <span>The page only shares what you choose in the StudyPilot panel.</span>
      </footer>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('StudyPilot popup root is missing.');

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
