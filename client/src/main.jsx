import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './theme.css';
import './styles.css';
import './hud.css';
import './market.css';
import './information.css';
import './backpack.css';
import './character.css';
import './story.css';
import './gacha.css';
import './bot.css';
import './daylight.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
