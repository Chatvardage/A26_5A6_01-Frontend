window.addEventListener('DOMContentLoaded', async () => {
    const ul = document.getElementById('conversation-list');
    const users = await window.electronAPI.obtenirUtilisateurs();
    initUI(ul, users);
});



function initUI(ul, users) {
    users.forEach(user => {
        const li = document.createElement('li');
        li.classList.add('conversation');
        li.innerHTML = `
            <div class="avatar"></div>
            <div class="conversation-info">
                <div class="username">${user.pseudo}</div>
                <div class="last-message">Dernier message...</div>
            </div>
        `;
        ul.appendChild(li);
    })
}