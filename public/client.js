// public/client.js
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsHost = window.location.hostname;
const wsPort = window.location.port || (wsProtocol === 'wss:' ? 443 : 80);
const socket = new WebSocket(`${wsProtocol}//${wsHost}:${wsPort}`);

let myClientId = null;
let myPlayerName = null;
let currentRoomPassword = null; // Memorizza la password della stanza a cui si è connessi
let iAmHost = false;

// --- Elementi DOM (aggiungi quelli per la Room Password) ---
const roomPasswordScreen = document.getElementById('roomPasswordScreen');
const roomPasswordInput = document.getElementById('roomPasswordInput');
const playerNameInput = document.getElementById('playerNameInput'); // Nuovo per il nome giocatore
const joinRoomButton = document.getElementById('joinRoomButton');
const roomPasswordError = document.getElementById('roomPasswordError');

const setupScreen = document.getElementById('setupScreen');
const numPlayersInput = document.getElementById('numPlayers');
const secretWordInput = document.getElementById('secretWord');
const hostRoomPasswordInput = document.getElementById('hostRoomPasswordInput'); // Password da impostare per l'host
const startGameButton = document.getElementById('startGameButton');
const setupError = document.getElementById('setupError');

const lobbyScreen = document.getElementById('lobbyScreen'); // Nuova schermata Lobby
const lobbyMessage = document.getElementById('lobbyMessage');
const lobbyPlayerList = document.getElementById('lobbyPlayerList');
const hostStartGameLobbyButton = document.getElementById('hostStartGameLobbyButton');


const roleRevealScreen = document.getElementById('roleRevealScreen');
const roleTextEl = document.getElementById('roleText');
const secretWordTextRoleEl = document.getElementById('secretWordTextRole');
const seenRoleButton = document.getElementById('seenRoleButton');

const clueScreen = document.getElementById('clueScreen');
const clueTurnTitleEl = document.getElementById('clueTurnTitle');
const clueInputEl = document.getElementById('clueInput');
const submitClueButton = document.getElementById('submitClueButton');

const discussionScreen = document.getElementById('discussionScreen');
const cluesListEl = document.getElementById('cluesList');
const startVotingButton = document.getElementById('startVotingButton'); // Ora solo per l'host

const votingScreen = document.getElementById('votingScreen');
const votingTitleEl = document.getElementById('votingTitle');
const voteButtonsContainerEl = document.getElementById('voteButtonsContainer');

const impostorGuessScreen = document.getElementById('impostorGuessScreen');
const caughtImpostorNameEl = document.getElementById('caughtImpostorName');
const impostorGuessInputEl = document.getElementById('impostorGuessInput');
const checkImpostorGuessButton = document.getElementById('checkImpostorGuessButton');

const resultScreen = document.getElementById('resultScreen');
const resultScreenMessageEl = document.getElementById('resultScreenMessage');
const finalSecretWordEl = document.getElementById('finalSecretWord');
const finalImpostorNameEl = document.getElementById('finalImpostorName');
const resetGameButton = document.getElementById('resetGameButton'); // Ora solo per l'host

const gameLogEl = document.getElementById('gameLog'); // Esistente
const playerListDiv = document.getElementById('playerList'); // Esistente
const playerNameDisplay = document.getElementById('playerNameDisplay'); // Esistente
const waitingMessageScreen = document.getElementById('waitingMessageScreen'); // Esistente
const waitingMessage = document.getElementById('waitingMessage'); // Esistente


function showScreen(screenId) {
    const screens = [
        roomPasswordScreen, setupScreen, lobbyScreen, roleRevealScreen,
        clueScreen, discussionScreen, votingScreen, impostorGuessScreen,
        resultScreen, waitingMessageScreen
    ];
    screens.forEach(s => { if (s) s.style.display = 'none'; });
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) screenToShow.style.display = 'block';
}

function addToGameLog(message) {
    if (!gameLogEl) return;
    const p = document.createElement('p');
    p.textContent = message;
    gameLogEl.appendChild(p);
    gameLogEl.scrollTop = gameLogEl.scrollHeight;
}

socket.onopen = () => {
    addToGameLog('Connesso al server WebSocket.');
    // Il server invierà 'requestRoomPassword'
};

socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('Server:', message);
    addToGameLog(`Server: ${message.type}`);

    if (message.type === 'error') {
        addToGameLog(`ERRORE: ${message.payload}`);
        if (document.getElementById(message.type + 'Error')) { // es. roomPasswordError, setupError
            document.getElementById(message.type + 'Error').textContent = message.payload;
            document.getElementById(message.type + 'Error').style.display = 'block';
        } else {
            alert(`Errore dal server: ${message.payload}`);
        }
    } else if (message.type === 'requestRoomPassword') {
        showScreen('roomPasswordScreen');
        roomPasswordInput.focus();
    } else if (message.type === 'joinSuccess') {
        myClientId = message.payload.clientId;
        myPlayerName = message.payload.playerName;
        currentRoomPassword = message.payload.roomPassword;
        playerNameDisplay.textContent = `Tu: ${myPlayerName} (Stanza: ${currentRoomPassword})`;
        addToGameLog(`Unito alla stanza ${currentRoomPassword} come ${myPlayerName}`);
        // Ora attendi gameStateUpdate per sapere dove andare (probabilmente lobby o partita in corso)
        // Non chiamare showScreen() qui direttamente, lascia che gameStateUpdate lo faccia.
    } else if (message.type === 'setupSuccessHost') {
        // L'host ha creato la stanza, ora deve "unirsi" ad essa con la password che ha impostato.
        addToGameLog(`Setup riuscito! Stanza creata con PW: ${message.payload.roomPassword}. Ora unisciti.`);
        currentRoomPassword = message.payload.roomPassword; // Salva per auto-inserimento o riferimento
        // Potresti pre-compilare roomPasswordInput e playerNameInput
        // e poi inviare automaticamente joinRoom o chiedere conferma all'host.
        // Per semplicità, l'host dovrà comunque passare per la schermata 'roomPasswordScreen'
        // ma potrebbe essere automatizzato.
        roomPasswordInput.value = currentRoomPassword; // Pre-compila per l'host
        showScreen('roomPasswordScreen'); // Riporta l'host alla schermata di join per la sua stessa stanza
        playerNameInput.focus(); // L'host deve inserire il suo nome ora
    } else if (message.type === 'gameStateUpdate') {
        updateUI(message.payload);
    } else if (message.type === 'yourRole') {
        roleTextEl.textContent = message.payload.role === 'impostore' ? '🤫 Sei L\'IMPOSTORE! 🤫' : '✅ Sei un Cittadino Onesto. ✅';
        secretWordTextRoleEl.textContent = `Parola: ${message.payload.secretWord}`;
        showScreen('roleRevealScreen');
    } else if (message.type === 'voteResult') {
        // Questo messaggio gestisce la transizione da voto a guess dell'impostore o a risultato finale
        resultScreenMessageEl.textContent = message.payload.message;
        finalSecretWordEl.textContent = "Nascosta"; // Ancora nascosta se c'è guess
        finalImpostorNameEl.textContent = message.payload.impostorName;

        if (message.payload.nextPhase === 'impostorGuess' && message.payload.accusedIsImpostor) {
            if (myClientId === message.payload.impostorClientId) { // Sono io l'impostore!
                caughtImpostorNameEl.textContent = myPlayerName;
                impostorGuessInputEl.value = '';
                // Salva la fase corrente comunicata dal server per inviarla con il guess
                impostorGuessInputEl.dataset.currentPhaseFromServer = 'impostorGuess';
                showScreen('impostorGuessScreen');
            } else {
                showScreen('resultScreen'); // Gli altri vedono il messaggio "impostore scoperto, attende guess"
            }
        } else { // Direttamente ai risultati finali
            finalSecretWordEl.textContent = message.payload.secretWord; // Ora rivela la parola
            showScreen('resultScreen');
        }
    } else if (message.type === 'finalResult') {
        resultScreenMessageEl.textContent = message.payload.message;
        finalSecretWordEl.textContent = message.payload.secretWord;
        finalImpostorNameEl.textContent = message.payload.impostorName;
        showScreen('resultScreen');
    } else if (message.type === 'gameResetByServer') {
        addToGameLog("Il gioco è stato resettato dall'host o dal server.");
        alert("La partita è terminata o è stata resettata. Sarai reindirizzato alla schermata di join.");
        myClientId = null;
        myPlayerName = null;
        currentRoomPassword = null;
        iAmHost = false;
        playerNameDisplay.textContent = "";
        // Pulisci input se necessario
        roomPasswordInput.value = '';
        playerNameInput.value = '';
        showScreen('roomPasswordScreen'); // Torna alla schermata di inserimento password stanza
    }
};

socket.onclose = () => {
    addToGameLog('Disconnesso dal server WebSocket. Ricarica per riconnetterti.');
    alert('Connessione persa. Ricarica la pagina.');
    showScreen('roomPasswordScreen'); // O una schermata di errore di connessione
};
socket.onerror = (error) => {
    addToGameLog(`Errore WebSocket: ${error.message}. Prova a ricaricare.`);
};

// --- Funzioni per aggiornare la UI ---
function updateUI(gs) { // gs = gameState dal server
    currentRoomPassword = gs.roomPassword; // Assicurati che sia aggiornato
    if (myClientId) { // Solo se sono un giocatore valido
        iAmHost = gs.players.some(p => p.clientId === myClientId && p.isHost);
        playerNameDisplay.textContent = `Tu: ${myPlayerName} (${iAmHost ? "Host" : "Giocatore"}) - Stanza: ${gs.roomPassword || "N/D"}`;
    }


    // Aggiorna la lista dei giocatori (globale e in lobby)
    if (playerListDiv) {
        playerListDiv.innerHTML = '<h3>Giocatori Attuali:</h3>' + gs.players.map(p =>
            `<div class="${p.clientId === myClientId ? 'me' : ''} ${p.isHost ? 'host' : ''}">
                ${p.name} ${p.isHost ? "(Host)" : ""}
                ${myClientId === p.clientId ? " (Tu)" : ""}
                ${gs.currentPhase === 'clues' ? (p.hasSubmittedClue ? "✓ Indizio" : "… Indizio") : ""}
                ${gs.currentPhase === 'voting' ? (p.hasVoted ? "✓ Votato" : "… Voto") : ""}
            </div>`
        ).join('');
    }
    if (lobbyPlayerList) {
         lobbyPlayerList.innerHTML = '<h3>Giocatori nella Lobby:</h3>' + gs.players.map(p =>
            `<div class="${p.clientId === myClientId ? 'me' : ''} ${p.isHost ? 'host' : ''}">
                ${p.name} ${p.isHost ? "(Host)" : ""}
                ${myClientId === p.clientId ? " (Tu)" : ""}
            </div>`
        ).join('');
    }


    switch (gs.currentPhase) {
        case 'waitingForHost':
            // Se sono già connesso con una password, ma la fase è questa, qualcosa è andato storto (es. reset)
            // Altrimenti, il client non dovrebbe vedere questa fase, sarà in 'roomPasswordScreen'
            if (currentRoomPassword) { // Ero in una stanza che non esiste più
                showScreen('waitingMessageScreen');
                waitingMessage.innerHTML = "<p>L'host deve creare una nuova partita. Attendi o prova a unirti a un'altra stanza.</p>";
            } else {
                showScreen('roomPasswordScreen'); // Default se non si è ancora uniti
            }
            break;
        case 'lobby':
            showScreen('lobbyScreen');
            lobbyMessage.textContent = `In attesa di giocatori... (${gs.players.length}/${gs.expectedPlayers}) per la stanza "${gs.roomPassword}". Parola Segreta: ${gs.secretWordLength} lettere. Host: ${gs.hostName || 'N/D'}`;
            hostStartGameLobbyButton.style.display = iAmHost ? 'inline-block' : 'none';
            hostStartGameLobbyButton.disabled = !(gs.players.length >= 3 && gs.players.length === gs.expectedPlayers);
            break;
        case 'roleReveal':
            // La gestione di 'yourRole' mostra già la schermata.
            // Qui potremmo mostrare un messaggio di attesa se non ho ancora visto il mio ruolo.
            const myPlayerForRole = gs.players.find(p => p.clientId === myClientId);
            if (myPlayerForRole && !myPlayerForRole.hasSeenRole) {
                // 'yourRole' dovrebbe aver già mostrato lo schermo
            } else if (myPlayerForRole && myPlayerForRole.hasSeenRole) {
                showScreen('waitingMessageScreen');
                waitingMessage.innerHTML = "<p>Hai visto il tuo ruolo. In attesa degli altri giocatori...</p>";
            }
            break;
        case 'clues':
            showScreen('clueScreen');
            const myPlayerForClue = gs.players.find(p => p.clientId === myClientId);
            if (myPlayerForClue && !myPlayerForClue.hasSubmittedClue) {
                clueTurnTitleEl.textContent = `Sei ${myPlayerName}. Dai il tuo indizio:`;
                submitClueButton.disabled = false;
                clueInputEl.disabled = false;
                clueInputEl.focus();
            } else {
                clueTurnTitleEl.textContent = `Indizio inviato o in attesa degli altri...`;
                submitClueButton.disabled = true;
                clueInputEl.disabled = true;
            }
            cluesListEl.innerHTML = '<h3>Indizi Dati (finora):</h3>' + gs.cluesSubmitted.map(c => `<li>${c.playerName}: ${c.clue}</li>`).join('');
            break;
        case 'discussion':
            showScreen('discussionScreen');
            cluesListEl.innerHTML = '<h3>Indizi Finali (Discutete!):</h3>';
            // Mischia gli indizi per la discussione se non già mischiati dal server
            let displayClues = [...gs.cluesSubmitted]; //.sort(() => Math.random() - 0.5);
            displayClues.forEach(clueData => {
                const li = document.createElement('li');
                li.classList.add('clue-item');
                // Decidi se mostrare chi ha dato l'indizio durante la discussione.
                // Il server li invia con playerName, quindi puoi scegliere.
                // Per ora, li mostriamo per aiutare la discussione.
                li.textContent = `${clueData.playerName}: ${clueData.clue}`;
                cluesListEl.appendChild(li);
            });
            startVotingButton.style.display = iAmHost ? 'inline-block' : 'none'; // Solo l'host avvia il voto
            break;
        case 'voting':
            showScreen('votingScreen');
            const myPlayerForVote = gs.players.find(p => p.clientId === myClientId);
            if (myPlayerForVote && !myPlayerForVote.hasVoted) {
                votingTitleEl.textContent = `Sei ${myPlayerName}. Vota l'Impostore:`;
                voteButtonsContainerEl.innerHTML = '';
                gs.players.forEach(playerToVote => {
                    if (playerToVote.clientId !== myClientId) {
                        const button = document.createElement('button');
                        button.textContent = `Vota ${playerToVote.name}`;
                        button.classList.add('player-vote-button');
                        button.onclick = () => castVote(playerToVote.clientId);
                        voteButtonsContainerEl.appendChild(button);
                    }
                });
            } else {
                votingTitleEl.textContent = `Voto inviato o in attesa degli altri...`;
                voteButtonsContainerEl.innerHTML = '<p>Hai già votato o la votazione è in corso per altri.</p>';
            }
            // Potresti mostrare chi ha già votato (senza rivelare per chi)
            break;
        case 'impostorGuess': // Questa fase è gestita da 'voteResult' per il client specifico
            // Se non sono l'impostore, dovrei essere in 'resultScreen' con un messaggio di attesa
            if (myClientId !== finalImpostorNameEl.dataset.impostorClientId) { // Usa un dataset per l'ID
                showScreen('resultScreen');
                resultScreenMessageEl.textContent = "L'impostore è stato scoperto! In attesa della sua ipotesi sulla parola...";
            }
            break;
        case 'results': // Questa fase è gestita da 'finalResult' o da 'voteResult' se non c'era guess
            // Se la UI non è già su resultScreen, qualcosa è strano, ma per sicurezza:
            if (resultScreen.style.display !== 'block') {
                 showScreen('resultScreen');
                 // Il contenuto di resultScreenMessageEl dovrebbe essere già stato impostato
                 // dai messaggi 'voteResult' o 'finalResult'.
            }
            resetGameButton.style.display = iAmHost ? 'inline-block' : 'none'; // Solo host resetta
            break;
        default:
            console.warn("Fase sconosciuta dal server:", gs.currentPhase);
            if (!currentRoomPassword) showScreen('roomPasswordScreen');
            else showScreen('waitingMessageScreen'); // Fallback generico se in una stanza
    }
}

// --- Handler per le azioni dell'utente ---
if (joinRoomButton) {
    joinRoomButton.onclick = () => {
        const rp = roomPasswordInput.value.trim();
        const pn = playerNameInput.value.trim() || `Giocatore Anonimo`; // Nome di default
        roomPasswordError.style.display = 'none';
        if (rp && pn) {
            socket.send(JSON.stringify({ type: 'joinRoom', payload: { roomPassword: rp, playerName: pn } }));
        } else {
            roomPasswordError.textContent = "Inserisci Room Password e il tuo Nome.";
            roomPasswordError.style.display = 'block';
        }
    };
}

if (startGameButton) { // Bottone per l'host per creare la partita
    startGameButton.onclick = () => {
        const numP = numPlayersInput.value;
        const secretW = secretWordInput.value.trim();
        const roomPW = hostRoomPasswordInput.value.trim();
        setupError.style.display = 'none';

        if (numP && secretW && roomPW) {
            if (parseInt(numP) < 3) {
                 setupError.textContent = "Il numero minimo di giocatori è 3.";
                 setupError.style.display = 'block';
                 return;
            }
            socket.send(JSON.stringify({
                type: 'setupGame',
                payload: { numPlayers: numP, secretWord: secretW, roomPassword: roomPW }
            }));
            // L'host ora attenderà 'setupSuccessHost' e poi dovrà fare 'joinRoom'
            showScreen('waitingMessageScreen');
            waitingMessage.innerHTML = "<p>Creazione stanza in corso... Sarai reindirizzato per unirti.</p>";
        } else {
            setupError.textContent = "Compila tutti i campi: Numero Giocatori, Parola Segreta e Password Stanza.";
            setupError.style.display = 'block';
        }
    };
}

if (hostStartGameLobbyButton) {
    hostStartGameLobbyButton.onclick = () => {
        if (iAmHost) {
            socket.send(JSON.stringify({ type: 'startGameFromLobby' }));
        }
    };
}

if (seenRoleButton) {
    seenRoleButton.onclick = () => {
        socket.send(JSON.stringify({ type: 'seenRole' }));
    };
}

if (submitClueButton) {
    submitClueButton.onclick = () => {
        const clue = clueInputEl.value.trim();
        if (clue && myClientId) {
            socket.send(JSON.stringify({ type: 'submitClue', payload: { clue: clue } })); // playerId non serve più, il server lo sa
            clueInputEl.value = '';
        } else if (!clue) {
            alert("L'indizio non può essere vuoto.");
        }
    };
}

if (startVotingButton) { // Ora solo per l'host
    startVotingButton.onclick = () => {
        if (iAmHost) {
            socket.send(JSON.stringify({ type: 'startVoting' }));
        }
    };
}

function castVote(votedPlayerClientId) {
    if (myClientId) {
        socket.send(JSON.stringify({ type: 'castVote', payload: { votedPlayerId: votedPlayerClientId } }));
    }
}

if (checkImpostorGuessButton) {
    checkImpostorGuessButton.onclick = () => {
        const guess = impostorGuessInputEl.value.trim();
        const phaseFromServer = impostorGuessInputEl.dataset.currentPhaseFromServer; // Recupera la fase
        if (guess && myClientId) {
            socket.send(JSON.stringify({ type: 'impostorSubmitGuess', payload: { guess: guess, currentPhaseFromServer: phaseFromServer } }));
            impostorGuessInputEl.value = '';
        }
    };
}

if (resetGameButton) { // Ora solo per l'host
    resetGameButton.onclick = () => {
        if (iAmHost && confirm("Sei sicuro di voler resettare la partita per tutti?")) {
            socket.send(JSON.stringify({ type: 'resetGameByHost' }));
        }
    };
}

// Inizializzazione UI
// La prima schermata mostrata sarà 'roomPasswordScreen' dopo il messaggio 'requestRoomPassword' dal server.
addToGameLog("In attesa di istruzioni dal server...");
// Potresti mostrare una schermata di "Connessione..." iniziale qui
showScreen('waitingMessageScreen');
waitingMessage.innerHTML = "<p>Connessione al server in corso...</p>";