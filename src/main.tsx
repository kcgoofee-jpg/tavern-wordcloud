import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { loadAllCustomFonts } from './theme/customFonts';

// Custom fonts only persist as bytes in IndexedDB; re-register them as
// FontFaces before paint so a previously-picked custom font renders correctly.
void loadAllCustomFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
