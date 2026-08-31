/**
 * Exemples d'utilisation du MockGateway
 * Ce fichier contient plusieurs exemples pratiques de comment utiliser le MockGateway
 */

import { creerMockGateway, type TypeEvenement } from '../gateways/MockGateway.ts';
import type { Message } from '../../entities/Message.ts';

/**
 * Exemple 1 : Flux de connexion simple
 */
export async function exemple1_ConnexionSimple() {
    console.log('=== Exemple 1 : Connexion Simple ===');

    const gateway = creerMockGateway(50);

    // Écouter les événements de connexion
    gateway.ecouterEvenement('connexion', (evt) => {
        console.log(`✓ Utilisateur ${evt.donnees.utilisateurId} connecté`);
    });

    gateway.ecouterEvenement('deconnexion', (evt) => {
        console.log(`✓ Utilisateur ${evt.donnees.utilisateurId} déconnecté`);
    });

    // Connexion
    await gateway.simulerConnexion('u1');
    console.log('État:', gateway.obtenirEtatConnexion().statut);

    // Déconnexion
    await gateway.simulerDeconnexion();
    console.log('État:', gateway.obtenirEtatConnexion().statut);
}

/**
 * Exemple 2 : Gestion de la reconnexion
 */
export async function exemple2_Reconnexion() {
    console.log('\n=== Exemple 2 : Reconnexion ===');

    const gateway = creerMockGateway(50);

    gateway.ecouterEvenement('reconnexion', (evt) => {
        console.log(
            `⚠ Tentative de reconnexion (n°${evt.donnees.reconnexions})`
        );
    });

    // Connexion initiale
    await gateway.simulerConnexion('u1');
    console.log('✓ Connecté');

    // Déconnexion simulée
    await gateway.simulerDeconnexion();
    console.log('✓ Déconnecté');

    // Tentative de reconnexion
    await gateway.simulerReconnexion('u1');
    console.log('État:', gateway.obtenirEtatConnexion().statut);
    console.log('Reconnexions:', gateway.obtenirEtatConnexion().reconnexions);

    // Deuxième tentative
    await gateway.simulerDeconnexion();
    await gateway.simulerReconnexion('u1');
    console.log('Nombre total de reconnexions:',
        gateway.obtenirEtatConnexion().reconnexions);
}

/**
 * Exemple 3 : Gestion des utilisateurs
 */
export async function exemple3_GestionUtilisateurs() {
    console.log('\n=== Exemple 3 : Gestion des Utilisateurs ===');

    const gateway = creerMockGateway(50);

    // Créer un nouvel utilisateur
    const nouvelUtilisateur = await gateway.creerUtilisateur('nouveau_user');
    console.log('✓ Nouvel utilisateur créé:', nouvelUtilisateur);

    // Récupérer un utilisateur
    const alice = await gateway.obtenirUtilisateur('u1');
    console.log('✓ Utilisateur trouvé:', alice);

    // Récupérer tous les utilisateurs
    const tousUtilisateurs = await gateway.obtenirTousLesUtilisateurs();
    console.log(
        '✓ Nombre total d\'utilisateurs:',
        tousUtilisateurs.length
    );
    tousUtilisateurs.forEach((u) => {
        console.log(`  - ${u.pseudo} (${u.id})`);
    });

    // Connecter un utilisateur et vérifier sa présence
    await gateway.simulerConnexion('u1');
    const presence = await gateway.obtenirPresence('u1');
    console.log('✓ Présence de u1:', presence?.statut);
}

/**
 * Exemple 4 : Gestion des salons
 */
export async function exemple4_GestionSalons() {
    console.log('\n=== Exemple 4 : Gestion des Salons ===');

    const gateway = creerMockGateway(50);

    // Créer un nouveau salon
    const nouveauSalon = await gateway.creerSalon(
        'Développement',
        'u1',
        'public'
    );
    console.log('✓ Nouveau salon créé:', nouveauSalon.nom);

    // Récupérer tous les salons
    const salons = await gateway.obtenirTousLesSalons();
    console.log('✓ Nombre de salons:', salons.length);

    // Ajouter des utilisateurs au salon
    await gateway.ajouterUtilisateurAuSalon(nouveauSalon.id, 'u2');
    await gateway.ajouterUtilisateurAuSalon(nouveauSalon.id, 'u3');
    console.log('✓ Utilisateurs ajoutés');

    // Vérifier les membres
    const salonMisAJour = await gateway.obtenirSalon(nouveauSalon.id);
    console.log(
        '✓ Nombre de membres:',
        salonMisAJour?.membreIds.length
    );

    // Retirer un utilisateur
    await gateway.retirerUtilisateurDuSalon(nouveauSalon.id, 'u3');
    const salonFinal = await gateway.obtenirSalon(nouveauSalon.id);
    console.log(
        '✓ Après retrait - Nombre de membres:',
        salonFinal?.membreIds.length
    );
}

/**
 * Exemple 5 : Gestion des messages
 */
export async function exemple5_GestionMessages() {
    console.log('\n=== Exemple 5 : Gestion des Messages ===');

    const gateway = creerMockGateway(50);

    // Écouter les nouveaux messages
    const messagesRecus: unknown[] = [];
    gateway.ecouterEvenement('message-recu', (evt) => {
        const msg = evt.donnees.message as Message;
        messagesRecus.push(msg);
        console.log(`📨 Nouveau message: "${msg.contenu}"`);
    });

    // Envoyer des messages
    const msg1 = await gateway.envoyerMessage('s1', 'u1', 'Bonjour!');
    const msg2 = await gateway.envoyerMessage('s1', 'u2', 'Salut alice!');

    console.log('✓ Messages envoyés:', messagesRecus.length);

    // Modifier un message
    const msgModifie = await gateway.modifierMessage(
        msg1.id,
        'Bonjour tout le monde!'
    );
    console.log('✓ Message modifié:', msgModifie.contenu);

    // Récupérer les messages de la conversation
    const messages = await gateway.obtenirMessagesConversation('s1');
    console.log('✓ Total de messages dans s1:', messages.length);

    // Supprimer un message
    await gateway.supprimerMessage(msg2.id);
    const messagesApres = await gateway.obtenirMessagesConversation('s1');
    console.log('✓ Après suppression:', messagesApres.length);
}

/**
 * Exemple 6 : Simulation de latence réseau
 */
export async function exemple6_Latence() {
    console.log('\n=== Exemple 6 : Simulation de Latence ===');

    // Gateway avec 100ms de latence
    const gateway = creerMockGateway(100);

    console.log('Test avec 100ms de latence:');
    let debut = Date.now();
    await gateway.obtenirTousLesUtilisateurs();
    let duree = Date.now() - debut;
    console.log(`✓ Opération 1: ${duree}ms`);

    // Réduire la latence
    gateway.definirLatence(10);
    console.log('\nTest avec 10ms de latence:');
    debut = Date.now();
    await gateway.obtenirTousLesUtilisateurs();
    duree = Date.now() - debut;
    console.log(`✓ Opération 2: ${duree}ms`);

    // Augmenter la latence
    gateway.definirLatence(300);
    console.log('\nTest avec 300ms de latence:');
    debut = Date.now();
    await gateway.obtenirTousLesUtilisateurs();
    duree = Date.now() - debut;
    console.log(`✓ Opération 3: ${duree}ms`);
}

/**
 * Exemple 7 : Gestion complète des événements
 */
export async function exemple7_Evenements() {
    console.log('\n=== Exemple 7 : Gestion des Événements ===');

    const gateway = creerMockGateway(50);
    const logs: string[] = [];

    // Écouter les différents types d'événements
    const types: TypeEvenement[] = [
        'connexion',
        'deconnexion',
        'message-recu',
        'utilisateur-rejoint-salon',
    ];

    types.forEach((type) => {
        gateway.ecouterEvenement(type, (evt) => {
            const log = `[${type}] ${JSON.stringify(
                evt.donnees,
                null,
                2
            )}`;
            logs.push(log);
            console.log(`📌 ${type}`);
        });
    });

    // Déclencher des événements
    await gateway.simulerConnexion('u1');
    await gateway.ajouterUtilisateurAuSalon('s1', 'u3');
    await gateway.envoyerMessage('s1', 'u1', 'Test');
    await gateway.simulerDeconnexion();

    console.log(`\n✓ Total d'événements capturés: ${logs.length}`);
}

/**
 * Exemple 8 : Scénario complet de chat multi-utilisateur
 */
export async function exemple8_ScenarioComplet() {
    console.log('\n=== Exemple 8 : Scénario Complet Multi-Utilisateur ===');

    const gateway = creerMockGateway(100);

    console.log('📋 Scénario: Deux utilisateurs discutent dans un salon');

    // Créer un salon
    const salon = await gateway.creerSalon('Discussion Tech', 'u1', 'public');
    console.log(`✓ Salon créé: "${salon.nom}"`);

    // Ajouter le deuxième utilisateur
    await gateway.ajouterUtilisateurAuSalon(salon.id, 'u2');
    console.log('✓ u2 a rejoint le salon');

    // Première connexion
    console.log('\n--- Alice (u1) se connecte ---');
    await gateway.simulerConnexion('u1');

    // Envoyer des messages
    console.log('\n--- Échange de messages ---');
    const msg1 = await gateway.envoyerMessage(
        salon.id,
        'u1',
        'Bonjour Bob!'
    );
    console.log(`✓ Alice: "${msg1.contenu}"`);

    const msg2 = await gateway.envoyerMessage(
        salon.id,
        'u2',
        'Salut Alice! Comment ça va?'
    );
    console.log(`✓ Bob: "${msg2.contenu}"`);

    const msg3 = await gateway.envoyerMessage(
        salon.id,
        'u1',
        'Ça va bien, toi?'
    );
    console.log(`✓ Alice: "${msg3.contenu}"`);

    // Afficher tous les messages
    console.log('\n--- Historique du salon ---');
    const messages = await gateway.obtenirMessagesConversation(salon.id);
    messages.forEach((msg, i) => {
        if (msg.type === 'texte') {
            const auteur = msg.auteurId === 'u1' ? 'Alice' : 'Bob';
            console.log(`${i}. ${auteur}: ${msg.contenu}`);
        }
    });

    // Déconnexion
    console.log('\n--- Alice se déconnecte ---');
    await gateway.simulerDeconnexion();
    console.log('✓ Alice est hors ligne');

    const presence = await gateway.obtenirPresence('u1');
    console.log(`État de présence: ${presence?.statut}`);
}

/**
 * Exemple 9 : Conversations privées
 */
export async function exemple9_ConversationsPrivees() {
    console.log('\n=== Exemple 9 : Conversations Privées ===');

    const gateway = creerMockGateway(50);

    // Créer une conversation privée
    const conversation = await gateway.creerConversationPrivee('u1', 'u2');
    console.log(
        `✓ Conversation privée créée entre u1 et u2: ${conversation.id}`
    );

    // Envoyer des messages dans la conversation privée
    const msg1 = await gateway.envoyerMessage(
        conversation.id,
        'u1',
        'Message privé'
    );
    console.log(`✓ Message envoyé dans la DM: "${msg1.contenu}"`);

    // Récupérer les messages
    const messages = await gateway.obtenirMessagesConversation(
        conversation.id
    );
    console.log(`✓ Nombre de messages dans la DM: ${messages.length}`);
}

/**
 * Exemple 10 : Gestion des erreurs
 */
export async function exemple10_GestionErreurs() {
    console.log('\n=== Exemple 10 : Gestion des Erreurs ===');

    const gateway = creerMockGateway(50);
    const erreurs: unknown[] = [];

    // Écouter les erreurs
    gateway.ecouterEvenement('erreur', (evt) => {
        erreurs.push(evt.donnees.message);
        console.log(`❌ Erreur: ${evt.donnees.message}`);
    });

    // Tester différentes erreurs
    console.log('Test 1: Connexion d\'un utilisateur inexistant');
    try {
        await gateway.simulerConnexion('utilisateur-inexistant');
    } catch (err) {
        console.log('✓ Exception levée');
    }

    console.log('\nTest 2: Pseudo invalide');
    try {
        await gateway.creerUtilisateur('ab'); // Trop court
    } catch (err) {
        console.log('✓ Exception levée');
    }

    console.log('\nTest 3: Déconnexion sans connexion');
    try {
        await gateway.simulerDeconnexion();
    } catch (err) {
        console.log('✓ Exception levée');
    }

    console.log(`\n✓ Total d'erreurs capturées: ${erreurs.length}`);
}

/**
 * Fonction principale pour exécuter tous les exemples
 */
export async function executerTousLesExemples() {
    try {
        await exemple1_ConnexionSimple();
        await exemple2_Reconnexion();
        await exemple3_GestionUtilisateurs();
        await exemple4_GestionSalons();
        await exemple5_GestionMessages();
        await exemple6_Latence();
        await exemple7_Evenements();
        await exemple8_ScenarioComplet();
        await exemple9_ConversationsPrivees();
        await exemple10_GestionErreurs();

        console.log('\n✨ Tous les exemples ont été exécutés avec succès!');
    } catch (erreur) {
        console.error('❌ Erreur lors de l\'exécution:', erreur);
    }
}

// Décommenter pour exécuter les exemples
// await executerTousLesExemples();
