// Harbourline entry point.
import './ui/style.css';
import { startGame } from './game';
startGame(document.getElementById('app')!).catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">Harbourline failed to start: ${String(e?.message ?? e)}</pre>`); });
