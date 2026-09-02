// Le renderer n'utilise jamais require/ipcRenderer directement : tout passe
// par window.electronAPI, exposé de façon contrôlée par preload.js.
//
// Rien n'est encore branché ici : `index.html` est pour l'instant une
// coquille statique (voir le commentaire en tête de src/presentation/pages/
// index.html). Le rendu des salons/messages/présence, et l'envoi de
// messages via #message-form, arriveront avec le ChatGateway (mock puis
// réel), en ajoutant les méthodes correspondantes à `electronAPI` dans
// preload.js plutôt qu'un accès direct à ipcRenderer.

window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('message-prive-btn');

    console.log('btn =', btn);

    btn?.addEventListener('click', () => {
        console.log('CLICK');

        window.electronAPI.navigate('message-prive.html');
    });
});