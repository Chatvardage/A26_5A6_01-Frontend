// Le renderer n'utilise jamais require/ipcRenderer directement : tout passe
// par window.electronAPI, exposé de façon contrôlée par preload.js.

// Affichage des versions runtime exposées par preload.js
const nodeVer = document.getElementById('node-ver');
const chromeVer = document.getElementById('chrome-ver');
const electronVer = document.getElementById('electron-ver');

if (window.electronAPI) {
    if (nodeVer) nodeVer.textContent = window.electronAPI.nodeVersion();
    if (chromeVer) chromeVer.textContent = window.electronAPI.chromeVersion();
    if (electronVer) electronVer.textContent = window.electronAPI.electronVersion();
}

// Exemple IPC scoped : bouton ping -> Main répond pong
const pingBtn = document.getElementById('ping-btn');
pingBtn?.addEventListener('click', () => {
    window.electronAPI?.ping();
});

window.electronAPI?.onPong((data) => {
    console.log('Reçu du processus Main :', data);
});