import { createRoot } from 'react-dom/client';
import App from './App';
import { initI18n, t } from './i18n';
import { loadSavedModel } from './lib/ai';
import './styles.css';

void initI18n().then(() => {
  loadSavedModel();
  document.title = t('brand.name');
  createRoot(document.getElementById('root')!).render(<App />);
});
