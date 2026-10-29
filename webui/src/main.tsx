import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/space-grotesk';
import '@/styles/global.scss';
import App from './App.tsx';

document.title = 'CLI Proxy API';
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

