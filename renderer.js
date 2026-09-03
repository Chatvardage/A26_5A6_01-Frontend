// Le renderer n'utilise jamais require/ipcRenderer directement : tout passe
// par window.electronAPI, exposé de façon contrôlée par preload.js.
//
const notifications = window.notifications;

function updateActiveConversation(conversationId) {
	if (typeof notifications?.setActiveConversation === 'function') {
		notifications.setActiveConversation(conversationId ?? null);
	}
}

function notifyForReceivedMessage(message) {
	if (typeof notifications?.messageReceived === 'function' && message) {
		notifications.messageReceived(message);
	}
}

window.addEventListener('channel:selected', (event) => {
	updateActiveConversation(event.detail?.channel?.id);
});

window.addEventListener('chat:conversation-selected', (event) => {
	updateActiveConversation(event.detail?.conversationId);
});

window.addEventListener('chat:message-received', (event) => {
	notifyForReceivedMessage(event.detail?.message ?? event.detail);
});

// `index.html` est pour l'instant une
// coquille statique (voir le commentaire en tête de src/presentation/pages/
// index.html). Le rendu des salons/messages/présence, et l'envoi de
// messages via #message-form, arriveront avec le ChatGateway (mock puis
// réel), en ajoutant les méthodes correspondantes à `electronAPI` dans
// preload.js plutôt qu'un accès direct à ipcRenderer.
