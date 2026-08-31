// Display runtime versions exposed by preload.js
const nodeVer = document.getElementById('node-ver');
const chromeVer = document.getElementById('chrome-ver');
const electronVer = document.getElementById('electron-ver');

if (window.electronAPI) {
  if (nodeVer) nodeVer.textContent = window.electronAPI.nodeVersion();
  if (chromeVer) chromeVer.textContent = window.electronAPI.chromeVersion();
  if (electronVer)
    electronVer.textContent = window.electronAPI.electronVersion();
}

// IPC send example
const pingBtn = document.getElementById('ping-btn');
if (pingBtn) {
  pingBtn.addEventListener('click', () => {
    window.electronAPI?.send('ping', 'Ping from renderer.js');
  });
}

// IPC receive example
window.electronAPI?.on('pong', (response) => {
  console.log('Received from main process:', response);
});
