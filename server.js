// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// --- MODIFICA: Stato del gioco ora include la Room Password ---
let gameState = {
    players: [],
    secretWord: '',
    impostorId: null,
    currentPhase: 'waitingForHost', // Nuova fase iniziale
    cluesSubmitted: [],
    votes: {},
    gameLog: [],
    roomPassword: null, // Password per entrare nella stanza/partita
    hostId: null,       // ID del client che ha creato la partita
    expectedPlayers: 0  // Numero di giocatori attesi dall'host
};
let playerCounter = 0;

function broadcast(data, specificRoomPassword = null) {
    wss.clients.forEach(client => {
        // Solo ai client autenticati per la stanza corretta (se specificato)
        // E che sono stati aggiunti a gameState.players
        if (client.readyState === WebSocket.OPEN &&
            (specificRoomPassword === null || client.roomPassword === specificRoomPassword) &&
            gameState.players.some(p => p.id === client)) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastGameState(roomPasswordForBroadcast = gameState.roomPassword) {
    if (!roomPasswordForBroadcast) return; // Non fare broadcast se non c'è una partita attiva

    const publicGameState = {
        players: gameState.players.map(p => ({
            name: p.name,
            clientId: p.clientId, // Usiamo clientId come identificatore pubblico
            hasSubmittedClue: !!p.clue,
            hasVoted: !!p.votedFor,
            isHost: p.clientId === gameState.hostId
        })),
        secretWordLength: gameState.secretWord ? gameState.secretWord.length : 0,
        currentPhase: gameState.currentPhase,
        cluesSubmitted: gameState.cluesSubmitted,
        // votes: gameState.votes, // Forse meglio inviare i voti solo alla fine
        gameLog: gameState.gameLog,
        roomPassword: gameState.roomPassword, // Utile per il client sapere a quale stanza è connesso
        expectedPlayers: gameState.expectedPlayers,
        hostName: gameState.hostId ? gameState.players.find(p => p.clientId === gameState.hostId)?.name : null
    };
    broadcast({ type: 'gameStateUpdate', payload: publicGameState }, roomPasswordForBroadcast);
}

wss.on('connection', (ws) => {
    const tempClientId = `temp_${playerCounter++}`; // ID temporaneo prima dell'autenticazione
    ws.tempClientId = tempClientId; // Associa l'ID temporaneo al client ws
    console.log(`Nuova connessione (temp ID: ${tempClientId}). In attesa di Room Password.`);

    ws.send(JSON.stringify({ type: 'requestRoomPassword' }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`Messaggio da ${ws.playerName || ws.tempClientId}:`, data);

            // --- PRIMA AUTENTICAZIONE CON ROOM PASSWORD ---
            if (data.type === 'joinRoom') {
                if (gameState.roomPassword && data.payload.roomPassword === gameState.roomPassword) {
                    if (gameState.players.length >= gameState.expectedPlayers && gameState.currentPhase !== 'waitingForHost') {
                         ws.send(JSON.stringify({ type: 'error', payload: 'La partita è già piena o iniziata.' }));
                         return;
                    }

                    // Autenticazione riuscita
                    ws.roomPassword = data.payload.roomPassword; // Associa la room password al client ws
                    const clientId = `player_${playerCounter++}`; // Ora assegna un ID giocatore permanente
                    const playerName = data.payload.playerName || `Giocatore ${playerCounter}`;
                    ws.clientId = clientId;
                    ws.playerName = playerName;

                    const player = { id: ws, clientId: clientId, name: playerName, role: null, clue: null, votedFor: null, hasSeenRole: false };
                    gameState.players.push(player);
                    
                    console.log(`${playerName} (ID: ${clientId}) si è unito alla stanza ${ws.roomPassword}.`);
                    ws.send(JSON.stringify({ type: 'joinSuccess', payload: { clientId, playerName, roomPassword: ws.roomPassword } }));
                    
                    if (gameState.players.length === 1 && !gameState.hostId) { // Il primo che si unisce dopo il setup è l'host
                        gameState.hostId = clientId;
                        console.log(`${playerName} è ora l'host.`);
                        // Se la fase è 'waitingForHost' e l'host è il primo a 'joinRoom' dopo il setup,
                        // potrebbe essere necessario aggiornare la fase, ma setupGame la gestirà.
                    }
                    
                    broadcastGameState(); // Aggiorna tutti
                } else if (gameState.roomPassword && data.payload.roomPassword !== gameState.roomPassword) {
                    ws.send(JSON.stringify({ type: 'error', payload: 'Room Password errata.' }));
                } else if (!gameState.roomPassword && gameState.currentPhase === 'waitingForHost') {
                    ws.send(JSON.stringify({ type: 'error', payload: 'Nessuna partita attiva. L\'host deve prima crearne una.' }));
                }
                return; // Messaggio gestito
            }

            // --- CONTROLLO SE IL CLIENT È AUTENTICATO PER ALTRE AZIONI ---
            if (!ws.roomPassword || ws.roomPassword !== gameState.roomPassword) {
                // Se il client non è ancora autenticato per la stanza corrente o la stanza non esiste più
                if (data.type !== 'setupGame') { // setupGame è speciale perché CREA la stanza
                     ws.send(JSON.stringify({ type: 'error', payload: 'Non sei autenticato per questa azione o la partita non è valida.' }));
                     return;
                }
            }
            const currentPlayer = gameState.players.find(p => p.id === ws);
            if (!currentPlayer && data.type !== 'setupGame') { // Se non è setupGame, il giocatore deve esistere in players
                console.warn(`Azione da client non trovato in gameState.players: ${ws.clientId}`);
                ws.send(JSON.stringify({ type: 'error', payload: 'Giocatore non trovato nella partita corrente.' }));
                return;
            }


            // --- GESTIONE DEI MESSAGGI DAL CLIENT (POST-AUTENTICAZIONE) ---
            if (data.type === 'setupGame') {
                // Solo il primo giocatore che invia setupGame (o nessuno se la stanza è già creata)
                if (gameState.currentPhase === 'waitingForHost' || data.payload.forceReset) { // Aggiunto forceReset per l'host
                    gameState.secretWord = data.payload.secretWord;
                    gameState.expectedPlayers = parseInt(data.payload.numPlayers);
                    gameState.roomPassword = data.payload.roomPassword; // Memorizza la Room Password
                    gameState.currentPhase = 'lobby'; // Nuova fase: attesa giocatori nella lobby
                    gameState.players = []; // Resetta i giocatori per la nuova partita
                    playerCounter = 0; // Resetta il contatore per i nuovi clientId nella nuova partita
                    gameState.cluesSubmitted = [];
                    gameState.votes = {};
                    gameState.impostorId = null;
                    gameState.hostId = null; // Verrà impostato dal primo che fa joinRoom (che sarà l'host)

                    // L'host che ha fatto setup ora deve anche fare 'joinRoom'
                    // Il server non aggiunge automaticamente l'host qui, attende il suo messaggio 'joinRoom'
                    
                    gameState.gameLog = [`Partita creata con Room Password: ${gameState.roomPassword}. In attesa di ${gameState.expectedPlayers} giocatori. Parola Segreta: ${gameState.secretWord}`];
                    console.log(`Partita creata da (futuro host con tempId ${ws.tempClientId}) con Room Password: ${gameState.roomPassword}`);
                    
                    // Invia un messaggio speciale all'host che ha fatto setup per dirgli di fare join
                    ws.send(JSON.stringify({ type: 'setupSuccessHost', payload: { roomPassword: gameState.roomPassword } }));
                    // Non fare broadcastGameState() qui, perché nessun giocatore è ancora "dentro" la stanza logica
                } else {
                    ws.send(JSON.stringify({type: 'error', payload: 'Una partita è già in corso o in fase di setup.'}));
                }
            } else if (data.type === 'startGameFromLobby') {
                // Solo l'host può avviare la partita dalla lobby
                if (currentPlayer && currentPlayer.clientId === gameState.hostId && gameState.currentPhase === 'lobby') {
                    if (gameState.players.length >= 3 && gameState.players.length === gameState.expectedPlayers) {
                        // Assegna ruoli
                        const impostorIndex = Math.floor(Math.random() * gameState.players.length);
                        gameState.players.forEach((p, index) => {
                            p.role = (index === impostorIndex) ? 'impostore' : 'onesto';
                            if (index === impostorIndex) gameState.impostorId = p.clientId;
                            p.hasSeenRole = false;
                        });
                        gameState.currentPhase = 'roleReveal';
                        gameState.gameLog.push(`Partita avviata dall'host ${currentPlayer.name} con ${gameState.players.length} giocatori.`);
                        broadcastGameState();
                        gameState.players.forEach(p => {
                            p.id.send(JSON.stringify({
                                type: 'yourRole',
                                payload: {
                                    role: p.role,
                                    secretWord: p.role === 'onesto' ? gameState.secretWord : 'Sei l\'impostore!'
                                }
                            }));
                        });
                    } else {
                        ws.send(JSON.stringify({ type: 'error', payload: `Numero di giocatori insufficiente o non corrispondente all'atteso. Connessi: ${gameState.players.length}, Attesi: ${gameState.expectedPlayers}` }));
                    }
                } else {
                     ws.send(JSON.stringify({ type: 'error', payload: 'Non sei l\'host o la partita non è in lobby.' }));
                }

            } else if (data.type === 'seenRole') {
                 if (currentPlayer && gameState.currentPhase === 'roleReveal') {
                    currentPlayer.hasSeenRole = true;
                    const allSeen = gameState.players.every(p => p.hasSeenRole);
                    if (allSeen) {
                        gameState.currentPhase = 'clues';
                        gameState.cluesSubmitted = [];
                        gameState.players.forEach(p => p.clue = null);
                        gameState.gameLog.push("Tutti i giocatori hanno visto il loro ruolo. Inizio fase indizi.");
                        broadcastGameState();
                    } else {
                        // Potresti inviare un aggiornamento parziale per mostrare chi sta ancora guardando
                        broadcastGameState();
                    }
                }
            } else if (data.type === 'submitClue') {
                if (currentPlayer && gameState.currentPhase === 'clues' && !currentPlayer.clue) {
                    // Validazione che sia il turno del giocatore (se implementi turni stretti)
                    // Per ora, chiunque può inviare l'indizio una volta
                    currentPlayer.clue = data.payload.clue;
                    gameState.cluesSubmitted.push({ playerName: currentPlayer.name, clue: data.payload.clue, playerId: currentPlayer.clientId });
                    gameState.gameLog.push(`${currentPlayer.name} ha dato un indizio.`);
                    broadcastGameState();

                    const allCluesIn = gameState.players.every(p => p.clue !== null);
                    if (allCluesIn) {
                        gameState.currentPhase = 'discussion';
                         // Mischia gli indizi se vuoi renderli anonimi prima della votazione
                        gameState.cluesSubmitted.sort(() => Math.random() - 0.5);
                        gameState.gameLog.push("Tutti gli indizi sono stati dati. Inizio discussione/votazione.");
                        broadcastGameState();
                    }
                }
            } else if (data.type === 'startVoting') {
                if (currentPlayer && currentPlayer.clientId === gameState.hostId && (gameState.currentPhase === 'discussion' || gameState.currentPhase === 'clues')) {
                    gameState.currentPhase = 'voting';
                    gameState.votes = {};
                    gameState.players.forEach(p => p.votedFor = null);
                    gameState.gameLog.push("Inizio fase di votazione (avviata dall'host).");
                    broadcastGameState();
                }
            } else if (data.type === 'castVote') {
                if (currentPlayer && gameState.currentPhase === 'voting' && !currentPlayer.votedFor) {
                    const votedPlayerId = data.payload.votedPlayerId; // clientId del giocatore votato
                    currentPlayer.votedFor = votedPlayerId;
                    gameState.votes[votedPlayerId] = (gameState.votes[votedPlayerId] || 0) + 1;
                    gameState.gameLog.push(`${currentPlayer.name} ha votato.`);
                    broadcastGameState();

                    const allVoted = gameState.players.every(p => p.votedFor !== null);
                    if (allVoted) {
                        // Calcola i risultati (logica simile a prima)
                        let maxVotes = 0;
                        let accusedIds = []; // Array di clientId accusati
                        for (const pid in gameState.votes) {
                            if (gameState.votes[pid] > maxVotes) {
                                maxVotes = gameState.votes[pid];
                                accusedIds = [pid];
                            } else if (gameState.votes[pid] === maxVotes) {
                                accusedIds.push(pid);
                            }
                        }
                        
                        let resultMessage = "";
                        let nextPhaseForGameResult = 'results';
                        let accusedIsImpostor = false;

                        if (accusedIds.length === 1 && accusedIds[0] === gameState.impostorId) {
                            const impostorDetails = gameState.players.find(p => p.clientId === gameState.impostorId);
                            resultMessage = `L'impostore (${impostorDetails.name}) è stato scoperto! Ora può provare a indovinare la parola.`;
                            nextPhaseForGameResult = 'impostorGuess';
                            accusedIsImpostor = true;
                        } else if (accusedIds.length > 0 && accusedIds[0] !== gameState.impostorId) {
                            const impostorDetails = gameState.players.find(p => p.clientId === gameState.impostorId);
                            const wronglyAccused = gameState.players.find(p => p.clientId === accusedIds[0]);
                            resultMessage = `Avete accusato un innocente (${wronglyAccused.name})! L'impostore (${impostorDetails.name}) vince!`;
                        } else { // Pareggio o nessun voto
                            const impostorDetails = gameState.players.find(p => p.clientId === gameState.impostorId);
                            resultMessage = `Confusione! L'impostore (${impostorDetails.name}) vince!`;
                        }
                        gameState.currentPhase = 'results'; // La fase logica del gioco è 'results' o 'impostorGuess'
                        gameState.gameLog.push(`Risultato votazione: ${resultMessage}`);
                        if (nextPhaseForGameResult === 'results') { // Se l'impostore non deve indovinare
                            gameState.gameLog.push(`L'impostore era: ${gameState.players.find(p=>p.clientId === gameState.impostorId).name}. Parola Segreta: ${gameState.secretWord}.`);
                        }
                        
                        // Invia un messaggio specifico per il risultato del voto, che potrebbe portare a impostorGuess
                        broadcast({
                            type: 'voteResult', // Nuovo tipo di messaggio per gestire questo passaggio
                            payload: {
                                message: resultMessage,
                                impostorName: gameState.players.find(p => p.clientId === gameState.impostorId).name,
                                impostorClientId: gameState.impostorId, // Importante per il client
                                secretWord: gameState.secretWord, // Invia solo se non c'è impostorGuess
                                nextPhase: nextPhaseForGameResult, // 'impostorGuess' o 'results'
                                accusedIsImpostor: accusedIsImpostor
                            }
                        });
                         // Non chiamare broadcastGameState qui se voteResult è più specifico per la transizione
                    }
                }
            } else if (data.type === 'impostorSubmitGuess') {
                if (currentPlayer && gameState.impostorId === currentPlayer.clientId && data.payload.currentPhaseFromServer === 'impostorGuess') {
                    let resultMessage = "";
                    if (data.payload.guess.toLowerCase() === gameState.secretWord.toLowerCase()) {
                        resultMessage = `L'impostore (${currentPlayer.name}) ha indovinato la parola ("${gameState.secretWord}")! L'IMPOSTORE VINCE!`;
                    } else {
                        resultMessage = `L'impostore (${currentPlayer.name}) NON ha indovinato la parola (ha detto: "${data.payload.guess}"). GLI ONESTI VINCONO!`;
                    }
                    gameState.currentPhase = 'results'; // Fase finale
                    gameState.gameLog.push(resultMessage);
                    gameState.gameLog.push(`L'impostore era: ${currentPlayer.name}. Parola Segreta: ${gameState.secretWord}.`);

                    broadcast({
                        type: 'finalResult', // Nuovo tipo per il risultato finale dopo il guess
                        payload: {
                            message: resultMessage,
                            impostorName: currentPlayer.name,
                            secretWord: gameState.secretWord,
                            currentPhase: 'results'
                        }
                    });
                }
            } else if (data.type === 'resetGameByHost') {
                 if (currentPlayer && currentPlayer.clientId === gameState.hostId) {
                    // Resetta lo stato del gioco per una nuova partita
                    const oldRoomPassword = gameState.roomPassword;
                    gameState = {
                        players: [],
                        secretWord: '',
                        impostorId: null,
                        currentPhase: 'waitingForHost', // Torna alla fase iniziale
                        cluesSubmitted: [],
                        votes: {},
                        gameLog: [`Gioco resettato dall'host. In attesa di nuova configurazione.`],
                        roomPassword: null, // L'host dovrà creare una nuova stanza
                        hostId: null,
                        expectedPlayers: 0
                    };
                    playerCounter = 0;
                    
                    console.log(`Gioco resettato dall'host. Stanza ${oldRoomPassword} non più attiva.`);
                    // Invia un messaggio ai client della vecchia stanza che il gioco è finito/resettato
                     wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && client.roomPassword === oldRoomPassword) {
                           client.send(JSON.stringify({ type: 'gameResetByServer' }));
                           client.roomPassword = null; // Rimuovi l'associazione alla vecchia stanza
                        }
                    });
                    // Non c'è broadcastGameState perché la stanza logica non esiste più fino al nuovo setup
                }
            }


        } catch (e) {
            console.error(`Errore nel processare il messaggio da ${ws.playerName || ws.tempClientId}:`, e);
            ws.send(JSON.stringify({ type: 'error', payload: 'Messaggio malformato o errore interno.' }));
        }
    });

    ws.on('close', () => {
        const playerIndex = gameState.players.findIndex(p => p.id === ws);
        if (playerIndex > -1) {
            const [disconnectedPlayer] = gameState.players.splice(playerIndex, 1);
            console.log(`${disconnectedPlayer.name} (${disconnectedPlayer.clientId}) disconnesso dalla stanza ${ws.roomPassword}.`);
            if (disconnectedPlayer.clientId === gameState.hostId) {
                // Gestione se l'host si disconnette: potresti terminare la partita o eleggere un nuovo host
                console.warn("L'HOST SI È DISCONNESSO! La partita potrebbe interrompersi.");
                gameState.gameLog.push("ATTENZIONE: L'host si è disconnesso. La partita potrebbe terminare.");
                // Per ora, la partita continua ma senza host attivo per certe azioni
                gameState.hostId = null; // o eleggerne uno nuovo
            }
            if(gameState.roomPassword) broadcastGameState(); // Aggiorna gli altri solo se c'era una stanza attiva
        } else {
            console.log(`Connessione temporanea (temp ID: ${ws.tempClientId}) chiusa prima di unirsi a una stanza.`);
        }
    });

    ws.on('error', (err) => {
        console.error(`Errore WebSocket per ${ws.playerName || ws.tempClientId}: ${err.message}`);
        // Logica di rimozione simile a 'close' se l'errore causa la chiusura
    });
});

server.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
    console.log(`Apri http://localhost:${PORT} nel tuo browser.`);
});