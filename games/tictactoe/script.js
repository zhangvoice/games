document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const lobby = document.getElementById('lobby');
    const gameBoard = document.getElementById('game-board');
    const statusDisplay = document.getElementById('status-display');
    const cells = document.querySelectorAll('.cell');
    const restartBtn = document.getElementById('restart-btn');
    const gameModeDisplay = document.getElementById('game-mode-display');
    
    // Lobby Buttons
    const btnPvp = document.getElementById('btn-pvp');
    const btnPve = document.getElementById('btn-pve');
    const btnCreate = document.getElementById('btn-create');
    const btnJoin = document.getElementById('btn-join');
    const btnExit = document.getElementById('btn-exit');
    const btnCopy = document.getElementById('btn-copy');
    
    // Modal Elements
    const modalOverlay = document.getElementById('modal-overlay');
    const winnerIcon = document.getElementById('winner-icon');
    const winnerTitle = document.getElementById('winner-title');
    const modalRestartBtn = document.getElementById('modal-restart-btn');
    const modalExitBtn = document.getElementById('modal-exit-btn');
    
    // Online Elements
    const waitingSection = document.getElementById('waiting-section');
    const createRoomSection = document.getElementById('create-room-section');
    const roomIdInput = document.getElementById('room-id-input');
    const shareUrlInput = document.getElementById('share-url');

    // Game State
    let gameActive = true;
    let currentPlayer = "X";
    let gameState = ["", "", "", "", "", "", "", "", ""];
    let gameMode = 'pvp'; // 'pvp', 'pve', 'online'
    
    // Online State
    let peer = null;
    let conn = null;
    let myId = null;
    let isHost = false;
    let myColor = 'X'; // Online mode: 'X' or 'O'
    let connectRetryCount = 0;
    const MAX_RETRIES = 3;

    const winningConditions = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    // --- Toast Notification ---
    function showToast(message, type = 'info') {
        // Check if toast container exists, create if not
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'fixed top-24 left-1/2 transform -translate-x-1/2 z-50 flex flex-col gap-2';
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        let bgClass = 'bg-slate-800';
        if (type === 'error') bgClass = 'bg-red-500';
        if (type === 'success') bgClass = 'bg-green-500';
        
        toast.className = `${bgClass} text-white px-6 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 opacity-0 translate-y-[-10px]`;
        toast.innerText = message;
        
        toastContainer.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => {
            toast.classList.remove('opacity-0', 'translate-y-[-10px]');
        }, 10);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-[-10px]');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
    }
    const winningMessage = () => `玩家 ${currentPlayer} 获胜!`;
    const drawMessage = () => `平局!`;
    const currentPlayerTurn = () => {
        if (gameMode === 'online') {
            const role = currentPlayer === myColor ? '(你)' : '(对手)';
            return `玩家 ${currentPlayer} 的回合 ${role}`;
        }
        return `玩家 ${currentPlayer} 的回合`;
    };

    // --- PeerJS Logic ---
    function initPeer() {
        // 防止重复初始化
        if (peer) {
            // 如果已经有连接，先清理
            peer.destroy();
            peer = null;
        }

        // 尝试从 localStorage 获取之前的 ID
        const savedId = localStorage.getItem('tictactoe_peer_id');
        
        // Use global PEER_CONFIG if available, otherwise default
        const config = (typeof PEER_CONFIG !== 'undefined') ? PEER_CONFIG : {};
        
        peer = new Peer(savedId, config);

        // 如果断开连接，自动重新连接到服务器
        peer.on('disconnected', () => {
            console.log('Disconnected from PeerServer, attempting to reconnect...');
            // 稍等片刻再重连，避免频繁请求
            setTimeout(() => {
                if (peer && !peer.destroyed) {
                    peer.reconnect();
                }
            }, 3000);
        });

        // 关闭逻辑
        peer.on('close', () => {
            console.log('Peer destroyed');
            conn = null;
        });

        peer.on('open', (id) => {
            myId = id;
            localStorage.setItem('tictactoe_peer_id', id);
            console.log('My peer ID is: ' + id);
            connectRetryCount = 0; // 重置重试计数
            
            // Update UI for Room Creation
            const url = new URL(window.location.href);
            url.searchParams.set('room', id);
            shareUrlInput.value = url.toString();
            
            // Enable copy button
            btnCopy.disabled = false;
            btnCopy.classList.remove('text-slate-300', 'cursor-not-allowed');
            btnCopy.classList.add('text-orange-500', 'hover:text-orange-600', 'cursor-pointer');
            
            // 处理重连 / 恢复 / 自动加入
            const urlParams = new URLSearchParams(window.location.search);
            const roomParam = urlParams.get('room');

            if (roomParam) {
                if (roomParam === id) {
                    // 房主刷新页面
                    console.log('我是房主，恢复房间状态');
                    isHost = true;
                    // 恢复房主界面
                    waitingSection.classList.remove('hidden');
                    createRoomSection.classList.add('hidden');
                    const p = waitingSection.querySelector('p');
                    if (p) p.innerText = "等待对手加入...";
                    
                    // 这里可以添加状态恢复逻辑，目前暂不处理复杂状态恢复
                } else {
                    // 访客刷新或加入
                    console.log('我是访客，准备加入:', roomParam);
                    // 只有当不是房主时才自动加入
                    if (!isHost) joinRoom(roomParam);
                }
            } else {
                // 如果没有 room 参数，说明是新创建的房间（URL 还没更新，但我们已经拿到了 id）
                // 或者是清除了 URL 参数后的情况
                if (isHost) {
                    waitingSection.classList.remove('hidden');
                    createRoomSection.classList.add('hidden');
                    const p = waitingSection.querySelector('p');
                    if (p) p.innerText = "等待对手加入...";
                }
            }
        });

        peer.on('connection', (connection) => {
            // 如果已连接且开启，则拒绝新连接
            if (conn && conn.open) {
                console.log('Already connected, rejecting new connection');
                connection.close();
                return;
            }
            
            console.log('Receiving new connection...');
            conn = connection;
            isHost = true;
            setupConnection();
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
            
            // 自动重试逻辑：针对自动加入模式下的连接错误
            const urlParams = new URLSearchParams(window.location.search);
            const roomParam = urlParams.get('room');
            
            if (roomParam && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed')) {
                 if (connectRetryCount < MAX_RETRIES) {
                     connectRetryCount++;
                     console.log(`Connection lost, retrying (${connectRetryCount}/${MAX_RETRIES})...`);
                     setTimeout(() => {
                         if (peer) peer.destroy();
                         initPeer();
                     }, 2000);
                     return; // 阻止默认的 alert 和 resetToLobby
                 }
            }

            let msg = '连接出错';
            switch (err.type) {
                case 'peer-unavailable':
                    msg = '找不到指定的房间。请确认房间 ID 是否正确，或者房主是否已退出。';
                    break;
                case 'network':
                    msg = '网络连接异常，请检查您的网络设置。';
                    break;
                case 'browser-incompatible':
                    msg = '您的浏览器不支持 WebRTC，请更换现代浏览器（如 Chrome, Edge）。';
                    break;
                case 'unavailable-id':
                    msg = '房间 ID 已被占用或尚未释放，请稍后重试或尝试重新创建。';
                    localStorage.removeItem('tictactoe_peer_id'); // 清除损坏或占用的 ID
                    break;
                default:
                    msg = '连接出错: ' + err.type;
            }
            showToast(msg, 'error');
            resetToLobby();
        });
    }

    function joinRoom(id) {
        isHost = false;
        btnJoin.innerText = '连接中...';
        btnJoin.disabled = true;
        
        if (!peer) {
            initPeer();
            // 等待 open 事件后再连接
            const checkPeer = setInterval(() => {
                if (peer && !peer.disconnected && !peer.destroyed && peer.id) {
                    clearInterval(checkPeer);
                    performJoin(id);
                }
            }, 100);
        } else {
            performJoin(id);
        }
    }

    function performJoin(id) {
        if (conn) conn.close();
        
        // Check if joining self
        if (id === myId) {
            showToast('不能加入自己的房间', 'error');
            btnJoin.innerText = '加入';
            btnJoin.disabled = false;
            return;
        }

        console.log(`尝试连接房间: ${id}`);
        conn = peer.connect(id, {
            reliable: true,
            serialization: 'json'
        });
        
        isHost = false;
        
        // Connection timeout
        const connTimeout = setTimeout(() => {
            if (conn && !conn.open) {
                conn.close();
                showToast('连接房间超时，请检查房间ID是否正确，或对方是否在线', 'error');
                btnJoin.innerText = '加入';
                btnJoin.disabled = false;
            }
        }, 10000);

        setupConnection(connTimeout);
    }

    function setupConnection(timeoutTimer = null) {
        conn.on('open', () => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            console.log('Connected!');
            
            // 如果是房主，且有重连情况，不重置游戏
            // 如果是访客，等待 init 消息来同步状态，也不要重置
            // 实际上，只要连接建立，我们就不应该在这里重置游戏，
            // 房主应该在创建房间时重置，访客在 init 时更新。
            startGame('online', false);
            
            if (isHost) {
                myColor = 'X';
                // Send init data
                send('init', {
                    gameState: gameState,
                    currentPlayer: currentPlayer
                });
                statusDisplay.innerHTML = currentPlayerTurn(); // 确保显示正确状态
            } else {
                myColor = 'O'; // Host is always X
                statusDisplay.innerHTML = "已连接，等待同步游戏状态...";
            }
        });

        conn.on('data', (data) => {
            handleData(data);
        });

        conn.on('close', () => {
            if (isHost) {
                 // 房主逻辑：保持状态，等待重连
                 conn = null;
                 statusDisplay.innerText = "对手已断开，等待重连...";
                 // 可以选择显示等待遮罩，或者仅提示
                 showToast('对手已断开连接，等待重连...', 'error');
            } else {
                 showToast('连接已断开', 'error');
                 resetToLobby();
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
                gameState = data.gameState;
                currentPlayer = data.currentPlayer;
                myColor = 'O'; // Confirm guest role
                updateBoardUI();
                statusDisplay.innerHTML = currentPlayerTurn();
                break;
            case 'move':
                // Apply move without sending back
                applyMove(data.index, false);
                break;
            case 'restart':
                resetGameInternal();
                showToast('房主重新开始了游戏', 'success');
                break;
            case 'leave':
                if (isHost) {
                     // 房主逻辑：保持状态，等待重连 (同 close)
                     conn = null;
                     statusDisplay.innerText = "对手已退出，等待重连...";
                     showToast('对手已退出房间，等待重连...', 'info');
                } else {
                     showToast('对方离开了房间', 'info');
                     resetToLobby();
                }
                break;
        }
    }

    // --- Game Logic ---

    function handleCellPlayed(clickedCell, clickedCellIndex) {
        gameState[clickedCellIndex] = currentPlayer;
        clickedCell.innerHTML = currentPlayer;
        
        // Remove default classes
        clickedCell.classList.remove('bg-slate-100', 'hover:bg-slate-200', 'text-slate-800');
        
        // Apply Da Vinci Theme Classes
        if (currentPlayer === 'X') {
            // Black Tile Style
            clickedCell.classList.add('bg-slate-900', 'text-white', 'border-2', 'border-slate-700', 'shadow-md');
        } else {
            // White Tile Style
            clickedCell.classList.add('bg-white', 'text-slate-900', 'border-2', 'border-slate-300', 'shadow-md');
        }
    }

    function handlePlayerChange() {
        currentPlayer = currentPlayer === "X" ? "O" : "X";
        statusDisplay.innerHTML = currentPlayerTurn();
    }

    function handleResultValidation() {
        let roundWon = false;
        let winningLine = [];
        for (let i = 0; i <= 7; i++) {
            const winCondition = winningConditions[i];
            let a = gameState[winCondition[0]];
            let b = gameState[winCondition[1]];
            let c = gameState[winCondition[2]];
            if (a === '' || b === '' || c === '') {
                continue;
            }
            if (a === b && b === c) {
                roundWon = true;
                winningLine = winCondition;
                break;
            }
        }

        if (roundWon) {
            statusDisplay.innerHTML = winningMessage();
            gameActive = false;
            highlightWinningCells(winningLine);
            showWinnerModal(currentPlayer);
            return;
        }

        let roundDraw = !gameState.includes("");
        if (roundDraw) {
            statusDisplay.innerHTML = drawMessage();
            gameActive = false;
            showWinnerModal('draw');
            return;
        }

        handlePlayerChange();
    }

    function highlightWinningCells(indices) {
        indices.forEach(index => {
            // Da Vinci Green Highlight
            cells[index].classList.remove('border-slate-700', 'border-slate-300'); // Remove tile borders to avoid conflict or just override
            cells[index].classList.add('ring-4', 'ring-green-500', 'z-10'); // Use ring for glow effect
            // Optional: Change text color if needed, but keeping contrast is better
        });
    }

    function handleCellClick(clickedCellEvent) {
        const clickedCell = clickedCellEvent.target;
        const clickedCellIndex = parseInt(clickedCell.getAttribute('data-index'));

        if (gameState[clickedCellIndex] !== "" || !gameActive) {
            return;
        }

        // Online Check
        if (gameMode === 'online') {
            if (currentPlayer !== myColor) {
                return; // Not my turn
            }
            // Send move
            send('move', { index: clickedCellIndex });
        }

        // PvE Check (prevent clicking during AI turn)
        if (gameMode === 'pve' && currentPlayer === 'O') {
            return;
        }

        applyMove(clickedCellIndex, true);
        
        // AI Logic
        if (gameActive && gameMode === 'pve' && currentPlayer === 'O') {
            setTimeout(computerMove, 500);
        }
    }

    function applyMove(index, isLocal) {
        const cell = cells[index];
        handleCellPlayed(cell, index);
        handleResultValidation();
    }

    function showWinnerModal(winner) {
        modalOverlay.classList.remove('hidden');
        
        if (winner === 'draw') {
            winnerIcon.innerText = '🤝';
            winnerTitle.innerText = '平局!';
        } else {
            winnerIcon.innerText = '🏆';
            if (gameMode === 'online') {
                const isMe = winner === myColor;
                winnerTitle.innerText = isMe ? '你赢了!' : '你输了!';
            } else if (gameMode === 'pve') {
                const isPlayer = winner === 'X'; // Assuming player is always X in PvE for simplicity, or check aiPlayer
                // In PvE setup: player is X, AI is O usually.
                // Let's check currentPlayer logic. In PvE, if currentPlayer is O (AI), and roundWon is true, then AI won.
                // Wait, handleResultValidation uses currentPlayer. 
                // So if currentPlayer is 'X' and won, then 'X' won.
                winnerTitle.innerText = (winner === 'X') ? '你赢了!' : '电脑赢了!';
            } else {
                winnerTitle.innerText = `玩家 ${winner} 获胜!`;
            }
        }

        // Configure buttons based on mode
        if (gameMode === 'online' && !isHost) {
            modalRestartBtn.classList.add('hidden'); // Guests can't restart
        } else {
            modalRestartBtn.classList.remove('hidden');
        }
    }

    function resetGameInternal() {
        gameActive = true;
        currentPlayer = "X";
        gameState = ["", "", "", "", "", "", "", "", ""];
        statusDisplay.innerHTML = currentPlayerTurn();
        cells.forEach(cell => {
            cell.innerHTML = "";
            // Reset to default empty cell style
            cell.className = 'cell w-20 h-20 bg-slate-100 rounded-lg text-4xl font-bold flex items-center justify-center cursor-pointer hover:bg-slate-200 transition-colors text-slate-800';
        });
        modalOverlay.classList.add('hidden');
    }

    function handleRestartGame() {
        if (gameMode === 'online') {
            if (!isHost) {
                showToast('只有房主可以重新开始游戏', 'error');
                return;
            }
            send('restart');
        }
        resetGameInternal();
    }

    function updateBoardUI() {
        cells.forEach((cell, i) => {
            cell.innerHTML = gameState[i];
            
            // Reset to default first
            cell.className = 'cell w-20 h-20 bg-slate-100 rounded-lg text-4xl font-bold flex items-center justify-center cursor-pointer hover:bg-slate-200 transition-colors text-slate-800';
            
            if (gameState[i] !== "") {
                cell.classList.remove('bg-slate-100', 'hover:bg-slate-200', 'text-slate-800');
                if (gameState[i] === 'X') {
                    cell.classList.add('bg-slate-900', 'text-white', 'border-2', 'border-slate-700', 'shadow-md');
                } else {
                    cell.classList.add('bg-white', 'text-slate-900', 'border-2', 'border-slate-300', 'shadow-md');
                }
            }
        });

        // Update restart button state based on role
        if (gameMode === 'online') {
            if (!isHost) {
                restartBtn.disabled = true;
                restartBtn.classList.add('opacity-50', 'cursor-not-allowed');
                restartBtn.classList.remove('hover:bg-slate-700');
                restartBtn.title = "只有房主可以重新开始游戏";
            } else {
                restartBtn.disabled = false;
                restartBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                restartBtn.classList.add('hover:bg-slate-700');
                restartBtn.title = "";
            }
        } else {
            // Local modes always enabled
            restartBtn.disabled = false;
            restartBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            restartBtn.classList.add('hover:bg-slate-700');
            restartBtn.title = "";
        }
    }

    // --- UI State Management ---

    function startGame(mode, reset = true) {
        gameMode = mode;
        lobby.classList.add('hidden');
        gameBoard.classList.remove('hidden');
        
        let modeText = '本地双人';
        if (mode === 'pve') modeText = '人机对战';
        if (mode === 'online') modeText = '在线对战';
        gameModeDisplay.innerText = modeText;

        if (reset) resetGameInternal();
    }

    function resetToLobby() {
        if (conn) {
            conn.close();
            conn = null;
        }
        
        // 房主退出时清理 ID，确保下次创建新房间
        if (isHost && peer && !peer.destroyed) {
            peer.destroy();
            peer = null;
            localStorage.removeItem('tictactoe_peer_id');
            isHost = false;
        }
        
        lobby.classList.remove('hidden');
        gameBoard.classList.add('hidden');
        waitingSection.classList.add('hidden');
        createRoomSection.classList.remove('hidden');
        
        // Clean URL
        const url = new URL(window.location.href);
        url.searchParams.delete('room');
        window.history.pushState({}, '', url);
    }

    // --- AI Logic (Minimax) ---
    function computerMove() {
        if (!gameActive) return;

        let bestScore = -Infinity;
        let move;
        
        let emptyCells = gameState.reduce((acc, val, idx) => val === "" ? acc.concat(idx) : acc, []);
        
        if (gameState.filter(x => x !== "").length === 0 || (gameState.filter(x => x !== "").length === 1 && gameState[4] === "")) {
             if(gameState[4] === "") move = 4;
             else move = 0; 
        } else {
            for(let i = 0; i < 9; i++) {
                if(gameState[i] === "") {
                    gameState[i] = "O";
                    let score = minimax(gameState, 0, false);
                    gameState[i] = "";
                    if(score > bestScore) {
                        bestScore = score;
                        move = i;
                    }
                }
            }
        }

        if (move !== undefined) {
            applyMove(move, true);
        }
    }

    function minimax(board, depth, isMaximizing) {
        let result = checkWinner(board);
        if (result !== null) {
            return result;
        }

        if (isMaximizing) {
            let bestScore = -Infinity;
            for (let i = 0; i < 9; i++) {
                if (board[i] === "") {
                    board[i] = "O";
                    let score = minimax(board, depth + 1, false);
                    board[i] = "";
                    bestScore = Math.max(score, bestScore);
                }
            }
            return bestScore;
        } else {
            let bestScore = Infinity;
            for (let i = 0; i < 9; i++) {
                if (board[i] === "") {
                    board[i] = "X";
                    let score = minimax(board, depth + 1, true);
                    board[i] = "";
                    bestScore = Math.min(score, bestScore);
                }
            }
            return bestScore;
        }
    }

    function checkWinner(board) {
        for (let i = 0; i < 8; i++) {
            const [a, b, c] = winningConditions[i];
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                // Minimax needs score, but game logic just needs boolean or winner
                // This function was designed for minimax (returns 10/-10)
                // Let's keep it for minimax but handleResultValidation uses its own logic
                return board[a] === 'O' ? 10 : -10;
            }
        }
        if (!board.includes("")) {
            return 0;
        }
        return null;
    }

    // --- Event Listeners ---
    
    cells.forEach(cell => cell.addEventListener('click', handleCellClick));
    restartBtn.addEventListener('click', handleRestartGame);
    
    btnPvp.addEventListener('click', () => startGame('pvp'));
    btnPve.addEventListener('click', () => startGame('pve'));
    
    btnCreate.addEventListener('click', () => {
        isHost = true;
        resetGameInternal(); // Ensure fresh state when creating room
        waitingSection.classList.remove('hidden');
        createRoomSection.classList.add('hidden');
        const p = waitingSection.querySelector('p');
        if (p) p.innerText = "正在初始化...";

        // Reset copy button state
        btnCopy.disabled = true;
        btnCopy.classList.add('text-slate-300', 'cursor-not-allowed');
        btnCopy.classList.remove('text-orange-500', 'hover:text-orange-600', 'cursor-pointer');

        initPeer();
    });

    btnJoin.addEventListener('click', () => {
        const id = roomIdInput.value.trim();
        if (!id) return showToast('请输入房间 ID', 'error');
        joinRoom(id);
    });

    btnExit.addEventListener('click', () => {
        if (gameMode === 'online') {
            if (confirm('确定要退出房间吗？')) {
                send('leave');
                resetToLobby();
            }
        } else {
            resetToLobby();
        }
    });

    btnCopy.addEventListener('click', () => {
        shareUrlInput.select();
        document.execCommand('copy');
        const originalText = btnCopy.innerText;
        btnCopy.innerText = '已复制';
        setTimeout(() => btnCopy.innerText = originalText, 2000);
    });

    modalRestartBtn.addEventListener('click', handleRestartGame);
    modalExitBtn.addEventListener('click', () => {
        // Hide modal immediately for better UX
        modalOverlay.classList.add('hidden');
        
        if (gameMode === 'online') {
            send('leave');
        }
        
        // Clean up connection
        if (conn) {
            conn.close();
            conn = null;
        }
        
        // Host cleanup
        if (isHost && peer && !peer.destroyed) {
            peer.destroy();
            peer = null;
            localStorage.removeItem('tictactoe_peer_id');
            isHost = false;
        }

        // Navigate to online page
        window.location.href = 'index.html';
    });

    // Auto Join from URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        console.log('Auto joining room:', roomParam);
        roomIdInput.value = roomParam;
        
        // Auto click logic
        btnJoin.innerText = '连接中...';
        btnJoin.disabled = true;
        
        // 不需要手动调用 joinRoom 或 ensurePeerReady
        // 只需要初始化 Peer，initPeer 内部的 'open' 回调会处理自动加入逻辑
        initPeer();
    } else {
        // 如果没有 room 参数，也要初始化 Peer 以便用户可以创建房间
        // 或者不初始化，等用户点击按钮？
        // 黑白棋的逻辑是自动初始化的，我们也保持一致，方便用户随时创建房间
        // 但为了性能，可以只在需要时初始化。
        // 不过为了体验一致性，我们在这里不做任何操作，
        // 用户点击"创建房间"或"加入"时会调用 initPeer
        // 除非用户是房主恢复？
        // 实际上，黑白棋没有在 else 里初始化。
        // 但我们需要确保用户能够随时创建房间。
        // 目前按钮点击会调用 initPeer。
    }
});
