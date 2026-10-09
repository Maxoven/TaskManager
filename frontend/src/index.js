import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { applyInterfaceSize, getInterfaceSize } from './utils/interfaceSize';

// Размер интерфейса применяем до первой отрисовки — без «прыжка» вёрстки
applyInterfaceSize(getInterfaceSize());

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
