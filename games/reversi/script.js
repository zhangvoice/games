$(document).ready(function() {
    const ROWS = 8;
    const COLS = 8;
    const EMPTY = 0;
    const BLACK = 1;
    const WHITE = 2;

    // AI 权重 (位置策略)
    const WEIGHTS = [
        [100, -20, 10,  5,  5, 10, -20, 100],
        [-20, -50, -2, -2, -2, -2, -50, -20],
        [ 10,  -2, -1, -1, -1, -1,  -2,  10],
        [  5,  -2, -1, -1, -1, -1,  -2,   5],
        [  5,  -2, -1, -1, -1, -1,  -2,   5],
        [ 10,  -2, -1, -1, -1, -1,  -2,  10],
        [-20, -50, -2, -2, -2, -2, -50, -20],
        [100, -20, 10,  5,  5, 10, -20, 100]
    ];

    let board = [];
    let historyStack = [];
    let currentPlayer = BLACK;
    let lastMove = null; // 记录最后一步 {r, c}
    let isAnimating = false;
    let computerMoveTimer = null; // AI 移动计时器
    let gameMode = 'pvai'; // 游戏模式：'pvai' (人机), 'online' (联机)
    let aiPlayer = WHITE;
    let isGameStarted = false; // 游戏开始标志 (用于准备阶段)
    
    // 在线状态
    let peer = null;
    let conn = null;
    let myId = null;
    let isHost = false;
    let myColor = BLACK; // 在线模式下的己方颜色

    // 音效设置
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = new AudioContext();

    function playSound() {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const t = audioCtx.currentTime;
        const randomDetune = (Math.random() - 0.5) * 50; 
        const randomGain = 1.0 + (Math.random() - 0.5) * 0.2; 

        // 1. 点击声
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

        // 2. 闷响
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

        // 3. 敲击声
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

    const DIRECTIONS = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1]
    ];

    // --- 持久化存储 ---
    function saveGameState() {
        if (gameMode !== 'online') return;
        const roomId = new URLSearchParams(window.location.search).get('room') || myId;
        if (roomId) {
            const state = {
                board,
                currentPlayer,
                gameMode,
                isHost,
                myColor,
                lastMove,
                isGameStarted, // 持久化游戏开始状态
                historyStack // 持久化悔棋历史
            };
            localStorage.setItem(`reversi_state_${roomId}`, JSON.stringify(state));
        }
    }

    function loadGameState() {
        const roomId = new URLSearchParams(window.location.search).get('room') || myId;
        if (roomId) {
            const saved = localStorage.getItem(`reversi_state_${roomId}`);
            if (saved) {
                try {
                    return JSON.parse(saved);
                } catch (e) {
                    console.error('Error parsing saved state', e);
                }
            }
        }
        return null;
    }

    function clearSavedState() {
        const roomId = new URLSearchParams(window.location.search).get('room') || myId;
        if (roomId) {
            localStorage.removeItem(`reversi_state_${roomId}`);
        }
    }

    function initPeer() {
        const savedId = localStorage.getItem('reversi_peer_id');
        
        // 使用 peer-config.js 中的共享配置
        peer = new Peer(savedId, PEER_CONFIG);

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

        // 关闭逻辑保持不变
        peer.on('close', () => {
            console.log('Peer destroyed');
            conn = null;
        });

        peer.on('open', (id) => {
            myId = id;
            localStorage.setItem('reversi_peer_id', id);
            console.log('My peer ID is: ' + id);
            
            const url = new URL(window.location.href);
            url.searchParams.set('room', id);
            $('#share-url').val(url.toString());
            
            // 启用复制按钮
            $('#btn-copy').prop('disabled', false)
                .removeClass('text-slate-300 cursor-not-allowed')
                .addClass('text-orange-500 hover:text-orange-600 cursor-pointer');

            // 处理重连 / 恢复
            const urlParams = new URLSearchParams(window.location.search);
            const roomParam = urlParams.get('room');

            if (roomParam) {
                if (roomParam === id) {
                    // 房主刷新页面
                    isHost = true;
                    const savedState = loadGameState();
                    if (savedState && savedState.isHost) {
                        board = savedState.board;
                        currentPlayer = savedState.currentPlayer;
                        gameMode = savedState.gameMode;
                        myColor = savedState.myColor;
                        lastMove = savedState.lastMove; // 恢复最后一步
                        if (typeof savedState.isGameStarted !== 'undefined') isGameStarted = savedState.isGameStarted;
                        if (savedState.historyStack) historyStack = savedState.historyStack; // 恢复历史记录
                        
                        createBoardGrid();
                        updateUI();
                        
                        $('#lobby').addClass('hidden');
                        $('#game-board').removeClass('hidden');
                        $('#waiting-section').removeClass('hidden').find('p').text('正在恢复房间...');
                    } else {
                        $('#waiting-section').removeClass('hidden').find('p').text('房间已创建，等待对手加入...');
                    }
                } else {
                    // 访客刷新或加入
                    // 检查是否有该房间的保存状态
                    const savedState = loadGameState();
                    if (savedState && !savedState.isHost) {
                        // 访客恢复
                        isHost = false;
                        board = savedState.board;
                        currentPlayer = savedState.currentPlayer;
                        gameMode = savedState.gameMode;
                        myColor = savedState.myColor;
                        lastMove = savedState.lastMove; // 恢复最后一步
                        if (typeof savedState.isGameStarted !== 'undefined') isGameStarted = savedState.isGameStarted;
                        if (savedState.historyStack) historyStack = savedState.historyStack; // 恢复历史记录

                        createBoardGrid();
                        updateUI();
                        
                        $('#lobby').addClass('hidden');
                        $('#game-board').removeClass('hidden');
                        
                        // 我们仍然需要连接 Peer 发送移动
                        joinRoom(roomParam);
                    } else {
                        // 新访客加入
                        if (!isHost) joinRoom(roomParam);
                    }
                }
            } else {
                // 如果没有 room 参数，说明是新创建的房间（URL 还没更新，但我们已经拿到了 id）
                // 或者是清除了 URL 参数后的情况
                if (isHost) {
                    $('#waiting-section').removeClass('hidden').find('p').text('房间已创建，等待对手加入...');
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
                    localStorage.removeItem('reversi_peer_id'); // 清除损坏或占用的 ID
                    break;
                default:
                    msg = '连接出错: ' + err.type;
            }
            alert(msg);
        });
    }

    function joinRoom(id) {
        isHost = false;
        $('#waiting-section').removeClass('hidden').find('p').text('正在连接房间...');
        $('#create-room-section').addClass('hidden');
        
        if (!peer) {
            initPeer();
            // 等待 open 事件后再连接
            const checkPeer = setInterval(() => {
                if (peer && !peer.disconnected && !peer.destroyed && peer.id) {
                    clearInterval(checkPeer);
                    conn = peer.connect(id);
                    setupConnection();
                }
            }, 100);
        } else {
            conn = peer.connect(id);
            setupConnection();
        }
    }

    function setupConnection() {
        conn.on('open', () => {
            $('#lobby').addClass('hidden');
            $('#game-board').removeClass('hidden');
            gameMode = 'online';
            
            // 启动心跳检测
            startHeartbeat();
            
            if (isHost) {
                // 房主初始化游戏
                // 房主默认黑棋，访客白棋
                myColor = BLACK;
                
                // 仅当棋盘为空/全新时重置（非恢复状态）
                // 检查棋盘是否超过初始布局
                const isInitial = board.flat().filter(c => c !== EMPTY).length <= 4;
                
                // 如果我们恢复了状态 (isGameStarted 可能为 true)，则不重置
                // 但如果是新连接/刷新导致状态丢失但 ID 保持，确保 UI 一致
                
                if (isInitial && !isGameStarted) {
                    resetGame(false); // 暂时不广播
                } else {
                    // 恢复状态，确保 UI 反映“开始游戏”按钮是否隐藏
                    if (isGameStarted) {
                        $('#start-game-btn').addClass('hidden');
                    } else {
                        $('#start-game-btn').removeClass('hidden');
                    }
                }
                
                // 初始显示房主的颜色设置
                if (!isGameStarted) {
                     $('#color-setting').removeClass('hidden');
                     $('#start-game-btn').removeClass('hidden');
                } else {
                     $('#start-game-btn').addClass('hidden');
                }
                
                // 发送初始化信息给访客
                send('init', {
                    board: board,
                    currentPlayer: currentPlayer,
                    lastMove: lastMove,
                    isGameStarted: isGameStarted,
                    hostColor: myColor
                });
            } else {
                showToast('已加入房间', 'success');
                myColor = WHITE; // 默认值，将在同步时更新
                // 请求状态同步，以防重连较晚
                send('request-sync');
            }
            updateUI();
        });

        conn.on('data', (data) => {
            handleMessage(data);
        });

        conn.on('close', () => {
            console.log('Connection closed');
            stopHeartbeat();
            showToast('连接已断开', 'error');
        });
    }

    // 心跳逻辑，保持连接活跃
    let heartbeatInterval;
    function startHeartbeat() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (conn && conn.open) {
                conn.send({ type: 'heartbeat' });
            }
        }, 5000); // 每 5 秒发送一次
    }

    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }

    function send(type, data = {}) {
        if (conn && conn.open) {
            conn.send({ type, ...data });
        }
    }

    function performOnlineUndo() {
        if (historyStack.length === 0) return;
        
        // 撤销一步（回退到上一个状态）
        // 在线对战通常意味着双方各走一步，如果我悔棋，可能是因为我刚走错，或者对方刚走错
        // 简单起见，我们每次悔棋回退“一个动作”
        // 但由于 historyStack 记录的是每次落子前的状态，pop 一次就是回退一步
        
        const targetState = historyStack.pop();
        if (targetState) {
            board = targetState.board;
            currentPlayer = targetState.player;
            // 注意：我们可能需要同步 lastMove，但 historyStack 目前没存 lastMove
            // 简单处理：清空 lastMove 或不做处理（UI 可能会显示旧的）
            // 如果要完美支持，historyStack 应该存 lastMove
            lastMove = null; // 暂时重置
            
            updateUI();
            updateUndoButton();
            saveGameState(); // 保存新状态
        }
    }

    function handleMessage(msg) {
        switch(msg.type) {
            case 'heartbeat':
                // 什么都不做，仅保持连接
                break;
            case 'undo-request':
                if (confirm('对方请求悔棋，是否同意？')) {
                    performOnlineUndo(); // 我方也执行悔棋
                    send('undo-accept');
                } else {
                    send('undo-reject');
                }
                break;
            case 'undo-accept':
                showToast('对方同意了悔棋请求', 'success');
                performOnlineUndo(); // 对方同意后，我方执行悔棋
                break;
            case 'undo-reject':
                showToast('对方拒绝了悔棋请求', 'error');
                break;
            case 'init':
                board = msg.board;
                currentPlayer = msg.currentPlayer;
                if (msg.lastMove) lastMove = msg.lastMove; // 同步最后一步
                if (typeof msg.isGameStarted !== 'undefined') isGameStarted = msg.isGameStarted;
                
                // 根据 hostColor 同步颜色
                if (msg.hostColor) {
                    if (isHost) {
                        myColor = msg.hostColor;
                    } else {
                        myColor = (msg.hostColor === BLACK) ? WHITE : BLACK;
                        // 更新访客的 UI 以显示他们自己的颜色 (只读)
                        // 如果房主是黑 -> 访客是白 -> 显示白
                        // 如果房主是白 -> 访客是黑 -> 显示黑
                        const guestColorStr = (myColor === BLACK) ? 'black' : 'white';
                        $('#color-toggle .toggle-btn').removeClass('active');
                        $(`#color-toggle .toggle-btn[data-value="${guestColorStr}"]`).addClass('active');
                    }
                }

                createBoardGrid(); // 确保网格存在
                updateUI();
                break;
            case 'move':
                makeMove(msg.r, msg.c, false); // false = 不回传
                break;
            case 'restart':
                resetGame(false); // false = 不回传
                showToast('房主重新开始了游戏', 'success');
                break;
            case 'start-game':
                isGameStarted = true;
                showToast('游戏开始！', 'success');
                updateUI();
                break;
            case 'update-settings':
                // 游戏开始前同步设置 (颜色)
                if (!isHost) {
                    const hostColor = msg.hostColor;
                    myColor = (hostColor === BLACK) ? WHITE : BLACK;
                    
                    // 更新 UI 以显示访客的颜色
                    const guestColorStr = (myColor === BLACK) ? 'black' : 'white';
                    $('#color-toggle .toggle-btn').removeClass('active');
                    $(`#color-toggle .toggle-btn[data-value="${guestColorStr}"]`).addClass('active');
                    
                    updateUI();
                }
                break;
            case 'request-sync':
                if (isHost) {
                    send('init', {
                        board: board,
                        currentPlayer: currentPlayer,
                        lastMove: lastMove,
                        isGameStarted: isGameStarted,
                        hostColor: myColor
                    });
                }
                break;
            case 'room-closed':
                showToast('房主已退出房间', 'error');
                setTimeout(() => exitRoom(true), 2000); // 2秒后强制退出
                break;
        }
    }

    // --- 游戏逻辑 ---

    function initGame() {
        createBoardGrid();
        // 暂时不重置游戏，等待大厅选择
        
        // 最初对访客隐藏“重新开始”按钮 (后续由 updateUI 逻辑更新)
        $('#restart-btn').addClass('hidden'); 
        
        setupEventListeners(); // 确保监听器已附加！
    }

    function createBoardGrid() {
        const $board = $('#board');
        $board.empty();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const $cell = $('<div>')
                    .addClass('cell')
                    .attr('data-r', r)
                    .attr('data-c', c);
                $board.append($cell);
            }
        }
    }

    function resetGame(broadcast = true) {
        if (computerMoveTimer) clearTimeout(computerMoveTimer);
        
        board = Array(ROWS).fill(null).map(() => Array(COLS).fill(EMPTY));
        historyStack = [];
        lastMove = null; // 重置最后一步
        updateUndoButton();
        
        // 设置逻辑
        if (gameMode === 'pvai') {
            $('#color-setting').removeClass('hidden');
            $('#start-game-btn').addClass('hidden'); // 本地模式无需开始按钮
            isGameStarted = true; // 本地模式自动开始
            // 检查 UI 颜色选择
            const userColor = $('#color-toggle .active').data('value'); 
            aiPlayer = (userColor === 'black') ? WHITE : BLACK;
        } else if (gameMode === 'pvp') {
            $('#color-setting').addClass('hidden');
            $('#start-game-btn').addClass('hidden');
            isGameStarted = true; // 本地模式自动开始
            aiPlayer = null;
        } else {
            // 在线模式
            aiPlayer = null; 
            isGameStarted = false; // 需要手动开始
            
            if (isHost) {
                $('#color-setting').removeClass('hidden');
                $('#start-game-btn').removeClass('hidden');
                
                // 从 UI 获取当前选择，默认黑色
                const userColor = $('#color-toggle .active').data('value');
                myColor = (userColor === 'black') ? BLACK : WHITE;
            } else {
                $('#color-setting').removeClass('hidden'); // 访客可见
                $('#start-game-btn').addClass('hidden');
                // 访客颜色通过 init/sync 设置
            }
        }

        board[3][3] = WHITE;
        board[3][4] = BLACK;
        board[4][3] = BLACK;
        board[4][4] = WHITE;

        currentPlayer = BLACK; 
        isAnimating = false;

        updateUI();
        $('#modal-overlay').addClass('hidden');

        if (gameMode === 'pvai' && aiPlayer === BLACK) {
             setTimeout(computerMove, 800);
        }

        if (gameMode === 'online' && isHost && broadcast) {
            send('restart');
            send('init', {
                board: board,
                currentPlayer: currentPlayer
            });
        }
    }

    function isValidMove(r, c, player) {
        if (board[r][c] !== EMPTY) return false;

        const opponent = player === BLACK ? WHITE : BLACK;

        for (let [dr, dc] of DIRECTIONS) {
            let nr = r + dr;
            let nc = c + dc;
            let hasOpponent = false;

            while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                if (board[nr][nc] === opponent) {
                    hasOpponent = true;
                } else if (board[nr][nc] === player) {
                    if (hasOpponent) return true; 
                    break;
                } else {
                    break; 
                }
                nr += dr;
                nc += dc;
            }
        }
        return false;
    }

    function getValidMoves(player) {
        const moves = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (isValidMove(r, c, player)) {
                    moves.push({r, c});
                }
            }
        }
        return moves;
    }

    function makeMove(r, c, broadcast = true) {
        if (isAnimating) return;
        if (!isGameStarted) return; // 游戏开始前阻止落子
        if (board[r][c] !== EMPTY) return;
        
        // 在线检查: 如果不是我的回合且我试图落子 (通过点击)，则忽略
        if (gameMode === 'online' && broadcast && currentPlayer !== myColor) return;

        saveState();
        isAnimating = true;
        playSound();

        board[r][c] = currentPlayer;
        lastMove = { r, c }; // 记录最后一步
        
        const $cell = $(`.cell[data-r="${r}"][data-c="${c}"]`);
        const $disc = $('<div>').addClass('disc show').addClass(currentPlayer === BLACK ? 'black' : 'white');
        $cell.append($disc);

        const opponent = currentPlayer === BLACK ? WHITE : BLACK;
        const discsToFlip = [];

        for (let [dr, dc] of DIRECTIONS) {
            let nr = r + dr;
            let nc = c + dc;
            let tempDiscs = [];

            while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                if (board[nr][nc] === opponent) {
                    tempDiscs.push({r: nr, c: nc});
                } else if (board[nr][nc] === currentPlayer) {
                    if (tempDiscs.length > 0) {
                        discsToFlip.push(...tempDiscs);
                    }
                    break;
                } else {
                    break;
                }
                nr += dr;
                nc += dc;
            }
        }

        discsToFlip.forEach(pos => {
            const $d = $(`.cell[data-r="${pos.r}"][data-c="${pos.c}"] .disc`);
            $d.addClass('flipping');
        });

        setTimeout(() => {
            discsToFlip.forEach(pos => {
                board[pos.r][pos.c] = currentPlayer;
            });
            updateUI(); 
        }, 200);

        setTimeout(() => {
            $('.disc').removeClass('flipping');
            isAnimating = false;
            
            // 如果在线，广播移动
            if (gameMode === 'online' && broadcast) {
                send('move', { r, c });
            }

            switchTurn();
        }, 400);
    }

    function switchTurn() {
        const opponent = currentPlayer === BLACK ? WHITE : BLACK;
        const opponentMoves = getValidMoves(opponent);

        if (opponentMoves.length > 0) {
            currentPlayer = opponent;
        } else {
            const myMoves = getValidMoves(currentPlayer);
            if (myMoves.length > 0) {
                // 如果是本地玩家在玩 (或观战)，显示警告
                // 在线模式下，只在影响我或通用消息时显示
                setTimeout(() => alert((opponent === BLACK ? "黑方" : "白方") + " 无子可落，跳过回合！"), 100);
            } else {
                setTimeout(endGame, 500);
                return;
            }
        }
        
        updateUI();

        if (gameMode === 'pvai' && currentPlayer === aiPlayer) {
            computerMoveTimer = setTimeout(computerMove, 800);
        }
    }

    function computerMove() {
        if (gameMode !== 'pvai' || currentPlayer !== aiPlayer) return;

        const validMoves = getValidMoves(currentPlayer);
        if (validMoves.length === 0) return;

        let bestMove = null;
        let maxScore = -Infinity;

        validMoves.forEach(move => {
            let score = WEIGHTS[move.r][move.c];
            score += Math.random() * 2; 
            if (score > maxScore) {
                maxScore = score;
                bestMove = move;
            }
        });

        if (bestMove) {
            makeMove(bestMove.r, bestMove.c);
        }
    }

    function saveState() {
        const boardCopy = board.map(row => [...row]);
        historyStack.push({
            board: boardCopy,
            player: currentPlayer,
            lastMove: lastMove // 保存 lastMove
        });

        // 在线模式处理持久化
        if (gameMode === 'online') {
            saveGameState();
            // 在线模式也记录历史，以便支持悔棋，但不要立即 return
        }

        updateUndoButton();
    }

    function undo() {
        if (isAnimating || historyStack.length === 0) return;

        if (gameMode === 'online') {
             if (confirm('是否向对方请求悔棋？')) {
                 showToast('已发送悔棋请求...', 'info');
                 send('undo-request');
             }
             return;
        }

        let steps = 1;
        if (gameMode === 'pvai') {
            if (currentPlayer !== aiPlayer) {
                if (historyStack.length < 2) return; 
                steps = 2;
            } else {
                steps = 1;
            }
        }

        if (historyStack.length < steps) steps = historyStack.length;
        if (steps === 0) return;

        let targetState = null;
        for (let i = 0; i < steps; i++) {
            targetState = historyStack.pop();
        }

        if (targetState) {
            board = targetState.board;
            currentPlayer = targetState.player;
            updateUI();
            updateUndoButton();
            $('#modal-historyStvck.elngth > 0ay').addClass('hidden');
        }
    }

    function updateUndoButton() {
        let canUndo = false;
        if (gameMode === 'online') {
            // 只有当历史栈顶记录的是“我的回合”时，说明导致当前状态的那一步棋是我下的
            const lastState = historyStack.length > 0 ? historyStack[historyStack.length - 1] : null;
            canUndo = lastState && lastState.player === myColor;
        } else if (gameMode === 'pvp') { // 移除了 pvp 但逻辑保留以防万一
            canUndo = historyStack.length > 0;
        } else {
            // 
            if (currentPlayer === aiPlayer) {
                canUndo = historyStack.length > 0;
            } else {
                canUndo = historyStack.length >= 2;
            }
        }
        $('#undo-btn').prop('disabled', !canUndo);
    }

    function updateUI() {
        // 确保棋盘已初始化
        if (!board || !board.length || !board[0]) return;

        // 更新 UI 时保存状态，以防万一
        saveGameState();

        // 渲染棋盘
        $('.cell').each(function() {
            const r = parseInt($(this).attr('data-r'));
            const c = parseInt($(this).attr('data-c'));
            // 索引安全检查
            if (board[r] && typeof board[r][c] !== 'undefined') {
                const cellVal = board[r][c];
                
                $(this).removeClass('valid-move last-move'); // 清除 last-move 类
                
                // 高亮最后一步
                if (lastMove && lastMove.r === r && lastMove.c === c) {
                    $(this).addClass('last-move');
                }

                let $disc = $(this).find('.disc');
                
                if (cellVal === EMPTY) {
                    if ($disc.length) $disc.remove();
                } else {
                    if (!$disc.length) {
                        $disc = $('<div>').addClass('disc');
                        $(this).append($disc);
                        void $disc[0].offsetWidth; 
                        $disc.addClass('show');
                    }
                    $disc.removeClass('black white');
                    $disc.addClass(cellVal === BLACK ? 'black' : 'white');
                }
            }
        });

        const blackScore = countScore(BLACK);
        const whiteScore = countScore(WHITE);
        $('#score-black').text(blackScore);
        $('#score-white').text(whiteScore);

        $('.player-score').removeClass('active');
        if (currentPlayer === BLACK) $('.player-score.black').addClass('active');
        else $('.player-score.white').addClass('active');

        let statusText = `当前回合: ${currentPlayer === BLACK ? '黑方' : '白方'}`;
        if (gameMode === 'online') {
            if (!isGameStarted) {
                statusText = isHost ? "请选择执子颜色并开始游戏" : "等待房主开始游戏...";
                // 房主启用设置，访客禁用
                if (isHost) {
                     $('#color-setting').removeClass('disabled');
                     $('#color-toggle .toggle-btn').prop('disabled', false);
                } else {
                     $('#color-setting').addClass('disabled');
                     $('#color-toggle .toggle-btn').prop('disabled', true);
                }
            } else {
                statusText += (currentPlayer === myColor ? ' (你)' : ' (对手)');
                // 游戏进行中禁用设置
                $('#color-setting').addClass('disabled');
                $('#color-toggle .toggle-btn').prop('disabled', true);
            }
            
            // 根据房主状态显示/隐藏重新开始按钮
            if (isHost) {
                // 仅当游戏开始或结束时显示重新开始
                $('#restart-btn').removeClass('hidden');
            } else {
                $('#restart-btn').addClass('hidden');
            }
        } else {
            // 人机对战 (PvAI)
            $('#restart-btn').removeClass('hidden');
            $('#color-setting').removeClass('disabled'); // 允许切换但会重置游戏
            $('#color-toggle .toggle-btn').prop('disabled', false);
        }
        $('#status-message').text(statusText);

        // 显示有效移动
        // 在线模式下，只有轮到我且游戏已开始才显示提示
        if (gameMode !== 'online' || (isGameStarted && currentPlayer === myColor)) {
            const validMoves = getValidMoves(currentPlayer);
            validMoves.forEach(move => {
                $(`.cell[data-r="${move.r}"][data-c="${move.c}"]`).addClass('valid-move');
            });
        }
    }

    function countScore(player) {
        let count = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c] === player) count++;
            }
        }
        return count;
    }

    function endGame() {
        const blackScore = countScore(BLACK);
        const whiteScore = countScore(WHITE);
        
        let winnerClass = 'draw';
        let winnerTitle = '平局';
        
        if (blackScore > whiteScore) {
            winnerClass = 'black';
            winnerTitle = '黑方获胜!';
        } else if (whiteScore > blackScore) {
            winnerClass = 'white';
            winnerTitle = '白方获胜!';
        }

        const $icon = $('#winner-display .winner-icon');
        $icon.removeClass('black white draw').addClass(winnerClass);
        $('#winner-display .winner-title').text(winnerTitle);

        $('#end-score-black').text(blackScore);
        $('#end-score-white').text(whiteScore);

        const total = blackScore + whiteScore;
        const blackPercent = total === 0 ? 50 : (blackScore / total) * 100;
        $('#score-bar-fill').css('width', `${blackPercent}%`);

        // 隐藏访客的模态框重新开始按钮
        if (gameMode === 'online' && !isHost) {
            $('#modal-restart-btn').addClass('hidden');
        } else {
            $('#modal-restart-btn').removeClass('hidden');
        }

        $('#modal-overlay').removeClass('hidden');
    }

    function exitRoom(isForced = false) {
        if (isForced || confirm('确定要退出房间吗？')) {
            clearSavedState();
            
            // 如果房主主动退出，通知访客
            if (isHost && !isForced) {
                send('room-closed');
            }

            // 清理 PeerJS 连接
            if (conn) {
                conn.close();
                conn = null;
            }
            // Peer 实例应保持活跃以供大厅使用，但我们需要重置游戏状态
            
            // 重置 URL 以移除房间 ID
            const url = new URL(window.location.href);
            url.searchParams.delete('room');
            window.history.pushState({}, '', url);
            
            // 重置 UI 到大厅
            $('#game-board').addClass('hidden');
            $('#lobby').removeClass('hidden');
            $('#waiting-section').addClass('hidden');
            $('#create-room-section').removeClass('hidden');
            
            // 重新启用按钮
            $('#btn-ai, #btn-pvp, #btn-create, #btn-join').prop('disabled', false);
            $('#btn-join').text('加入');
            $('#btn-create').text('创建联机房间');
            $('#btn-ai').text('人机对战');
            
            // 重置游戏内部状态
            gameMode = 'pvai'; // 默认
            isHost = false;
            isGameStarted = false; // 重置游戏开始标志
            stopHeartbeat();
            
            // 重新初始化游戏以清空棋盘和重置变量
            resetGame(false);
        }
    }

    function setupEventListeners() {
        $('#board').on('click', '.cell', function() {
            if (isAnimating) return;
            if (gameMode === 'pvai' && currentPlayer === aiPlayer) return;
            // 在线检查在 makeMove 中完成

            const r = parseInt($(this).attr('data-r'));
            const c = parseInt($(this).attr('data-c'));

            if (isValidMove(r, c, currentPlayer)) {
                makeMove(r, c);
            }
        });
        
        // 开始游戏按钮
        $('#start-game-btn').click(function() {
            if (gameMode === 'online' && isHost) {
                isGameStarted = true;
                $('#start-game-btn').addClass('hidden');
                updateUI();
                send('start-game');
                showToast('游戏开始！', 'success');
            }
        });

        $('#restart-btn, #modal-restart-btn').click(function() {
            if (gameMode === 'online' && !isHost) return; // 只有房主可以重新开始
            resetGame();
        });

        // 人机对战按钮
        $('#btn-ai').click(function() {
            $('#lobby').addClass('hidden');
            $('#game-board').removeClass('hidden');
            gameMode = 'pvai';
            resetGame();
        });

        // 双人对战按钮
        $('#btn-pvp').click(function() {
            $('#lobby').addClass('hidden');
            $('#game-board').removeClass('hidden');
            gameMode = 'pvp';
            resetGame();
        });

        // 创建房间按钮
        $('#btn-create').click(function() {
            isHost = true;
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden').find('p').text('正在创建房间...');
            initPeer();
        });

        // 加入房间按钮
        $('#btn-join').click(function() {
            const id = $('#room-id-input').val().trim();
            if (id) {
                $('#btn-join').prop('disabled', true).text('连接中...');
                joinRoom(id);
            }
        });

        // 退出房间按钮
        $('#exit-btn').click(function() {
            exitRoom();
        });

        // 复制按钮
        $('#btn-copy').click(function() {
            const $input = $('#share-url');
            const text = $input.val();
            if (!text) return;
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    const $btn = $(this);
                    const originalText = $btn.text();
                    $btn.text('已复制').addClass('text-green-500');
                    setTimeout(() => $btn.text(originalText).removeClass('text-green-500'), 2000);
                });
            } else {
                $input.select();
                document.execCommand('copy');
                const $btn = $(this);
                const originalText = $btn.text();
                $btn.text('已复制').addClass('text-green-500');
                setTimeout(() => $btn.text(originalText).removeClass('text-green-500'), 2000);
            }
        });

        // 设置切换 (AI 颜色)
        $('.toggle-group .toggle-btn').click(function() {
            const $this = $(this);
            const $group = $this.closest('.toggle-group');
            
            // 在线模式下，只有房主可以切换，且只能在游戏开始前
            if (gameMode === 'online') {
                if (!isHost || isGameStarted) return;
                
                $group.find('.toggle-btn').removeClass('active');
                $this.addClass('active');
                
                // 更新本地状态并同步
                const userColor = $this.data('value');
                myColor = (userColor === 'black') ? BLACK : WHITE;
                
                send('update-settings', {
                    hostColor: myColor
                });
                return; // 不重置游戏，仅更新设置
            }

            $group.find('.toggle-btn').removeClass('active');
            $this.addClass('active');
            resetGame();
        });

        $('#undo-btn').click(function() {
            undo();
        });
    }

    // 通过 URL 自动加入
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('room')) {
        $('#btn-ai').prop('disabled', true); // 自动加入时禁用其他按钮
        $('#btn-create').prop('disabled', true);
        initPeer(); // initPeer 处理加入逻辑
    } else {
        // 仅当不立即自动加入时运行 setupEventListeners，
        // 或者确保它无论如何都运行但内部逻辑处理禁用状态。
        // 实际上，initGame 会调用它。
    }

    // 移动此调用以确保其运行！
    initGame(); 

    // 提示通知 (Toast)
    function showToast(msg, type = 'info') {
        const $feedback = $('<div>')
            .addClass('fixed top-24 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg font-bold z-50 transition-all duration-300 translate-y-0 opacity-100')
            .text(msg);
        
        if (type === 'error') {
            $feedback.addClass('bg-red-100 text-red-600 border border-red-200');
        } else if (type === 'success') {
            $feedback.addClass('bg-green-100 text-green-600 border border-green-200');
        } else {
            $feedback.addClass('bg-white text-slate-800 border border-slate-200');
        }

        $('body').append($feedback);

        setTimeout(() => {
            $feedback.addClass('-translate-y-4 opacity-0');
            setTimeout(() => $feedback.remove(), 300);
        }, 2000);
    }
});
