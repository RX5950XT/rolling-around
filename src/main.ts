/// <reference types="vite/client" />
import { GameManager } from './GameManager';

new GameManager();

// HMR: hard reload to prevent multi-instance physics chaos
if (import.meta.hot) {
    import.meta.hot.accept(() => {
        window.location.reload();
    });
}