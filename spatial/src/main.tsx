import { createRoot } from 'react-dom/client';
import App from './App';
import { initI18n } from './i18n';
import { loadSavedModel } from './components/windows/SettingsWindow';
import './styles.css';

void initI18n().then(() => {
  loadSavedModel();
  createRoot(document.getElementById('root')!).render(<App />);
});
