import ReactDOM from 'react-dom/client';
import { App } from './App';
import { GameEngine } from './game/engine';
import './style.css';

const engine = new GameEngine();
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App engine={engine}/>);

if (import.meta.hot) import.meta.hot.dispose(() => { root.unmount(); engine.dispose(); });
