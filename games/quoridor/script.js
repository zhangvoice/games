$(document).ready(function() {
    console.log('Quoridor script loaded');

    // 常量定义
    const ROWS = 9;
    const COLS = 9;
    const WALL_COUNT_2P = 10;
    const WALL_COUNT_4P = 5;
    const P1 = 1;
    const P2 = 2;
    const P3 = 3;
    const P4 = 4;
    
    // 游戏状态
    let players = {}; // 动态初始化
    
    // 墙的记录: { r, c, orientation: 'h'|'v' }
    // 坐标 (r, c) 代表交叉点。r in 0..7, c in 0..7
    let placedWalls = []; 
    
    let currentPlayer = P1;
    let myId = null; // Peer ID
    let isHost = false;
    let gameMode = 'pvai'; // 'pvai', 'pvp', 'online'
    let playerCount = 2; // 2 or 4
    let myPlayerId = P1; // 在线模式下我是 P1..P4
    let isGameStarted = false;
    let isAnimating = false;
    
    // 墙的预览状态
    let wallOrientation = 'h'; // 'h' or 'v'
    let hoveredIntersection = null; // {r, c}

    // 联机相关
    let peer = null;
    let connections = []; // Array of connections for host
    let conn = null; // Connection for guest
    let historyStack = [];

    // 音效上下文
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx;
    try {
        audioCtx = new AudioContext();
    } catch (e) {
        console.warn('AudioContext not supported or blocked', e);
    }

    function playSound(type = 'move') {
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(e => console.log(e));
        const t = audioCtx.currentTime;
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'move') {
            osc.frequency.setValueAtTime(400, t);
            osc.frequency.exponentialRampToValueAtTime(600, t + 0.1);
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
            osc.start(t);
            osc.stop(t + 0.1);
        } else if (type === 'wall') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, t);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
            osc.start(t);
            osc.stop(t + 0.15);
        } else if (type === 'win') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(400, t);
            osc.frequency.setValueAtTime(600, t + 0.2);
            osc.frequency.setValueAtTime(800, t + 0.4);
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.linearRampToValueAtTime(0, t + 1.0);
            osc.start(t);
            osc.stop(t + 1.0);
        }
    }

    // --- 初始化与 DOM ---

    // --- Toast Notification ---
    function showToast(message, type = 'info') {
        const $toast = $('<div>')
            .addClass('px-4 py-2 rounded-lg shadow-lg text-white font-bold transition-all transform translate-y-4 opacity-0')
            .text(message);
        
        if (type === 'error') {
            $toast.addClass('bg-red-500');
        } else if (type === 'success') {
            $toast.addClass('bg-green-500');
        } else {
            $toast.addClass('bg-slate-800');
        }
        
        $('#toast-container').append($toast);
        
        // Animation
        setTimeout(() => {
            $toast.removeClass('translate-y-4 opacity-0');
        }, 10);
        
        setTimeout(() => {
            $toast.addClass('translate-y-4 opacity-0');
            setTimeout(() => $toast.remove(), 300);
        }, 3000);
    }

    function initGame() {
        console.log('initGame called');
        try {
            createBoard();
            console.log('createBoard done');
            updateUI();
            console.log('updateUI done');
            setupEvents();
            console.log('setupEvents done');
        } catch (e) {
            console.error('Error during initGame:', e);
        }
        
        // 自动检查 URL 加入房间
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('room')) {
            // 立即切换到等待界面
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden');
            $('#waiting-message').text('正在连接服务器...');
            initPeer();
        }
    }

    function createBoard() {
        const $board = $('#board');
        const $wallLayer = $('#wall-layer');
        $board.empty();
        $wallLayer.empty();

        // 1. 创建格子 (Cells)
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const $cell = $('<div>')
                    .addClass('cell')
                    .attr('data-r', r)
                    .attr('data-c', c);
                $board.append($cell);
            }
        }

        // 2. 创建墙的交互热区 (Intersections)
        // 8x8 intersections
        // 我们需要计算位置。由于 CSS Grid gap 的存在，我们可以直接用百分比或者计算像素？
        // 为了响应式，最好在 resize 时重新计算，或者使用相对定位的容器。
        // 这里为了简单，我们使用 JS 在每次渲染时计算位置，或者使用一个覆盖的 Grid。
        // 实际上，我们可以创建一个与 Board 同样大小的绝对定位层，并在其中放置热区。
        
        // 更好的方法：在每个 Cell 内部添加 invisible handles？不行，墙在间隙。
        // 我们可以简单地在 board container 上监听 mousemove，计算最近的 intersection。
        
        // 这里采用生成透明 div 的方式，布局与 grid 对齐
        // Intersection (r, c) 位于 Cell(r, c) 的右下角间隙中心
        
        // 获取 CSS 变量
        const style = getComputedStyle(document.documentElement);
        // 这里的计算依赖 CSS 变量，但在 JS 中直接计算偏移量可能更准。
        // 我们在 updateUI 或 resize 时更新热区位置。
        createWallHotspots();
    }
    
    function createWallHotspots() {
        const $wallLayer = $('#wall-layer');
        $wallLayer.empty();
        
        // 8 rows of gaps, 8 cols of gaps
        for (let r = 0; r < ROWS - 1; r++) {
            for (let c = 0; c < COLS - 1; c++) {
                const $hotspot = $('<div>')
                    .addClass('wall-hotspot')
                    .attr('data-wr', r)
                    .attr('data-wc', c)
                    .css({
                        position: 'absolute',
                        width: '20px', // 足够大以捕捉鼠标
                        height: '20px',
                        zIndex: 30,
                        cursor: 'pointer',
                        pointerEvents: 'auto', // 必须显式开启，因为父层是 pointer-events: none
                        // Debug: visualize hotspot
                        // backgroundColor: 'rgba(255, 0, 0, 0.3)', 
                        // borderRadius: '50%'
                    });
                $wallLayer.append($hotspot);
            }
        }
        updateLayout();
    }

    function updateLayout() {
        // 计算每个 hotspot 的精确位置
        if ($('#game-board').hasClass('hidden')) return; 

        const $cells = $('.cell');
        if ($cells.length === 0) return;
        
        const cell0 = $(`.cell[data-r="0"][data-c="0"]`)[0];
        const cell1 = $(`.cell[data-r="0"][data-c="1"]`)[0]; // 使用同一行的下一个格子计算水平 gap
        
        if (!cell0 || !cell1) return;
        
        // 使用 offsetLeft/Top 计算，这相对于 offsetParent (#board)，不受 transform 影响
        const cellWidth = cell0.offsetWidth;
        const cellHeight = cell0.offsetHeight;
        
        // Gap = NextCell.Left - (CurrCell.Left + CurrCell.Width)
        const gapSize = cell1.offsetLeft - (cell0.offsetLeft + cellWidth);
        
        // 修正：如果 gapSize 计算异常（例如换行了），则使用默认值或重新计算
        // 但这里是 Grid 布局，(0,0) 和 (0,1) 应该在同一行
        
        $('.wall-hotspot').each(function() {
            const r = parseInt($(this).attr('data-wr'));
            const c = parseInt($(this).attr('data-wc'));
            
            const cellRC = $(`.cell[data-r="${r}"][data-c="${c}"]`)[0];
            if (!cellRC) return;
            
            // Hotspot 中心相对于 #board 的坐标
            // CenterX = Cell.Left + Cell.Width + Gap/2
            // CenterY = Cell.Top + Cell.Height + Gap/2
            
            const centerX = cellRC.offsetLeft + cellWidth + gapSize / 2;
            const centerY = cellRC.offsetTop + cellHeight + gapSize / 2;
            
            // hotspot size = 20px
            const left = centerX - 10;
            const top = centerY - 10;
            
            $(this).css({
                left: left + 'px',
                top: top + 'px'
            });
        });

        // 同时也更新已放置的墙的位置
        renderWalls();
    }

    $(window).on('resize', updateLayout);

    // --- 核心逻辑 ---

    function resetGame(broadcast = true) {
        // Ensure playerCount is valid (min 2)
        if (playerCount < 2) playerCount = 2;
        
        // Dynamic wall count: 10 for 2 players, 5 for 3-4 players
        const wallCount = playerCount > 2 ? WALL_COUNT_4P : WALL_COUNT_2P;
        
        // Reset players object to ensure clean state
        players = {
            [P1]: { r: 8, c: 4, walls: wallCount, color: 'p1', goal: { type: 'row', val: 0 } },
            [P2]: { r: 0, c: 4, walls: wallCount, color: 'p2', goal: { type: 'row', val: 8 } }
        };
        
        if (playerCount >= 3) {
            players[P3] = { r: 4, c: 0, walls: wallCount, color: 'p3', goal: { type: 'col', val: 8 } };
        }
        if (playerCount >= 4) {
            players[P4] = { r: 4, c: 8, walls: wallCount, color: 'p4', goal: { type: 'col', val: 0 } };
        }

        placedWalls = [];
        currentPlayer = P1;
        historyStack = [];
        
        $('#winner-display').parent().parent().parent().addClass('hidden'); // Close modal
        
        if (gameMode === 'pvai') {
            isGameStarted = true;
            $('#start-game-btn').addClass('hidden');
        } else if (gameMode === 'pvp') {
            isGameStarted = true;
            $('#start-game-btn').addClass('hidden');
        } else {
            // Online
            isGameStarted = false;
            if (isHost) {
                $('#start-game-btn').removeClass('hidden');
            } else {
                $('#start-game-btn').addClass('hidden');
            }
        }
        
        updateUI();
        
        if (broadcast && gameMode === 'online' && isHost) {
            send('restart');
            syncState();
        }
    }

    function isValidMove(player, r, c) {
        const moves = getValidMoves(player);
        return moves.some(m => m.r === r && m.c === c);
    }

    function getValidMoves(player) {
        const p = players[player];
        const moves = [];
        
        const directions = [
            { dr: -1, dc: 0 }, // Up
            { dr: 1, dc: 0 },  // Down
            { dr: 0, dc: -1 }, // Left
            { dr: 0, dc: 1 }   // Right
        ];

        for (let d of directions) {
            const nr = p.r + d.dr;
            const nc = p.c + d.dc;

            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                // 检查是否有墙阻挡
                if (!isWallBlocking(p.r, p.c, nr, nc)) {
                    // 检查是否有对手
                    const opponentId = getPlayerAt(nr, nc);
                    
                    if (opponentId) {
                        // 有对手，尝试跳跃
                        // 1. 直线跳跃
                        const jumpR = nr + d.dr;
                        const jumpC = nc + d.dc;
                        
                        let canStraightJump = false;
                        if (jumpR >= 0 && jumpR < ROWS && jumpC >= 0 && jumpC < COLS) {
                            if (!isWallBlocking(nr, nc, jumpR, jumpC) && !getPlayerAt(jumpR, jumpC)) {
                                moves.push({ r: jumpR, c: jumpC });
                                canStraightJump = true;
                            }
                        }
                        
                        // 2. 如果不能直线跳跃（有墙或出界或有第三个玩家），尝试斜线跳跃
                        if (!canStraightJump) {
                            // 左右（相对于当前方向）
                            if (d.dr !== 0) { // 垂直方向移动遇到对手
                                checkDiagonal(nr, nc, 0, -1, moves);
                                checkDiagonal(nr, nc, 0, 1, moves);
                            } else { // 水平方向移动遇到对手
                                checkDiagonal(nr, nc, -1, 0, moves);
                                checkDiagonal(nr, nc, 1, 0, moves);
                            }
                        }
                    } else {
                        moves.push({ r: nr, c: nc });
                    }
                }
            }
        }
        return moves;
    }
    
    function getPlayerAt(r, c) {
        for (let pid in players) {
            if (players[pid].r === r && players[pid].c === c) return parseInt(pid);
        }
        return null;
    }

    function checkDiagonal(r, c, dr, dc, moves) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
            if (!isWallBlocking(r, c, nr, nc) && !getPlayerAt(nr, nc)) {
                moves.push({ r: nr, c: nc });
            }
        }
    }

    // 检查两个相邻格子之间是否有墙
    function isWallBlocking(r1, c1, r2, c2) {
        // 确定移动方向
        if (r1 === r2) { // 水平移动
            const c = Math.min(c1, c2); // 移动跨越了 Col c 和 Col c+1
            // 阻挡的墙是竖墙 (Vertical)，位置在 (row, c) 或 (row-1, c)
            // 竖墙 (wr, wc) 阻挡了 (wr, wc)-(wr, wc+1) 和 (wr+1, wc)-(wr+1, wc+1)
            
            // 如果存在竖墙 (r1, c) -> 阻挡了 r1 行的通过
            if (hasWall(r1, c, 'v')) return true;
            // 如果存在竖墙 (r1-1, c) -> 阻挡了 r1 行 (它是墙的下半部分)
            if (hasWall(r1 - 1, c, 'v')) return true;
        } else { // 垂直移动
            const r = Math.min(r1, r2); // 移动跨越了 Row r 和 Row r+1
            // 阻挡的墙是横墙 (Horizontal)，位置在 (r, col) 或 (r, col-1)
            // 横墙 (wr, wc) 阻挡了 (wr, wc)-(wr+1, wc) 和 (wr, wc+1)-(wr+1, wc+1)
            
            if (hasWall(r, c1, 'h')) return true;
            if (hasWall(r, c1 - 1, 'h')) return true;
        }
        return false;
    }

    function hasWall(r, c, orientation) {
        return placedWalls.some(w => w.r === r && w.c === c && w.orientation === orientation);
    }

    function isValidWallPlacement(r, c, orientation) {
        // 1. 边界检查 (已在 UI 限制，但逻辑层也要查)
        if (r < 0 || r >= ROWS - 1 || c < 0 || c >= COLS - 1) return false;

        // 2. 检查是否与现有墙重叠或交叉
        // 重叠：完全相同
        if (hasWall(r, c, 'h') || hasWall(r, c, 'v')) return false;
        
        if (orientation === 'h') {
            // 横墙占据 (r, c) 和 (r, c+1) 之间的缝隙
            // 不能有横墙在 (r, c-1) (重叠左半部分) 或 (r, c+1) (重叠右半部分)
            if (hasWall(r, c - 1, 'h')) return false;
            if (hasWall(r, c + 1, 'h')) return false;
        } else {
            // 竖墙占据 (r, c) 和 (r+1, c) 之间的缝隙
            if (hasWall(r - 1, c, 'v')) return false;
            if (hasWall(r + 1, c, 'v')) return false;
        }

        // 3. 检查是否封死路径 (Pathfinding)
        // 模拟放墙
        placedWalls.push({ r, c, orientation });
        
        let allCanReach = true;
        for (let pid in players) {
            if (!hasPath(parseInt(pid))) {
                allCanReach = false;
                break;
            }
        }
        
        placedWalls.pop(); // 恢复

        return allCanReach;
    }

    function hasPath(playerId) {
        const p = players[playerId];
        const goal = p.goal;
        
        // BFS
        const queue = [{ r: p.r, c: p.c }];
        const visited = new Set();
        visited.add(`${p.r},${p.c}`);

        while (queue.length > 0) {
            const curr = queue.shift();
            
            if (goal.type === 'row') {
                if (curr.r === goal.val) return true;
            } else {
                if (curr.c === goal.val) return true;
            }

            const neighbors = getNeighbors(curr.r, curr.c);
            for (let n of neighbors) {
                if (!visited.has(`${n.r},${n.c}`)) {
                    visited.add(`${n.r},${n.c}`);
                    queue.push(n);
                }
            }
        }
        return false;
    }

    // 用于寻路的简单邻居获取（不考虑跳跃，只考虑墙）
    // 实际上，只要能动就行，不需要考虑对手位置（因为对手是动态的，不能视为永久障碍）
    // 规则是：不能封死。对手可以移动，所以对手不算墙。
    function getNeighbors(r, c) {
        const neighbors = [];
        const directions = [
            { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }
        ];
        for (let d of directions) {
            const nr = r + d.dr;
            const nc = c + d.dc;
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                if (!isWallBlocking(r, c, nr, nc)) {
                    neighbors.push({ r: nr, c: nc });
                }
            }
        }
        return neighbors;
    }

    // --- AI Turn Logic ---
    function checkBotTurn() {
        if (!isHost || !isGameStarted) return;
        
        // Find if current player is a bot
        // P1 is host (human)
        // Others in connections
        if (currentPlayer === P1) return;
        
        const bot = connections.find(c => c.playerId === currentPlayer && c.isBot);
        if (bot) {
            console.log(`Bot P${currentPlayer} turn...`);
            setTimeout(() => {
                aiMoveFor(currentPlayer);
            }, 1000);
        }
    }
    
    function aiMoveFor(pid) {
        // AI Logic reused from aiMove, but for specific pid
        const p = players[pid];
        const opponentId = pid === P1 ? P2 : P1; // Simplified opponent target
        // For 4P, AI target goal.
        
        // Simple AI: Move towards goal
        const bestMove = getBestMoveToGoal(pid);
        
        if (bestMove) {
             // 30% chance to place wall if has walls
             if (p.walls > 0 && Math.random() < 0.3) {
                 // Try place wall
                 for (let i = 0; i < 20; i++) {
                     const r = Math.floor(Math.random() * (ROWS - 1));
                     const c = Math.floor(Math.random() * (COLS - 1));
                     const o = Math.random() > 0.5 ? 'h' : 'v';
                     if (isValidWallPlacement(r, c, o)) {
                         makeMove('wall', { r, c, orientation: o });
                         return;
                     }
                 }
                 makeMove('move', bestMove);
             } else {
                 makeMove('move', bestMove);
             }
        } else {
            // Stuck?
             makeMove('move', { r: p.r, c: p.c }); // Pass? Invalid
        }
    }

    function makeMove(type, data, broadcast = true) {
        if (!isGameStarted) return;
        
        // Permission check
        const isBotTurn = connections.some(c => c.playerId === currentPlayer && c.isBot);
        if (isHost && isBotTurn) {
             // Host can move bots
        } else if (gameMode === 'online') {
            if (currentPlayer !== myPlayerId) return; // Not my turn
        }

        // 记录历史
        historyStack.push({
            players: JSON.parse(JSON.stringify(players)),
            placedWalls: JSON.parse(JSON.stringify(placedWalls)),
            currentPlayer
        });
        
        const movingPlayer = currentPlayer; // Capture current player for broadcast

        if (type === 'move') {
            const { r, c } = data;
            players[currentPlayer].r = r;
            players[currentPlayer].c = c;
            playSound('move');
        } else if (type === 'wall') {
            const { r, c, orientation } = data;
            if (players[currentPlayer].walls <= 0) return;
            players[currentPlayer].walls--;
            placedWalls.push({ r, c, orientation });
            playSound('wall');
        }

        updateUI();
        
        if (checkWin()) {
            isGameStarted = false;
            playSound('win');
            if (gameMode === 'online' && broadcast) {
                 send('move', { 
                     moveType: type, 
                     ...data, 
                     player: movingPlayer, 
                     nextPlayer: currentPlayer // Game ended
                 });
            }
            return;
        }

        // 切换回合
        let nextPlayer = currentPlayer + 1;
        
        // Debug
        // console.log(`Turn Switch: Current=${currentPlayer}, Count=${playerCount}, NextCalc=${nextPlayer}`);
        
        if (nextPlayer > playerCount) nextPlayer = 1;
        currentPlayer = nextPlayer;
        
        // Safety check: ensure next player exists in players object
        // If not, force reset to P1 or valid player?
        // This handles cases where playerCount might be out of sync with actual players object
        if (!players[currentPlayer]) {
             console.warn(`Player ${currentPlayer} not found in players object! Resetting to P1.`);
             currentPlayer = P1;
        }
        
        if (gameMode === 'online' && broadcast) {
            // Include currentPlayer in broadcast to ensure sync
            send('move', { 
                moveType: type, 
                ...data, 
                player: movingPlayer, // Critical: Explicitly state who moved
                nextPlayer: currentPlayer // Critical: Explicitly state who is next
            });
        }

        updateUI();

        // Check next turn for Bot (Host only)
        if (isHost) {
            checkBotTurn();
        }
        
        // AI Turn (Old PvAI)
        if (gameMode === 'pvai' && currentPlayer === P2) {
            setTimeout(aiMove, 500);
        }
    }
    
    function checkWin() {
        for (let pid in players) {
            const p = players[pid];
            if (p.goal.type === 'row') {
                if (p.r === p.goal.val) {
                    showWinner(parseInt(pid));
                    return true;
                }
            } else {
                if (p.c === p.goal.val) {
                    showWinner(parseInt(pid));
                    return true;
                }
            }
        }
        return false;
    }
    
    function showWinner(winner) {
        let title = "";
        if (winner === P1) title = "黑方获胜!";
        else if (winner === P2) title = "红方获胜!";
        else if (winner === P3) title = "绿方获胜!";
        else if (winner === P4) title = "黄方获胜!";
        
        $('#winner-display .winner-title').text(title);
        
        // Control Restart Button visibility
        if (gameMode === 'online' && !isHost) {
            $('#modal-restart-btn').addClass('hidden');
        } else {
            $('#modal-restart-btn').removeClass('hidden');
        }
        
        $('#modal-overlay').removeClass('hidden');
    }

    // --- AI ---
    function aiMove() {
        // 简单 AI：优先移动，如果距离变近。如果被堵，尝试放墙。
        // A* Path length difference
        
        const p1Path = getShortestPathLength(P1);
        const p2Path = getShortestPathLength(P2);
        
        // 如果我有胜算 (路径更短)，冲！
        if (p2Path <= p1Path) {
            const bestMove = getBestMoveToGoal(P2);
            if (bestMove) {
                makeMove('move', bestMove);
                return;
            }
        }
        
        // 否则，尝试放墙阻碍对手
        // 随机尝试放墙，如果能增加对手路径且不增加自己路径太多
        if (players[P2].walls > 0 && Math.random() > 0.3) {
            for (let i = 0; i < 50; i++) { // 尝试 50 次
                const r = Math.floor(Math.random() * (ROWS - 1));
                const c = Math.floor(Math.random() * (COLS - 1));
                const o = Math.random() > 0.5 ? 'h' : 'v';
                
                if (isValidWallPlacement(r, c, o)) {
                    // 评估
                    placedWalls.push({r, c, orientation: o});
                    const newP1Path = getShortestPathLength(P1);
                    const newP2Path = getShortestPathLength(P2);
                    placedWalls.pop();
                    
                    if (newP1Path > p1Path && newP2Path <= p2Path + 1) { // 干扰对手比干扰自己多
                        makeMove('wall', { r, c, orientation: o });
                        return;
                    }
                }
            }
        }
        
        // 默认移动
        const move = getBestMoveToGoal(P2);
        if (move) {
            makeMove('move', move);
        } else {
            // 无路可走？（不可能，除非规则bug）
            console.error("AI Stuck");
        }
    }
    
    function getShortestPathLength(pid) {
        const p = players[pid];
        const queue = [{ r: p.r, c: p.c, dist: 0 }];
        const visited = new Set();
        visited.add(`${p.r},${p.c}`);
        
        while (queue.length > 0) {
            const curr = queue.shift();
            if (p.goal.type === 'row') {
                if (curr.r === p.goal.val) return curr.dist;
            } else {
                if (curr.c === p.goal.val) return curr.dist;
            }
            
            const neighbors = getNeighbors(curr.r, curr.c);
            for (let n of neighbors) {
                if (!visited.has(`${n.r},${n.c}`)) {
                    visited.add(`${n.r},${n.c}`);
                    queue.push({ r: n.r, c: n.c, dist: curr.dist + 1 });
                }
            }
        }
        return Infinity;
    }
    
    function getBestMoveToGoal(pid) {
        const validMoves = getValidMoves(pid);
        let bestMove = null;
        let minLen = Infinity;
        
        for (let m of validMoves) {
            // 模拟移动
            const oldR = players[pid].r;
            const oldC = players[pid].c;
            players[pid].r = m.r;
            players[pid].c = m.c;
            
            const len = getShortestPathLength(pid);
            if (len < minLen) {
                minLen = len;
                bestMove = m;
            }
            
            // 恢复
            players[pid].r = oldR;
            players[pid].c = oldC;
        }
        return bestMove;
    }

    // --- UI 更新 ---

    // 全局变量记录当前旋转角度，避免重复设置
    let currentBoardRotation = 0;

    function applyBoardRotation() {
        let rotation = 0;
        if (gameMode === 'online') {
            if (myPlayerId === P2) rotation = 180;
            else if (myPlayerId === P3) rotation = -90;
            else if (myPlayerId === P4) rotation = 90;
        } else if (gameMode === 'pvp' && currentPlayer === P2) {
            rotation = 180;
        }

        if (currentBoardRotation !== rotation) {
            currentBoardRotation = rotation;
            $('#board-rotator').css('transform', rotation ? `rotate(${rotation}deg)` : '');
            // 旋转改变后，可能需要重新计算布局（如果布局依赖旋转后的尺寸，虽然这里是正方形应该还好）
            // 但为了安全起见，或者为了确保 transform 生效后再计算
        }
    }

    function updateUI() {
        // console.log('updateUI: myPlayerId=', myPlayerId, 'currentPlayer=', currentPlayer);

        // 尝试应用旋转（内部会检查是否需要变更）
        applyBoardRotation();

        // 1. 渲染棋子
        $('.cell').empty().removeClass('valid-move');
        
        for (let pid in players) {
            const p = players[pid];
            const $cell = $(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
            
            // Add rotation to pawn to keep it upright
            const $pawn = $('<div>')
                .addClass(`pawn p${pid}`)
                .text(pid); // Show Player ID
            
            // Apply counter-rotation if board is rotated
            if (currentBoardRotation !== 0) {
                $pawn.css('transform', `translate(-50%, -50%) rotate(${-currentBoardRotation}deg)`);
            }
            
            $cell.append($pawn);
        }
        
        // 2. 渲染有效移动 (如果是我的回合)
        if (isGameStarted) {
            let showMoves = false;
            // 确保 myPlayerId 是数字
            const myPid = parseInt(myPlayerId);
            const currentPid = parseInt(currentPlayer);
            
            if (gameMode === 'pvai' && currentPid === P1) showMoves = true;
            if (gameMode === 'pvp') showMoves = true;
            if (gameMode === 'online' && currentPid === myPid) showMoves = true;
            
            // Debug info for interaction
            // console.log(`Check Move: Mode=${gameMode}, Current=${currentPid}, My=${myPid}, Show=${showMoves}`);
            
            if (showMoves) {
                const moves = getValidMoves(currentPid);
                moves.forEach(m => {
                    $(`.cell[data-r="${m.r}"][data-c="${m.c}"]`).addClass('valid-move');
                });
            }
        }
        
        // 3. 渲染墙
        renderWalls();
        
        // 4. 更新状态面板
        for (let i = 1; i <= 4; i++) {
            if (players[i]) {
                $(`#p${i}-walls`).text(players[i].walls);
                $(`#player${i}-status`).removeClass('hidden'); // Ensure visible
            } else {
                $(`#player${i}-status`).addClass('hidden'); // Hide if not playing
            }
        }
        
        $('.player-status').removeClass('active p1-active p2-active p3-active p4-active');
        $(`#player${currentPlayer}-status`).addClass(`active p${currentPlayer}-active`);
        
        let msg = '';
        if (!isGameStarted && gameMode === 'online') {
            msg = isHost ? "请点击开始游戏" : "等待房主开始...";
        } else {
            const isMe = (gameMode === 'online' && currentPlayer === myPlayerId) || 
                         (gameMode === 'pvai' && currentPlayer === P1);
            msg = isMe ? "轮到你了" : `玩家 ${currentPlayer} 思考中...`;
            if (gameMode === 'pvp') {
                const names = ["黑方", "红方", "绿方", "黄方"];
                msg = `${names[currentPlayer-1]}回合`;
            }
        }
        $('#status-message').text(msg);
        
        // 5. 更新 Undo 按钮
        $('#undo-btn').prop('disabled', historyStack.length === 0);
    }

    function renderWalls() {
        // 清除旧墙 (保留 hotspots)
        $('.wall:not(.preview)').remove();
        
        placedWalls.forEach(w => {
            createWallElement(w.r, w.c, w.orientation, false);
        });
    }
    
    function createWallElement(r, c, orientation, isPreview = false) {
        // 找到对应的 hotspot 位置
        const $hotspot = $(`.wall-hotspot[data-wr="${r}"][data-wc="${c}"]`);
        if ($hotspot.length === 0) return;
        
        const left = parseFloat($hotspot.css('left')) + 10; // +10 to center in hotspot (20px)
        const top = parseFloat($hotspot.css('top')) + 10;
        
        const $wall = $('<div>')
            .addClass('wall')
            .addClass(orientation)
            .css({
                left: left + 'px',
                top: top + 'px',
                // 使用 transform 来居中墙的起点
                // 墙的 CSS 定义了 width/height，我们需要将其中心点或者左上角对齐
                // 我们的坐标 (r, c) 是交叉点中心
                // CSS 中：
                // Horizontal Wall: width 90px, height 10px. Centered at intersection? 
                // No, usually wall spans from intersection to right.
                // Our logic: H-wall at (r,c) blocks (r,c) and (r,c+1). It starts at intersection and goes right.
                // But it also has thickness.
                // Let's align top-left of wall to (intersection_x - gap/2, intersection_y - gap/2)?
                // Actually, just using transform translate is easier.
            });
            
        // 调整位置以使墙居中于交叉点
        // Horizontal: 左边缘在交叉点左侧 gap/2 处？
        // 其实 H-Wall 应该完全覆盖缝隙。
        // Gap width = 10px. Wall height = 10px.
        // H-Wall width = 2*cell + gap.
        // 如果我们把墙的中心放在交叉点 (r, c) 的中心：
        // (r, c) 是 cell(r, c), cell(r, c+1), cell(r+1, c), cell(r+1, c+1) 的中心点。
        // H-Wall 应该位于 Row r 和 Row r+1 之间，横跨 Col c 和 Col c+1。
        // 它的中心点应该是 Intersection(r, c) 的中心点吗？
        // 不，Intersection(r, c) 是 Col c 和 Col c+1 之间的缝隙 与 Row r 和 Row r+1 之间的缝隙 的交叉。
        // H-Wall at (r, c) 应该覆盖 Gap-Row r (between Row r, r+1) 从 Col c 到 Col c+1 结束？
        // Wait, standard Quoridor wall length = 2 cells + 1 gap.
        // So it covers Col c AND Col c+1.
        // So its center should be at the center of the vertical line separating Col c and Col c+1?
        // No.
        // H-Wall (r, c) starts at the gap between Col c and Col c+1? No that's a vertical gap.
        
        // Let's redefine visual placement:
        // H-Wall (r, c): Between Row r and r+1. Spans Col c and c+1.
        // Center X = Boundary between Col c and c+1 (which is the intersection X).
        // Center Y = Boundary between Row r and r+1 (which is the intersection Y).
        // So yes, the wall is centered at the intersection (r, c) visually!
        // Wait, if it spans Col c and c+1, and intersection (r,c) is between Col c and c+1...
        // Then the intersection is the MIDDLE of the wall.
        // Correct.
        
        $wall.css('transform', 'translate(-50%, -50%)');
        
        if (isPreview) {
            $wall.addClass('preview');
        }
        
        $('#wall-layer').append($wall);
        return $wall;
    }

    // --- 事件监听 ---

    function setupEvents() {
        console.log('Binding events...');
        // 1. 格子点击 (移动)
    $('#board').on('click', '.cell', function(e) {
        if (!isGameStarted) return;
        
        // Debug
        // console.log('Cell clicked:', $(this).attr('data-r'), $(this).attr('data-c'), 'Valid?', $(this).hasClass('valid-move'));
        
        const r = parseInt($(this).attr('data-r'));
        const c = parseInt($(this).attr('data-c'));
        
        if ($(this).hasClass('valid-move')) {
            makeMove('move', { r, c });
        }
    });
        
        // ... (existing events) ...

        // Add Bot Button
        $('#btn-add-bot').click(() => {
            addBot();
        });

    // 3. 墙的热区交互
    $('#wall-layer').on('mouseenter', '.wall-hotspot', function() {
        if (!isGameStarted) return;
        
        const myPid = parseInt(myPlayerId);
        const currentPid = parseInt(currentPlayer);

        if (gameMode === 'online' && currentPid !== myPid) return;
        if (gameMode === 'pvai' && currentPid === P2) return;
        if (players[currentPid].walls <= 0) return;

        const r = parseInt($(this).attr('data-wr'));
        const c = parseInt($(this).attr('data-wc'));
        hoveredIntersection = { r, c };
        showWallPreview(r, c);
    });

    $('#wall-layer').on('mouseleave', '.wall-hotspot', function() {
        $('.wall.preview').remove();
        hoveredIntersection = null;
    });

    $('#wall-layer').on('click', '.wall-hotspot', function() {
        if (!isGameStarted) return;
        
        const myPid = parseInt(myPlayerId);
        const currentPid = parseInt(currentPlayer);

        if (gameMode === 'online' && currentPid !== myPid) return;
        if (gameMode === 'pvai' && currentPid === P2) return;
        if (players[currentPid].walls <= 0) return;

        const r = parseInt($(this).attr('data-wr'));
        const c = parseInt($(this).attr('data-wc'));
        
        if (isValidWallPlacement(r, c, wallOrientation)) {
            makeMove('wall', { r, c, orientation: wallOrientation });
            $('.wall.preview').remove(); // 清除预览
        } else {
            // Shake animation?
            showToast("此处不能放墙", 'error');
        }
    });

        // 3. 旋转墙 / 键盘事件
        $('#rotate-wall-btn').click(() => {
            wallOrientation = wallOrientation === 'h' ? 'v' : 'h';
            if (hoveredIntersection) {
                showWallPreview(hoveredIntersection.r, hoveredIntersection.c);
            }
        });

        $(document).keydown(function(e) {
            if (e.key === 'r' || e.key === 'R') {
                wallOrientation = wallOrientation === 'h' ? 'v' : 'h';
                if (hoveredIntersection) {
                    showWallPreview(hoveredIntersection.r, hoveredIntersection.c);
                }
            }
        });
        
        // 4. 控制按钮
        $('#btn-ai').click(() => {
            console.log('Button clicked: AI');
            gameMode = 'pvai';
            $('#lobby').addClass('hidden');
            $('#game-board').removeClass('hidden');
            updateLayout(); // 确保布局正确
            resetGame();
        });
        
        $('#btn-pvp').click(() => {
            console.log('Button clicked: PvP');
            gameMode = 'pvp';
            playerCount = 2; // PvP 默认2人，如果需要4人本地PVP，需要额外UI支持
            $('#lobby').addClass('hidden');
            $('#game-board').removeClass('hidden');
            updateLayout();
            resetGame();
        });
        
        // Updated Create Room buttons
        $('#btn-create').click(() => {
            console.log('Button clicked: Create Room');
            isHost = true;
            gameMode = 'online'; // Explicitly set game mode to online
            playerCount = 4; // Default max to allow connections
            myPlayerId = P1;
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden');
            initPeer();
        });
        
        $('#btn-join').click(() => {
            const id = $('#room-id-input').val().trim();
            if (id) {
                isHost = false;
                // myPlayerId will be assigned by host
                joinRoom(id);
            }
        });
        
        $('#lobby-start-btn').click(() => {
            if (isHost) {
                // Clean up invalid connections before starting
                connections = connections.filter(c => c.conn.open);
                
                // Finalize player count
                playerCount = connections.length + 1;
                console.log('Starting game with playerCount:', playerCount, 'Connections:', connections.length);
                
                // Hide lobby and show game board
                $('#lobby').addClass('hidden');
                $('#game-board').removeClass('hidden');
                
                // Broadcast start with player count
                send('start', { playerCount: playerCount });
                
                // Initialize local game
                resetGame(false);
                
                // CRITICAL FIX for Host: 
                // resetGame sets isGameStarted to false. Set it to true immediately.
                isGameStarted = true;
                $('#start-game-btn').addClass('hidden'); // Hide the secondary start button
                
                updateLayout();
                updateUI();
                showToast("游戏开始！", 'success');
            }
        });
        
        $('#start-game-btn').click(() => {
            if (isHost) {
                isGameStarted = true;
                $('#start-game-btn').addClass('hidden');
                send('start');
                updateUI();
            }
        });
        
        $('#restart-btn, #modal-restart-btn').click(() => {
             if (gameMode === 'online') {
                 if (isHost) {
                     // Host restarts the game
                     send('start', { playerCount: playerCount });
                     resetGame(false);
                     isGameStarted = true;
                     $('#start-game-btn').addClass('hidden');
                     updateLayout();
                     updateUI();
                     showToast("游戏重新开始！", 'success');
                 }
             } else {
                 resetGame();
             }
        });
        
        $('#exit-btn').click(() => {
            location.reload(); // 简单重置
        });
        
        $('#btn-copy').click(function() {
            const text = $('#share-url').val();
            
            // 兼容性处理：优先使用 Clipboard API，回退使用 execCommand
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    const $btn = $(this);
                    $btn.text('已复制');
                    setTimeout(() => $btn.text('复制'), 2000);
                }).catch(err => {
                    console.error('Clipboard API failed:', err);
                    fallbackCopy(text, $(this));
                });
            } else {
                fallbackCopy(text, $(this));
            }
        });

        function fallbackCopy(text, $btn) {
            const $tempInput = $('<input>');
            $('body').append($tempInput);
            $tempInput.val(text).select();
            try {
                document.execCommand('copy');
                $btn.text('已复制');
                setTimeout(() => $btn.text('复制'), 2000);
            } catch (err) {
                console.error('Fallback copy failed:', err);
                alert("复制失败，请手动复制");
                showToast("复制失败，请手动复制", 'error');
            }
            $tempInput.remove();
        }

        $('#undo-btn').click(() => {
            if (historyStack.length === 0) return;
            
            if (gameMode === 'online') {
                if (confirm("请求悔棋?")) send('undo-request');
                return;
            }
            
            // Local Undo
            // Pop current state (which is waiting for opponent move) -> revert to state before my move
            // If PvAI, pop 2 states (AI move + My move)
            
            let pops = 1;
            if (gameMode === 'pvai' && currentPlayer === P1) pops = 2;
            
            while (pops > 0 && historyStack.length > 0) {
                const state = historyStack.pop();
                // 恢复到 state 之前的状态？
                // historyStack push 的是动作发生*前*的状态吗？
                // 代码中：historyStack.push({ players: copy, walls: copy, currentPlayer }) BEFORE modification.
                // 所以 pop 出来就是上一步之前的状态。
                
                players = state.players;
                placedWalls = state.placedWalls;
                currentPlayer = state.currentPlayer;
                pops--;
            }
            updateUI();
        });
    }

    function showWallPreview(r, c) {
        $('.wall.preview').remove();
        const $wall = createWallElement(r, c, wallOrientation, true);
        
        if (!isValidWallPlacement(r, c, wallOrientation)) {
            $wall.addClass('invalid');
        }
    }

    // --- 联机逻辑 ---
    
    function initPeer() {
        peer = new Peer(null, PEER_CONFIG);
        
        peer.on('open', (id) => {
            myId = id;
            const url = new URL(window.location.href);
            
            if (isHost) {
                url.searchParams.set('room', id);
                $('#share-url').val(url.toString());
                $('#btn-copy').prop('disabled', false).removeClass('cursor-not-allowed');
                $('#waiting-message').text(`等待玩家加入 (1/4)...`);
            } else {
                 const roomId = url.searchParams.get('room');
                 // 如果是加入者，保持 URL 中的 room ID 为房主 ID，方便继续分享
                 $('#share-url').val(url.toString());
                 $('#btn-copy').prop('disabled', false).removeClass('cursor-not-allowed');

                 if (roomId && roomId !== id) {
                     $('#waiting-message').text('正在连接房主...');
                     joinRoom(roomId);
                 }
            }
        });
        
        peer.on('connection', (c) => {
            // Only Host receives incoming connections
            if (!isHost) {
                c.close();
                return;
            }
            
            if (connections.length >= 3) { // Max 4 players total
                c.close(); // Room full
                return;
            }
            
            setupHostConnection(c);
        });
    }
    
    function setupHostConnection(c) {
        // Assign ID based on available slots
        const takenIds = connections.map(x => x.playerId);
        let newPid = 2;
        while (takenIds.includes(newPid)) {
            newPid++;
        }
        
        c.on('open', () => {
            connections.push({ conn: c, playerId: newPid });
            console.log(`Player ${newPid} joined`);
            
            // Delay slightly to ensure client is ready to receive data
            setTimeout(() => {
                // If game already started, this is a re-join or late join
                if (isGameStarted) {
                    // Send current state
                    c.send({
                        type: 'sync',
                        players,
                        placedWalls,
                        currentPlayer,
                        playerCount,
                        isGameStarted,
                        yourPlayerId: newPid // Tell the player who they are
                    });
                } else {
                    const currentCount = connections.length + 1;
                    $('#waiting-message').text(`等待玩家加入 (${currentCount}/4)...`);
                    
                    // Send Init Data
                    c.send({ 
                        type: 'init', 
                        playerId: newPid, 
                        playerCount: 4 // Max capacity
                    });
                    
                    // Broadcast update
                    broadcastRoomUpdate();
                    
                    if (currentCount >= 2) {
                        $('#lobby-start-btn').removeClass('hidden');
                    }
                }
            }, 500);
        });
        
        c.on('data', (data) => {
            handleData(data, c);
        });
        
        c.on('close', () => {
            console.log(`Player ${newPid} disconnected`);
            connections = connections.filter(x => x.conn !== c);
            const currentCount = connections.length + 1;
            
            // Broadcast update
            broadcastRoomUpdate();
            
            if (currentCount < 2) {
                $('#lobby-start-btn').addClass('hidden');
            }
        });
    }

    function joinRoom(id) {
        if (!peer) {
             const check = setInterval(() => {
                 if (peer && peer.id) {
                     clearInterval(check);
                     connectToHost(id);
                 }
             }, 100);
        } else {
            connectToHost(id);
        }
    }
    
    function connectToHost(id) {
        conn = peer.connect(id);
        
        conn.on('open', () => {
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden');
            gameMode = 'online';
            $('#status-message').text("连接成功，等待房主...");
        });
        
        conn.on('data', (data) => {
            handleData(data, conn);
        });
        
            conn.on('close', () => {
            showToast("与房主断开连接", 'error');
            setTimeout(() => location.reload(), 2000);
        });
    }
    
    function handleData(data, sourceConn) {
        console.log('Received:', data.type, data);
        console.log('Current myPlayerId:', myPlayerId, 'isHost:', isHost);
        
        if (data.type === 'init') {
            myPlayerId = data.playerId;
            playerCount = data.playerCount;
            $('#waiting-message').text("等待房主开始游戏...");
            $('#status-message').text(`我是玩家 ${myPlayerId}，等待开始...`);
        }
        else if (data.type === 'start') {
            playerCount = data.playerCount;
            $('#lobby').addClass('hidden'); // Ensure lobby is hidden
            $('#game-board').removeClass('hidden');
            
            // Re-assign myPlayerId based on init data, but if I am host, P1.
            if (isHost) myPlayerId = P1;
            
            resetGame(false);
            
            // CRITICAL FIX: resetGame sets isGameStarted to false for online mode.
            // We must explicitly set it to true here AND update UI.
            isGameStarted = true;
            
            updateLayout();
            updateUI(); // Ensure UI reflects the started state
            showToast("游戏开始！", 'success');
            
            // If host, check if first turn is bot (unlikely P1 is bot, but good practice)
            if (isHost) checkBotTurn();
        }
        else if (data.type === 'move') {
            const movingPid = data.player; // Explicit player from broadcast
            
            // Apply move locally without broadcasting back (avoid loops)
            if (data.orientation) {
                 // Direct update internal state to avoid permission check in makeMove
                 const { r, c, orientation } = data;
                 if (players[movingPid]) { // Use explicit player ID
                     if (players[movingPid].walls > 0) players[movingPid].walls--;
                     placedWalls.push({ r, c, orientation });
                     playSound('wall');
                 }
            } else {
                 const { r, c } = data;
                 if (players[movingPid]) { // Use explicit player ID
                     players[movingPid].r = r;
                     players[movingPid].c = c;
                     playSound('move');
                 }
            }
            
            // IMPORTANT: Force UI update before switching turns or checking win
            // to ensure the piece actually moves visually
            updateUI();
            
            if (checkWin()) {
                isGameStarted = false;
                playSound('win');
                return;
            }

            // Update turn from broadcast data if available, otherwise calculate
            if (data.nextPlayer) {
                currentPlayer = data.nextPlayer;
            } else {
                let nextPlayer = currentPlayer + 1;
                if (nextPlayer > playerCount) nextPlayer = 1;
                currentPlayer = nextPlayer;
            }
            
            // Update UI again to show new active player
            updateUI();

            // If Host, broadcast to others (relay)
            if (isHost) {
                // Relay the message exactly as received, do not re-wrap it if it's already a move msg
                // But wait, `data` is the payload. `broadcast` wraps it?
                // `broadcast` takes a payload and sends it.
                // The payload received is `data`.
                // We should broadcast `data` to other clients.
                broadcast(data, sourceConn); 
                checkBotTurn();
            }
        }
        else if (data.type === 'restart') {
            resetGame(false);
        }
        else if (data.type === 'sync') {
             // Full state sync
             gameMode = 'online'; // Ensure game mode is online
             
             if (data.yourPlayerId) {
                 myPlayerId = data.yourPlayerId;
                 $('#status-message').text(`我是玩家 ${myPlayerId}`);
             }

             players = data.players;
             placedWalls = data.placedWalls;
             currentPlayer = data.currentPlayer;
             playerCount = data.playerCount;
             isGameStarted = data.isGameStarted;
             
             $('#waiting-section').addClass('hidden');
             $('#create-room-section').addClass('hidden'); // Ensure create/join UI is hidden
             $('#lobby').addClass('hidden'); // Ensure lobby container is hidden
             $('#game-board').removeClass('hidden');
             
             updateLayout();
             updateUI();
             
             showToast("已重新加入游戏", 'success');
        }
        else if (data.type === 'undo-request') {
             // Simplified undo: just alert
             showToast("暂不支持在线悔棋", 'error');
        }
        else if (data.type === 'room-update') {
            // Update UI for guest
            updateLobbyUI(data.players);
        }
    }
    
    function syncState() {
        if (!isHost) return;
        console.log('Syncing state to all clients...');
        send('sync', {
            players,
            placedWalls,
            currentPlayer,
            playerCount,
            isGameStarted
        });
    }

    function send(type, data = {}) {
        const payload = { type, ...data };
        if (isHost) {
            broadcast(payload);
        } else {
            if (conn && conn.open) conn.send(payload);
        }
    }
    
    function broadcast(payload, excludeConn = null) {
        connections.forEach(c => {
            if (c.conn !== excludeConn && c.conn.open) {
                c.conn.send(payload);
            }
        });
    }

    function broadcastRoomUpdate() {
        const count = connections.length + 1;
        
        // Build player list
        // Host is P1
        const playerList = [{ id: P1, name: "房主 (P1)", isBot: false }];
        connections.forEach(c => {
            const name = c.isBot ? `电脑 (P${c.playerId})` : `玩家 (P${c.playerId})`;
            playerList.push({ id: c.playerId, name: name, isBot: c.isBot || false });
        });
        
        // Sort by ID
        playerList.sort((a, b) => a.id - b.id);
        
        const msg = { 
            type: 'room-update', 
            count: count, 
            max: 4,
            players: playerList
        };
        broadcast(msg);
        
        // Update Host UI
        updateLobbyUI(playerList);
    }
    
    function updateLobbyUI(playerList) {
        const count = playerList.length;
        $('#waiting-message').text(`已加入 ${count} 人，可开始游戏`);
        
        const $list = $('#lobby-players');
        $list.empty();
        playerList.forEach(p => {
            $list.append(`<li>${p.name}</li>`);
        });
        
        if (isHost) {
             // Show Add Bot button if < 4 players
             if (count < 4) {
                 $('#btn-add-bot').removeClass('hidden');
             } else {
                 $('#btn-add-bot').addClass('hidden');
             }
             
             if (count >= 2) {
                 $('#lobby-start-btn').removeClass('hidden');
             } else {
                 $('#lobby-start-btn').addClass('hidden');
             }
        }
    }
    
    // Add Bot Logic
    function addBot() {
        if (!isHost) return;
        if (connections.length + 1 >= 4) return;
        
        // Assign ID
        const takenIds = connections.map(x => x.playerId);
        let newPid = 2;
        while (takenIds.includes(newPid)) {
            newPid++;
        }
        
        // Create a fake connection object for the bot
        const botConn = {
            conn: { open: true, send: () => {}, close: () => {} }, // Dummy conn
            playerId: newPid,
            isBot: true
        };
        
        connections.push(botConn);
        console.log(`Bot ${newPid} added`);
        
        broadcastRoomUpdate();
    }
    
    // Updated Setup Host Connection to remove isBot check if needed
    // But actually, we just need to ensure normal connections don't overwrite bots?
    // In setupHostConnection, we check takenIds.
    // Wait, setupHostConnection uses:
    // const takenIds = connections.map(x => x.playerId);
    // So it will respect bot IDs. Good.

    initGame();
});
