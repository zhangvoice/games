document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const lobby = document.getElementById('lobby');
    const gameBoardUI = document.getElementById('game-board');
    const boardElement = document.getElementById('board');
    const statusMessage = document.getElementById('status-message');
    const restartBtn = document.getElementById('restart-btn');
    const exitBtn = document.getElementById('exit-btn');
    
    // Scores
    const playerScoreBlack = document.querySelector('.player-score.black');
    const playerScoreWhite = document.querySelector('.player-score.white');

    // Lobby Buttons
    const btnPvp = document.getElementById('btn-pvp');
    const btnAi = document.getElementById('btn-ai');
    const btnCreate = document.getElementById('btn-create');
    const btnJoin = document.getElementById('btn-join');
    const roomIdInput = document.getElementById('room-id-input');
    const waitingSection = document.getElementById('waiting-section');
    const createRoomSection = document.getElementById('create-room-section');
    const shareUrlInput = document.getElementById('share-url');
    const btnCopy = document.getElementById('btn-copy');

    // Modal
    const modalOverlay = document.getElementById('modal-overlay');
    const modalWinnerTitle = document.querySelector('.winner-title');
    const modalRestartBtn = document.getElementById('modal-restart-btn');
    const modalExitBtn = document.getElementById('modal-exit-btn');

    // Game Constants
    const BOARD_SIZE = 15;
    const EMPTY = 0;
    const BLACK = 1;
    const WHITE = 2;

    // Game State
    let board = [];
    let currentPlayer = BLACK;
    let gameActive = false;
    let gameMode = 'pvp'; // 'pvp', 'ai', 'online'
    let moveHistory = [];
    
    // Online State
    let peer = null;
    let conn = null;
    let myId = null;
    let isHost = false;
    let myColor = BLACK; // Host is Black (1), Guest is White (2)
    
    // --- Initialization ---
    initBoard();

    function initBoard() {
        boardElement.innerHTML = '';
        board = [];
        for (let i = 0; i < BOARD_SIZE; i++) {
            board[i] = [];
            for (let j = 0; j < BOARD_SIZE; j++) {
                board[i][j] = EMPTY;
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.dataset.row = i;
                cell.dataset.col = j;
                
                // Add star points (Hoshi)
                // 15x15 standard star points: (3,3), (3,11), (7,7), (11,3), (11,11)
                // In 0-indexed: (3,3), (3,11), (7,7), (11,3), (11,11)
                if (isStarPoint(i, j)) {
                    const star = document.createElement('span');
                    star.classList.add('star-point');
                    cell.appendChild(star);
                }

                cell.addEventListener('click', () => handleCellClick(i, j));
                boardElement.appendChild(cell);
            }
        }
    }

    function isStarPoint(row, col) {
        const stars = [
            [3, 3], [3, 11],
            [7, 7],
            [11, 3], [11, 11]
        ];
        return stars.some(p => p[0] === row && p[1] === col);
    }

    // --- Sound Effects ---
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    function playMoveSound() {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const t = audioCtx.currentTime;
        const randomDetune = (Math.random() - 0.5) * 50; 
        const randomGain = 1.0 + (Math.random() - 0.5) * 0.2; 

        // 1. 点击声 (Click) - High frequency noise burst
        const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.01, audioCtx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseBuffer.length; i++) {
            noiseData[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = noiseBuffer;
        const noiseFilter = audioCtx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 1500;
        const noiseGain = audioCtx.createGain();
        
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);
        
        noiseGain.gain.setValueAtTime(0.8 * randomGain, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.01);
        noise.start(t);

        // 2. 闷响 (Thud) - Low frequency sine
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);

        osc1.frequency.setValueAtTime(350, t);
        osc1.detune.value = randomDetune;
        
        gain1.gain.setValueAtTime(0.6 * randomGain, t);
        gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        
        osc1.start(t);
        osc1.stop(t + 0.15);

        // 3. 敲击声 (Tap) - Mid frequency triangle
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(550, t);
        osc2.detune.value = randomDetune;

        gain2.gain.setValueAtTime(0.3 * randomGain, t);
        gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

        osc2.start(t);
        osc2.stop(t + 0.1);
    }

    // --- Game Logic ---

    function handleCellClick(row, col) {
        if (!gameActive || board[row][col] !== EMPTY) return;

        // Online check
        if (gameMode === 'online') {
            if ((myColor === BLACK && currentPlayer !== BLACK) || (myColor === WHITE && currentPlayer !== WHITE)) {
                return;
            }
        }

        // PvE check
        if (gameMode === 'ai' && currentPlayer === WHITE) return;

        makeMove(row, col);

        if (gameMode === 'online') {
            send('move', { row, col });
        } else if (gameMode === 'ai' && gameActive) {
            // AI Move
            setTimeout(makeAiMove, 500);
        }
    }

    function makeMove(row, col) {
        board[row][col] = currentPlayer;
        moveHistory.push({ row, col, player: currentPlayer });
        
        // Play sound
        playMoveSound();

        // Update UI
        const cell = document.querySelector(`.cell[data-row='${row}'][data-col='${col}']`);
        const piece = document.createElement('div');
        piece.classList.add('piece', currentPlayer === BLACK ? 'black' : 'white');
        cell.appendChild(piece);
        cell.classList.add('has-piece');

        // Mark last move
        document.querySelectorAll('.piece.last-move').forEach(el => el.classList.remove('last-move'));
        piece.classList.add('last-move');

        // Check Win
        if (checkWin(row, col, currentPlayer)) {
            endGame(currentPlayer);
            return;
        }

        // Check Draw (Full board)
        if (moveHistory.length === BOARD_SIZE * BOARD_SIZE) {
            endGame('draw');
            return;
        }

        // Switch Player
        currentPlayer = currentPlayer === BLACK ? WHITE : BLACK;
        updateStatus();
    }

    function updateStatus() {
        statusMessage.textContent = `当前回合: ${currentPlayer === BLACK ? '黑方' : '白方'}`;
        
        if (currentPlayer === BLACK) {
            playerScoreBlack.classList.add('active');
            playerScoreWhite.classList.remove('active');
        } else {
            playerScoreBlack.classList.remove('active');
            playerScoreWhite.classList.add('active');
        }

        if (gameMode === 'online') {
            const role = (currentPlayer === BLACK && myColor === BLACK) || (currentPlayer === WHITE && myColor === WHITE) ? '(你)' : '(对手)';
            statusMessage.textContent += ` ${role}`;
        }
    }

    function checkWin(row, col, color) {
        const directions = [
            [0, 1],  // Horizontal
            [1, 0],  // Vertical
            [1, 1],  // Diagonal \
            [1, -1]  // Diagonal /
        ];

        for (const [dr, dc] of directions) {
            let count = 1;

            // Check positive direction
            for (let i = 1; i < 5; i++) {
                const r = row + dr * i;
                const c = col + dc * i;
                if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== color) break;
                count++;
            }

            // Check negative direction
            for (let i = 1; i < 5; i++) {
                const r = row - dr * i;
                const c = col - dc * i;
                if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== color) break;
                count++;
            }

            if (count >= 5) return true;
        }
        return false;
    }

    function endGame(winner) {
        gameActive = false;
        modalOverlay.classList.remove('hidden');
        
        if (winner === 'draw') {
            modalWinnerTitle.textContent = '平局!';
        } else {
            const winnerName = winner === BLACK ? '黑方' : '白方';
            if (gameMode === 'online') {
                const isMe = (winner === myColor);
                modalWinnerTitle.textContent = isMe ? '你赢了!' : '你输了!';
            } else if (gameMode === 'ai') {
                modalWinnerTitle.textContent = winner === BLACK ? '你赢了!' : '电脑赢了!';
            } else {
                modalWinnerTitle.textContent = `${winnerName} 获胜!`;
            }
        }

        // Online cleanup/button state
        if (gameMode === 'online' && !isHost) {
            modalRestartBtn.style.display = 'none';
        } else {
            modalRestartBtn.style.display = 'block';
        }
    }

    function resetGame() {
        modalOverlay.classList.add('hidden');
        boardElement.querySelectorAll('.piece').forEach(el => el.remove());
        boardElement.querySelectorAll('.has-piece').forEach(el => el.classList.remove('has-piece'));
        
        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                board[i][j] = EMPTY;
            }
        }
        
        currentPlayer = BLACK;
        moveHistory = [];
        gameActive = true;
        updateStatus();

        if (gameMode === 'online' && isHost) {
            send('restart');
        }
    }

    // --- AI Logic (Simple Greedy + Heuristic) ---
    // A proper Minimax is too complex for a single file snippet without lag, so we use a strong heuristic scoring.
    
    function makeAiMove() {
        if (!gameActive) return;

        // 1. Check if AI can win immediately
        let winMove = findWinningMove(WHITE);
        if (winMove) {
            makeMove(winMove.row, winMove.col);
            return;
        }

        // 2. Check if Player can win immediately (Block)
        let blockMove = findWinningMove(BLACK);
        if (blockMove) {
            makeMove(blockMove.row, blockMove.col);
            return;
        }

        // 3. Best strategic move based on scoring
        let bestMove = getBestMove();
        makeMove(bestMove.row, bestMove.col);
    }

    function findWinningMove(color) {
        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (board[i][j] === EMPTY) {
                    board[i][j] = color;
                    if (checkWin(i, j, color)) {
                        board[i][j] = EMPTY;
                        return { row: i, col: j };
                    }
                    board[i][j] = EMPTY;
                }
            }
        }
        return null;
    }

    function getBestMove() {
        let bestScore = -Infinity;
        let candidates = [];
        
        // Scan all empty cells, but optimize by only looking near occupied cells
        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (board[i][j] !== EMPTY) continue;
                
                if (!hasNeighbor(i, j)) continue; // Skip isolated cells for efficiency

                let score = evaluatePosition(i, j);
                if (score > bestScore) {
                    bestScore = score;
                    candidates = [{row: i, col: j}];
                } else if (score === bestScore) {
                    candidates.push({row: i, col: j});
                }
            }
        }
        
        // If board is empty (first move)
        if (candidates.length === 0) return { row: 7, col: 7 };

        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    function hasNeighbor(row, col) {
        for (let r = row - 2; r <= row + 2; r++) {
            for (let c = col - 2; c <= col + 2; c++) {
                if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
                    if (board[r][c] !== EMPTY) return true;
                }
            }
        }
        return false;
    }

    function evaluatePosition(row, col) {
        // Evaluate based on potential lines for both AI (Attack) and Player (Defense)
        // Weight Attack slightly higher to be aggressive, or Defense to be safe.
        let score = 0;
        
        score += evaluateLines(row, col, WHITE) * 1.1; // AI Attack
        score += evaluateLines(row, col, BLACK);       // Player Block

        return score;
    }

    function evaluateLines(row, col, color) {
        let score = 0;
        const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

        for (const [dr, dc] of directions) {
            let line = [color]; // Center is current simulated move
            
            // Look forward
            for (let k = 1; k <= 4; k++) {
                let r = row + dr * k, c = col + dc * k;
                if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) { line.push(-1); break; } // Wall
                line.push(board[r][c]);
            }
            
            // Look backward
            for (let k = 1; k <= 4; k++) {
                let r = row - dr * k, c = col - dc * k;
                if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) { line.unshift(-1); break; }
                line.unshift(board[r][c]);
            }
            
            score += evaluateLinePattern(line, color);
        }
        return score;
    }

    function evaluateLinePattern(line, color) {
        // Convert line array to string for regex matching or simple checks
        // color is target, 0 is empty, others are opponent/wall
        
        // Simplify line to string relative to 'color'
        // 'M' = My piece (color), 'E' = Empty (0), 'O' = Opponent/Wall (anything else)
        
        let str = line.map(cell => {
            if (cell === color) return 'M';
            if (cell === EMPTY) return 'E';
            return 'O';
        }).join('');

        // Current move is somewhere in the middle (implied by M injection)
        // Actually, we constructed the line containing the M at the hypothetical position.
        
        let score = 0;

        // Five in a row
        if (str.includes('MMMMM')) return 100000;
        
        // Live Four (Open ends): EMMMME
        if (str.includes('EMMMME')) return 10000;
        
        // Dead Four (One blocked): OMMMME or EMMMMO or MMEMM etc.
        if (str.includes('MMMME') || str.includes('EMMMM') || str.includes('MMEMM') || str.includes('MMMEM')) score += 1000;

        // Live Three: EMMME
        if (str.includes('EMMME')) score += 1000; // Very dangerous, almost as good as dead four

        // Dead Three
        if (str.includes('MMME') || str.includes('EMMM')) score += 100;
        
        // Live Two
        if (str.includes('EMME')) score += 50;

        return score;
    }


    // --- UI/Lobby Logic ---

    function startGame(mode, shouldReset = true) {
        gameMode = mode;
        lobby.classList.add('hidden');
        gameBoardUI.classList.remove('hidden');
        gameActive = true;
        if (shouldReset) {
            resetGame(); // Ensure fresh state
        }
    }

    function exitGame() {
        if (gameMode === 'online') {
            if (isHost && peer) {
                peer.destroy();
                peer = null;
                localStorage.removeItem('gomoku_peer_id');
            }
            if (conn) {
                conn.close();
                conn = null;
            }
        }
        
        gameActive = false;
        modalOverlay.classList.add('hidden');
        gameBoardUI.classList.add('hidden');
        lobby.classList.remove('hidden');
        
        // Reset Online UI
        waitingSection.classList.add('hidden');
        createRoomSection.classList.remove('hidden');
        roomIdInput.value = '';
    }

    btnPvp.addEventListener('click', () => startGame('pvp'));
    btnAi.addEventListener('click', () => startGame('ai'));
    exitBtn.addEventListener('click', () => {
        // Notify opponent
        if (gameMode === 'online' && conn) {
            // If host exits, send a specific 'room-closed' message or just leave
            // If we want to reset game for everyone, host should probably destroy room.
            if (isHost) {
                if(confirm('确定要退出房间吗？这将结束当前游戏。')) {
                    send('room-closed');
                    exitGame();
                }
            } else {
                if(confirm('确定要退出房间吗？')) {
                    send('leave');
                    exitGame();
                }
            }
        } else {
            exitGame();
        }
    });
    
    restartBtn.addEventListener('click', () => {
        if (gameMode === 'online' && !isHost) {
            alert('只有房主可以重新开始');
            return;
        }
        resetGame();
    });

    modalExitBtn.addEventListener('click', () => {
        modalOverlay.classList.add('hidden'); // Hide immediately
        if (gameMode === 'online' && conn) {
             if (isHost) {
                 send('room-closed');
             } else {
                 send('leave');
             }
        }
        exitGame();
    });
    
    modalRestartBtn.addEventListener('click', () => {
        resetGame();
    });

    // --- Online/PeerJS Logic ---

    btnCreate.addEventListener('click', () => {
        isHost = true;
        myColor = BLACK;
        initPeer();
        createRoomSection.classList.add('hidden');
        waitingSection.classList.remove('hidden');
        const p = waitingSection.querySelector('p');
        if (p) p.innerText = "等待对手加入...";
    });

    btnJoin.addEventListener('click', () => {
        const id = roomIdInput.value.trim();
        if (!id) return alert('请输入房间ID');
        isHost = false;
        myColor = WHITE;
        joinRoom(id);
    });

    btnCopy.addEventListener('click', () => {
        shareUrlInput.select();
        document.execCommand('copy');
        const original = btnCopy.textContent;
        btnCopy.textContent = '已复制';
        setTimeout(() => btnCopy.textContent = original, 2000);
    });

    function initPeer() {
        if (peer) {
            peer.destroy();
            peer = null;
        }
        
        // Try to recover ID from localStorage if available to keep room ID stable
        const savedId = localStorage.getItem('gomoku_peer_id');
        const config = (typeof PEER_CONFIG !== 'undefined') ? PEER_CONFIG : {};
        
        peer = new Peer(savedId, config);

        peer.on('open', (id) => {
            myId = id;
            localStorage.setItem('gomoku_peer_id', id);
            console.log('My Peer ID:', id);
            
            // Update URL
            const url = new URL(window.location.href);
            url.searchParams.set('room', id);
            shareUrlInput.value = url.toString();
            btnCopy.disabled = false;
            btnCopy.classList.remove('cursor-not-allowed', 'text-slate-300');
            btnCopy.classList.add('text-orange-500');

            // Handle host page refresh logic
            const urlParams = new URLSearchParams(window.location.search);
            const roomParam = urlParams.get('room');
            if (roomParam === id) {
                 isHost = true;
                 myColor = BLACK;
                 // If we are refreshing, UI might need to be restored
                 createRoomSection.classList.add('hidden');
                 waitingSection.classList.remove('hidden');
            }
        });

        peer.on('connection', (connection) => {
            if (conn && conn.open) {
                console.log('Already connected, rejecting new connection');
                connection.close();
                return;
            }
            conn = connection;
            isHost = true; // Confirm host role
            setupConnection();
        });

        peer.on('error', (err) => {
            console.error(err);
            if (err.type === 'unavailable-id') {
                // ID taken, maybe clear storage and retry
                localStorage.removeItem('gomoku_peer_id');
                initPeer(); // Retry with new ID
                return;
            }
            alert('连接服务器错误: ' + err.type);
            exitGame(true); // Forced exit
        });

        peer.on('disconnected', () => {
             console.log('Disconnected from server, reconnecting...');
             setTimeout(() => {
                 if (peer && !peer.destroyed) peer.reconnect();
             }, 3000);
        });
    }

    function joinRoom(id) {
        // Guest does not need to persist ID
        if (peer) {
            peer.destroy();
            peer = null;
        }
        const config = (typeof PEER_CONFIG !== 'undefined') ? PEER_CONFIG : {};
        peer = new Peer(null, config);
        
        peer.on('open', () => {
            conn = peer.connect(id);
            setupConnection();
        });

        peer.on('error', (err) => {
            alert('连接错误: ' + err.type);
        });
    }

    function setupConnection() {
        conn.on('open', () => {
            console.log('Connected');
            
            if (isHost) {
                // Host sends initial state to sync
                startGame('online', false); // Host continues current game
                send('init', {
                    board: board,
                    currentPlayer: currentPlayer,
                    moveHistory: moveHistory
                });
            } else {
                // Guest waits for init
                // We don't start game UI immediately until we get 'init' or 'sync'
                waitingSection.classList.remove('hidden');
                createRoomSection.classList.add('hidden');
                const p = waitingSection.querySelector('p');
                if (p) p.innerText = "已连接，正在同步游戏状态...";
            }
        });

        conn.on('data', (data) => {
            handleData(data);
        });

        conn.on('close', () => {
            if (isHost) {
                // Guest disconnected
                console.log('Guest disconnected');
                // Don't exit game, just notify
                // Maybe show a toast or status update
                statusMessage.textContent = "对手已断开，等待重连...";
                // Keep the room open for them to rejoin
                conn = null;
            } else {
                // Host disconnected
                alert('房主已断开连接');
                exitGame(true);
            }
        });
    }

    function send(type, payload = {}) {
        if (conn && conn.open) {
            conn.send({ type, ...payload });
        }
    }

    function handleData(data) {
        switch (data.type) {
            case 'init':
                // Guest receives initial state
                isHost = false;
                myColor = WHITE;
                board = data.board;
                currentPlayer = data.currentPlayer;
                moveHistory = data.moveHistory;
                startGame('online', false); // Do NOT reset game, just switch UI
                // Re-render board
                renderBoardFromState();
                updateStatus();
                break;
            case 'move':
                makeMove(data.row, data.col);
                break;
            case 'restart':
                resetGame();
                alert('房主重新开始了游戏');
                break;
            case 'leave':
                if (isHost) {
                    statusMessage.textContent = "对手已离开，等待新对手...";
                    conn.close();
                    conn = null;
                    // Reset game state? Or keep it? Usually reset if opponent leaves for good.
                    // But if it's a refresh, they might rejoin.
                    // Let's keep it simple: if explicit leave, we might want to reset.
                    // But here we just keep waiting.
                } else {
                    alert('对方离开了房间');
                    exitGame();
                }
                break;
            case 'room-closed':
                alert('房主已退出房间，游戏结束');
                exitGame(true); // Forced exit
                break;
        }
    }
    
    function renderBoardFromState() {
        // Clear UI first
        boardElement.querySelectorAll('.piece').forEach(el => el.remove());
        boardElement.querySelectorAll('.has-piece').forEach(el => el.classList.remove('has-piece'));
        
        // Re-render based on board array
        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (board[i][j] !== EMPTY) {
                    const cell = document.querySelector(`.cell[data-row='${i}'][data-col='${j}']`);
                    const piece = document.createElement('div');
                    piece.classList.add('piece', board[i][j] === BLACK ? 'black' : 'white');
                    cell.appendChild(piece);
                    cell.classList.add('has-piece');
                }
            }
        }
        
        // Mark last move
        if (moveHistory.length > 0) {
            const last = moveHistory[moveHistory.length - 1];
            const lastPiece = document.querySelector(`.cell[data-row='${last.row}'][data-col='${last.col}'] .piece`);
            if (lastPiece) lastPiece.classList.add('last-move');
        }
    }

    function exitGame(isForced = false) {
        if (gameMode === 'online') {
            if (isHost && !isForced) {
                // Host exiting explicitly
                if (peer) {
                    peer.destroy();
                    peer = null;
                    localStorage.removeItem('gomoku_peer_id');
                }
            }
            if (conn) {
                conn.close();
                conn = null;
            }
        }
        
        gameActive = false;
        modalOverlay.classList.add('hidden');
        gameBoardUI.classList.add('hidden');
        lobby.classList.remove('hidden');
        
        // Reset Online UI
        waitingSection.classList.add('hidden');
        createRoomSection.classList.remove('hidden');
        roomIdInput.value = '';
        
        // Reset URL
        const url = new URL(window.location.href);
        url.searchParams.delete('room');
        window.history.pushState({}, '', url);
    }

    // Auto Join
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    
    // Check if we are the host (recovered from storage)
    const savedId = localStorage.getItem('gomoku_peer_id');
    
    if (roomParam) {
        if (savedId && roomParam === savedId) {
            // We are the host refreshing the page
            console.log('Restoring host session...');
            roomIdInput.value = roomParam;
            // initPeer will handle the UI update in 'open' event
            initPeer();
        } else {
            // We are a guest joining a room
            console.log('Auto joining room:', roomParam);
            roomIdInput.value = roomParam;
            isHost = false;
            myColor = WHITE;
            
            // We need to wait for user interaction usually for audio context, but for connection it's fine.
            // However, we should probably show the UI state
            btnJoin.innerText = '连接中...';
            btnJoin.disabled = true;
            
            joinRoom(roomParam);
        }
    }

});
