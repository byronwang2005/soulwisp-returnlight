import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/noto-serif-sc';
import '@fontsource/ma-shan-zheng';
import './styles.css';
import './viewport.css';
import './bronze-theme.css';
createRoot(document.getElementById('root')!).render(<App />);
