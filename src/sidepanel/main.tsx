import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CopilotProvider } from './copilot/Provider';
import { usePanelStore } from './state/store';

// Dev-only: when running the side panel as a standalone web app (not inside the
// extension — `chrome.runtime.id` is only set on real extension pages), expose
// the store so it can be driven with mock data. Never active in the extension.
const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
if (!inExtension) {
  (window as unknown as { __esStore?: typeof usePanelStore }).__esStore = usePanelStore;
}

const container = document.getElementById('root');
if (!container) throw new Error('No #root element');
createRoot(container).render(
  <React.StrictMode>
    <CopilotProvider>
      <App />
    </CopilotProvider>
  </React.StrictMode>
);
