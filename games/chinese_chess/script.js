
$(document).ready(function() {
    // --- 调试控制 ---
    const DEBUG = true;

    function log(...args) {
        if (DEBUG) {
            console.log('DBUG:', ...args);
        }
    }

    // --- 常量定义 ---
    const ROWS = 10;
    const COLS = 9;
    
    // 阵营
    const RED = 'r';
    const BLACK = 'b';
    
    // 棋子类型
    const PIECES = {
        KING: 'k',     // 帅/将
        ADVISOR: 'a',  // 仕/士
        ELEPHANT: 'e', // 相/象
        HORSE: 'h',    // 🐎
        CHARIOT: 'c',  // 车
        CANNON: 'p',   // 炮 (pao)
        SOLDIER: 's'   // 兵/卒
    };

    // 汉字映射
    const PIECE_TEXT = {
        'r': { 'k': '帅', 'a': '仕', 'e': '相', 'h': '马', 'c': '车', 'p': '炮', 's': '兵' },
        'b': { 'k': '将', 'a': '士', 'e': '象', 'h': '马', 'c': '车', 'p': '炮', 's': '卒' }
    };

    // 音效上下文
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = new AudioContext();

    // --- 游戏状态 ---
    let board = []; // 10x9 二维数组
    let currentTurn = RED; // 当前回合
    let selectedPos = null; // 当前选中的棋子坐标 {r, c}
    let lastMove = null; // 上一步 {from: {r,c}, to: {r,c}}
    let gameMode = 'pvai'; // 'pvp', 'pvai', 'online', 'endgame'
    let isGameOver = false;
    let mySide = RED; // 玩家执方 (在线/AI模式用)
    let moveHistory = [];
    
    // AI 相关
    let aiWorker = null; // 如果复杂可以放 worker，这里先跑主线程
    const MAX_DEPTH = 3; // 搜索深度

    // 在线相关
    let peer = null;
    let conn = null;
    let myPeerId = null;
    let isHost = false;
    let hasGameStarted = false;

    // 计时器相关
    let redTime = 1200; // 秒 (20分钟)
    let blackTime = 1200;
    let timerInterval = null;
    let redTimeoutCount = 0;
    let blackTimeoutCount = 0;

    // 残局数据 (使用内部坐标系：r0-9, c0-8)
    // 棋子代码：c=车, h=马, e=象, a=士, k=将/帅, p=炮, s=兵/卒
    let ENDGAMES = []; // 数据将从 endgames.json 加载

    // --- 初始化 ---
    function init() {
        log('Game Initializing...');
        // 加载残局数据
        $.getJSON('endgames.json', (data) => {
            ENDGAMES = data;
        }).fail(() => {
            console.error('Failed to load endgames.json');
        });

        initBoard();
        renderBoard();
        bindEvents();
        initAudio();
        
        // 默认显示大厅
        $('#lobby').removeClass('hidden');
        $('#game-area').addClass('hidden');
    }

    // 初始化棋盘
    function initBoard() {
        // 创建空棋盘
        board = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
        
        // 标准开局
        const setup = [
            {r: 0, c: 0, type: 'c', color: 'b'}, {r: 0, c: 1, type: 'h', color: 'b'}, {r: 0, c: 2, type: 'e', color: 'b'}, {r: 0, c: 3, type: 'a', color: 'b'}, {r: 0, c: 4, type: 'k', color: 'b'}, {r: 0, c: 5, type: 'a', color: 'b'}, {r: 0, c: 6, type: 'e', color: 'b'}, {r: 0, c: 7, type: 'h', color: 'b'}, {r: 0, c: 8, type: 'c', color: 'b'},
            {r: 2, c: 1, type: 'p', color: 'b'}, {r: 2, c: 7, type: 'p', color: 'b'},
            {r: 3, c: 0, type: 's', color: 'b'}, {r: 3, c: 2, type: 's', color: 'b'}, {r: 3, c: 4, type: 's', color: 'b'}, {r: 3, c: 6, type: 's', color: 'b'}, {r: 3, c: 8, type: 's', color: 'b'},
            
            {r: 9, c: 0, type: 'c', color: 'r'}, {r: 9, c: 1, type: 'h', color: 'r'}, {r: 9, c: 2, type: 'e', color: 'r'}, {r: 9, c: 3, type: 'a', color: 'r'}, {r: 9, c: 4, type: 'k', color: 'r'}, {r: 9, c: 5, type: 'a', color: 'r'}, {r: 9, c: 6, type: 'e', color: 'r'}, {r: 9, c: 7, type: 'h', color: 'r'}, {r: 9, c: 8, type: 'c', color: 'r'},
            {r: 7, c: 1, type: 'p', color: 'r'}, {r: 7, c: 7, type: 'p', color: 'r'},
            {r: 6, c: 0, type: 's', color: 'r'}, {r: 6, c: 2, type: 's', color: 'r'}, {r: 6, c: 4, type: 's', color: 'r'}, {r: 6, c: 6, type: 's', color: 'r'}, {r: 6, c: 8, type: 's', color: 'r'}
        ];

        setup.forEach(p => {
            board[p.r][p.c] = { type: p.type, color: p.color };
        });

        currentTurn = RED;
        isGameOver = false;
        moveHistory = [];
        redTime = 1200;
        blackTime = 1200;
        redTimeoutCount = 0;
        blackTimeoutCount = 0;
        
        selectedPos = null;
        lastMove = null;

        renderBoard();
        updateStatusUI();
        updateHistoryUI();
        updateTimerUI();
    }

    // --- 核心逻辑 ---

    // 获取合法走法
    function getLegalMoves(r, c, checkSelfCheck = true) {
        const piece = board[r][c];
        if (!piece) return [];
        
        const moves = [];
        const isRed = piece.color === RED;
        
        // 辅助：检查边界和目标位置颜色
        const check = (tr, tc) => {
            if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return false;
            const target = board[tr][tc];
            if (target && target.color === piece.color) return false; // 不能吃自己人
            return true;
        };

        // 辅助：模拟走棋并检查是否送将
        const tryAdd = (tr, tc) => {
            if (!check(tr, tc)) return;
            
            if (checkSelfCheck) {
                // 模拟移动
                const originalTarget = board[tr][tc];
                board[tr][tc] = piece;
                board[r][c] = null;
                
                // 检查自己的将是否被攻击
                const kingPos = findKing(piece.color);
                const isSafe = !isUnderAttack(kingPos.r, kingPos.c, piece.color);
                
                // 还原
                board[r][c] = piece;
                board[tr][tc] = originalTarget;
                
                if (isSafe) moves.push({r: tr, c: tc});
            } else {
                moves.push({r: tr, c: tc});
            }
        };

        switch (piece.type) {
            case PIECES.KING: // 将/帅
                // 只能在九宫格内
                [[r-1, c], [r+1, c], [r, c-1], [r, c+1]].forEach(([nr, nc]) => {
                    if (nc >= 3 && nc <= 5) {
                        if (isRed && nr >= 7 && nr <= 9) tryAdd(nr, nc);
                        if (!isRed && nr >= 0 && nr <= 2) tryAdd(nr, nc);
                    }
                });
                // 飞将规则 (面对面)
                const enemyKing = findKing(isRed ? BLACK : RED);
                if (enemyKing.c === c) { // 在同一列
                    let hasObstacle = false;
                    const minR = Math.min(r, enemyKing.r);
                    const maxR = Math.max(r, enemyKing.r);
                    for (let i = minR + 1; i < maxR; i++) {
                        if (board[i][c]) {
                            hasObstacle = true;
                            break;
                        }
                    }
                    if (!hasObstacle) tryAdd(enemyKing.r, enemyKing.c);
                }
                break;

            case PIECES.ADVISOR: // 士/仕
                // 九宫格内斜走
                [[r-1, c-1], [r-1, c+1], [r+1, c-1], [r+1, c+1]].forEach(([nr, nc]) => {
                    if (nc >= 3 && nc <= 5) {
                        if (isRed && nr >= 7 && nr <= 9) tryAdd(nr, nc);
                        if (!isRed && nr >= 0 && nr <= 2) tryAdd(nr, nc);
                    }
                });
                break;

            case PIECES.ELEPHANT: // 象/相
                // 田字格，不能过河，有塞象眼
                [[r-2, c-2], [r-2, c+2], [r+2, c-2], [r+2, c+2]].forEach(([nr, nc]) => {
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return; // 边界检查
                    if (isRed && nr < 5) return; // 红相不过河
                    if (!isRed && nr > 4) return; // 黑象不过河
                    
                    // 检查塞象眼
                    const eyeR = (r + nr) / 2;
                    const eyeC = (c + nc) / 2;
                    if (!board[eyeR][eyeC]) {
                        tryAdd(nr, nc);
                    }
                });
                break;

            case PIECES.HORSE: // 马
                // 日字格，有撇马腿
                const horseMoves = [
                    {dr: -2, dc: -1, legR: -1, legC: 0}, {dr: -2, dc: 1, legR: -1, legC: 0},
                    {dr: 2, dc: -1, legR: 1, legC: 0},   {dr: 2, dc: 1, legR: 1, legC: 0},
                    {dr: -1, dc: -2, legR: 0, legC: -1}, {dr: 1, dc: -2, legR: 0, legC: -1},
                    {dr: -1, dc: 2, legR: 0, legC: 1},   {dr: 1, dc: 2, legR: 0, legC: 1}
                ];
                horseMoves.forEach(m => {
                    const nr = r + m.dr;
                    const nc = c + m.dc;
                    const lr = r + m.legR;
                    const lc = c + m.legC;
                    
                    // 检查边界和马腿
                    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                        if (!board[lr][lc]) { // 马腿没被挡
                            tryAdd(nr, nc);
                        }
                    }
                });
                break;

            case PIECES.CHARIOT: // 车
                // 直线走
                [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
                    let nr = r + dr;
                    let nc = c + dc;
                    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                        if (!board[nr][nc]) {
                            tryAdd(nr, nc);
                        } else {
                            if (board[nr][nc].color !== piece.color) tryAdd(nr, nc); // 吃子
                            break; // 遇到棋子停下
                        }
                        nr += dr;
                        nc += dc;
                    }
                });
                break;

            case PIECES.CANNON: // 炮
                // 直线走，翻山吃子
                [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dr, dc]) => {
                    let nr = r + dr;
                    let nc = c + dc;
                    let hasJumped = false;
                    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                        if (!board[nr][nc]) {
                            if (!hasJumped) tryAdd(nr, nc); // 没翻山前可以走空地
                        } else {
                            if (!hasJumped) {
                                hasJumped = true; // 遇到第一个子，架炮
                            } else {
                                if (board[nr][nc].color !== piece.color) tryAdd(nr, nc); // 隔山打牛
                                break; // 打完收工
                            }
                        }
                        nr += dr;
                        nc += dc;
                    }
                });
                break;

            case PIECES.SOLDIER: // 兵/卒
                const forward = isRed ? -1 : 1;
                // 前进一步
                tryAdd(r + forward, c);
                
                // 过河后可以横走
                const passedRiver = isRed ? r <= 4 : r >= 5;
                if (passedRiver) {
                    tryAdd(r, c - 1);
                    tryAdd(r, c + 1);
                }
                break;
        }

        return moves;
    }

    // 查找将帅位置
    function findKing(color) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c] && board[r][c].type === PIECES.KING && board[r][c].color === color) {
                    return {r, c};
                }
            }
        }
        return null; // 应该不会发生
    }

    // 检查位置是否被攻击
    function isUnderAttack(targetR, targetC, myColor) {
        // 遍历对方所有棋子，看是否能走到 targetR, targetC
        // 优化：从 target 反推
        const enemyColor = myColor === RED ? BLACK : RED;
        
        // 简单实现：遍历全盘对方棋子 (对于 10x9 棋盘，效率可以接受)
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const p = board[r][c];
                if (p && p.color === enemyColor) {
                    // 注意：这里调用 getLegalMoves 时 checkSelfCheck 必须为 false，否则死递归
                    const moves = getLegalMoves(r, c, false);
                    if (moves.some(m => m.r === targetR && m.c === targetC)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // 检查是否被将
    function isChecked(color) {
        const k = findKing(color);
        return isUnderAttack(k.r, k.c, color);
    }

    // 检查是否无棋可走（绝杀/困毙）
    function isMate(color) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c] && board[r][c].color === color) {
                    const moves = getLegalMoves(r, c, true);
                    if (moves.length > 0) return false;
                }
            }
        }
        return true;
    }

    // 辅助：生成简化版 FEN (只包含棋盘和当前回合)
    function getBoardFen() {
        let fen = '';
        for (let r = 0; r < ROWS; r++) {
            let empty = 0;
            for (let c = 0; c < COLS; c++) {
                const p = board[r][c];
                if (p) {
                    if (empty > 0) {
                        fen += empty;
                        empty = 0;
                    }
                    fen += p.color === RED ? p.type.toUpperCase() : p.type;
                } else {
                    empty++;
                }
            }
            if (empty > 0) fen += empty;
            if (r < ROWS - 1) fen += '/';
        }
        fen += ` ${currentTurn}`;
        return fen;
    }

    // 执行移动
    function makeMove(fromR, fromC, toR, toC) {
        log('Make Move:', fromR, fromC, 'to', toR, toC);
        const piece = board[fromR][fromC];
        const target = board[toR][toC];
        
        // 记录历史
        const moveRecord = {
            from: {r: fromR, c: fromC},
            to: {r: toR, c: toC},
            piece: {...piece},
            captured: target ? {...target} : null,
            notation: getNotation(fromR, fromC, toR, toC),
            fen: getBoardFen() // 记录移动前的局面，用于悔棋恢复验证等（可选），或者记录移动后的？
            // 实际上我们需要检测的是"移动后"的局面是否重复。
            // 所以我们在移动后计算 FEN 并存入，或者在检测时计算。
            // 简单起见，我们动态计算，不存这里，或者存移动后的 FEN。
        };
        
        // 移动
        board[toR][toC] = piece;
        board[fromR][fromC] = null;
        
        // 切换回合前，先记录移动后的局面 FEN，用于判断重复
        // 注意：这里 currentTurn 还没变，但 FEN 应该包含"轮到谁走"
        // 移动后，轮到对方走。所以 FEN 的 turn 应该是对方。
        const nextTurn = currentTurn === RED ? BLACK : RED;
        // 临时切换回合以计算 FEN
        let oldTurn = currentTurn;
        currentTurn = nextTurn; 
        moveRecord.fen = getBoardFen(); // 记录移动后的局面
        currentTurn = oldTurn; // 恢复

        moveHistory.push(moveRecord);

        lastMove = {from: {r: fromR, c: fromC}, to: {r: toR, c: toC}};
        selectedPos = null;

        // 播放声音
        if (target) playSound('capture');
        else playSound('move');

        // 检查胜负
        const enemyColor = nextTurn;
        if (isMate(enemyColor)) {
            // 绝杀
            isGameOver = true;
            playSound('win');
            setTimeout(() => {
                showGameOver(currentTurn === RED ? '红方获胜' : '黑方获胜', '绝杀！');
            }, 500);
        } else {
            // 切换回合
            currentTurn = enemyColor;
            
            // 将军提示
            if (isChecked(currentTurn)) {
                playSound('check');
                showCheckEffect();
            }
            
            updateStatusUI();
            
            // AI 回合
            if (!isGameOver && gameMode === 'pvai' && currentTurn !== mySide) {
                setTimeout(aiMove, 500);
            }
        }

        renderBoard();
        updateHistoryUI();
    }

    // 悔棋 (本地逻辑)
    function undoMoveLocal() {
        if (moveHistory.length === 0) return;
        
        // 如果是人机，通常悔两步（回到自己回合）
        let steps = 1;
        if (gameMode === 'pvai' && currentTurn === mySide) {
            steps = 2;
        }
        // 在线对战悔棋，通常双方各退一步（即退2步，回到自己上一步的状态）
        // 或者只退一步？通常是退回上一个局面。
        // 如果是我方回合请求悔棋 -> 悔的是上一步对方走的棋？不对。
        // 悔棋通常是"我下错了一步，想拿回来"。
        // 此时是对方回合。
        // 所以应该悔 1 步 (回到我方回合，但我还没走的那一刻)。
        // 
        // 另一种情况：对方刚走完，我发现我上一步走错了导致对方能杀我。
        // 那要悔 2 步。
        // 
        // 简化逻辑：悔 1 步。
        // 如果是 Online 模式，undoMoveLocal 被调用时，应该由协议控制回退步数。
        // 这里的 steps logic 主要针对 PvAI 和 PvP Local。
        // Online 模式下，每次协商只退 1 步（回到上一个人的回合），或者退 2 步（回到发起者的回合）。
        // 多数网游是退 2 步（回到发起者未走棋状态）。
        // 让我们设定 Online 模式悔 2 步。
        if (gameMode === 'online') {
             steps = 2;
        }
        
        while (steps > 0 && moveHistory.length > 0) {
            const last = moveHistory.pop();
            board[last.from.r][last.from.c] = last.piece;
            board[last.to.r][last.to.c] = last.captured;
            
            // 恢复回合
            currentTurn = last.piece.color;
            steps--;
        }
        
        // 恢复 lastMove 显示
        if (moveHistory.length > 0) {
            const prev = moveHistory[moveHistory.length - 1];
            lastMove = {from: prev.from, to: prev.to};
        } else {
            lastMove = null;
        }
        
        isGameOver = false;
        $('#message-overlay').addClass('hidden'); // 如果悔棋，隐藏结算
        startTimer(); // 恢复计时
        
        selectedPos = null;
        renderBoard();
        updateStatusUI();
        updateHistoryUI();
    }

    // 悔棋按钮入口
    function undoMove() {
        if (moveHistory.length === 0) return;
        
        if (gameMode === 'online') {
            // 在线模式：请求悔棋
            // 只有轮到对方走棋时（即我刚走完，或者对方正在思考），我才能悔我的上一步。
            // 此时 moveHistory 最后一手应该是我的（如果是刚走完）。
            // 或者是对方的（如果对方已经应了一手，我想悔更早的？通常不允许跨回合悔棋）。
            // 简单起见：允许发起请求，回退 2 步。
            if (confirm('向对方请求悔棋（回退2步）？')) {
                if (conn && conn.open) {
                    conn.send({ type: 'undo_request' });
                    // alert('已发送请求，等待对方回复...');
                    // 使用 Toast 或非阻塞提示更好，这里先用 alert 简单处理，或者不做处理等待回调
                }
            }
        } else {
            undoMoveLocal();
        }
    }

    // 获取棋谱记录 (简单中文版)
    function getNotation(fr, fc, tr, tc) {
        // 简单实现，暂不处理重叠棋子
        const p = board[fr][fc];
        const name = PIECE_TEXT[p.color][p.type];
        // 纵坐标转换 (中国象棋习惯：红方底线为一，黑方底线为1...待完善)
        return `${name}: (${fr},${fc}) -> (${tr},${tc})`; 
    }

    // --- AI 实现 (Minimax + AlphaBeta) ---
    const PIECE_VALUES = {
        'k': 10000, 'a': 20, 'e': 20, 'h': 45, 'c': 90, 'p': 50, 's': 10
    };
    
    // 简单的位置评估加成 (简化版)
    function evaluateBoard() {
        let score = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const p = board[r][c];
                if (p) {
                    let val = PIECE_VALUES[p.type];
                    // 简单的过河兵加成
                    if (p.type === PIECES.SOLDIER) {
                        if (p.color === RED && r < 5) val += 10;
                        if (p.color === BLACK && r > 4) val += 10;
                    }
                    score += (p.color === RED ? val : -val);
                }
            }
        }
        // 如果是我方 AI (黑方)，希望分数越小越好 (RED是正分) -> 实际上通用 Minimax 习惯 Max 为己方
        // 这里设定：RED 追求正无穷，BLACK 追求负无穷
        return score;
    }

    function aiMove() {
        if (isGameOver) return;
        log('AI Thinking...');
        
        // 简单的 Minimax
        const bestMove = minimaxRoot(3, currentTurn === RED);
        if (bestMove) {
            makeMove(bestMove.from.r, bestMove.from.c, bestMove.to.r, bestMove.to.c);
        } else {
            // 无棋可走，认输
            isGameOver = true;
            showGameOver('红方获胜', '电脑无棋可走');
        }
    }

    function minimaxRoot(depth, isMaximizingPlayer) {
        const newMoves = generateAllMoves(isMaximizingPlayer ? RED : BLACK);
        let bestMove = null;
        let bestValue = isMaximizingPlayer ? -Infinity : Infinity;

        // 随机打乱 move 顺序，避免每次走一样的
        newMoves.sort(() => Math.random() - 0.5);

        // 统计历史局面
        const historyCounts = {};
        moveHistory.forEach(record => {
            if (record.fen) {
                historyCounts[record.fen] = (historyCounts[record.fen] || 0) + 1;
            }
        });

        for (const move of newMoves) {
            // 模拟
            const captured = board[move.to.r][move.to.c];
            const piece = board[move.from.r][move.from.c];
            board[move.to.r][move.to.c] = piece;
            board[move.from.r][move.from.c] = null;

            // 检查重复局面
            // 模拟移动后的回合归属
            const nextTurn = isMaximizingPlayer ? BLACK : RED;
            let oldTurn = currentTurn;
            currentTurn = nextTurn;
            const currentFen = getBoardFen();
            currentTurn = oldTurn; // 恢复

            let repetitionPenalty = 0;
            if (historyCounts[currentFen]) {
                // 如果这个局面已经出现过，给予巨大惩罚
                // 出现 1 次意味着这是第 2 次出现 -> 可能是循环
                // 出现 2 次意味着这是第 3 次出现 -> 必须禁止 (长将判负/和棋)
                // 这里简单粗暴：只要重复就给负分，迫使 AI 变招
                repetitionPenalty = isMaximizingPlayer ? -5000 : 5000; 
                // 注意：MaximizingPlayer (红/黑) 想要最大/最小化
                // 如果当前是 Maximizing (比如红方)，它想要高分。如果重复，给它减分。
                // 如果当前是 Minimizing (比如黑方)，它想要低分。如果重复，给它加分。
            }

            let value = minimax(depth - 1, -Infinity, Infinity, !isMaximizingPlayer);
            
            // 加上重复惩罚
            // 如果是 MaximizingPlayer (红)，重复了，value 变小
            // 如果是 MinimizingPlayer (黑)，重复了，value 变大
            if (repetitionPenalty !== 0) {
                 value += repetitionPenalty;
            }

            // 还原
            board[move.from.r][move.from.c] = piece;
            board[move.to.r][move.to.c] = captured;

            if (isMaximizingPlayer) {
                if (value > bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            } else {
                if (value < bestValue) {
                    bestValue = value;
                    bestMove = move;
                }
            }
        }
        return bestMove;
    }

    function minimax(depth, alpha, beta, isMaximizingPlayer) {
        if (depth === 0) {
            return evaluateBoard();
        }

        const moves = generateAllMoves(isMaximizingPlayer ? RED : BLACK);
        if (moves.length === 0) {
            // 无路可走，被绝杀
            return isMaximizingPlayer ? -20000 : 20000;
        }

        if (isMaximizingPlayer) {
            let maxEval = -Infinity;
            for (const move of moves) {
                const captured = board[move.to.r][move.to.c];
                const piece = board[move.from.r][move.from.c];
                board[move.to.r][move.to.c] = piece;
                board[move.from.r][move.from.c] = null;
                
                const eval = minimax(depth - 1, alpha, beta, false);
                
                board[move.from.r][move.from.c] = piece;
                board[move.to.r][move.to.c] = captured;

                maxEval = Math.max(maxEval, eval);
                alpha = Math.max(alpha, eval);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of moves) {
                const captured = board[move.to.r][move.to.c];
                const piece = board[move.from.r][move.from.c];
                board[move.to.r][move.to.c] = piece;
                board[move.from.r][move.from.c] = null;

                const eval = minimax(depth - 1, alpha, beta, true);

                board[move.from.r][move.from.c] = piece;
                board[move.to.r][move.to.c] = captured;

                minEval = Math.min(minEval, eval);
                beta = Math.min(beta, eval);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    function generateAllMoves(color) {
        let moves = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c] && board[r][c].color === color) {
                    const legals = getLegalMoves(r, c, true); // 必须检查自杀
                    legals.forEach(to => {
                        moves.push({from: {r, c}, to});
                    });
                }
            }
        }
        return moves;
    }


    // --- 渲染与交互 ---
    
    function renderBoard() {
        const $piecesLayer = $('#pieces-layer');
        $piecesLayer.empty();
        
        // 渲染棋子
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const p = board[r][c];
                if (p) {
                    const $el = $('<div>').addClass('chess-piece');
                    $el.addClass(p.color === RED ? 'piece-red' : 'piece-black');
                    
                    // 计算位置 (百分比)
                    $el.css({
                        left: (c * 11.11) + '%',
                        top: (r * 10) + '%'
                    });
                    
                    const $inner = $('<div>').addClass('chess-piece-inner').text(PIECE_TEXT[p.color][p.type]);
                    $el.append($inner);
                    
                    // 选中状态
                    if (selectedPos && selectedPos.r === r && selectedPos.c === c) {
                        $el.addClass('selected');
                    }

                    // 上一步标记
                    if (lastMove && lastMove.to.r === r && lastMove.to.c === c) {
                        $el.addClass('last-move');
                    }
                    
                    $piecesLayer.append($el);
                }
            }
        }

        // 渲染可移动提示点
        const $interaction = $('#interaction-layer');
        $interaction.empty(); // 清除旧的
        
        // 创建点击网格
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                $('<div>').data({r, c}).appendTo($interaction);
            }
        }

        // 如果选中了棋子，显示可行点
        if (selectedPos) {
            const moves = getLegalMoves(selectedPos.r, selectedPos.c);
            moves.forEach(m => {
                const $hint = $('<div>').addClass('move-hint');
                $hint.css({
                    left: (m.c * 11.11) + '%',
                    top: (m.r * 10) + '%'
                });
                if (board[m.r][m.c]) {
                    $hint.addClass('capture');
                }
                $piecesLayer.append($hint); // 添加到棋子层以显示在上方
            });
        }
    }

    function handleBoardClick(r, c) {
        if (isGameOver) return;
        log('Clicked Board:', r, c);
        
        // 只能操作己方回合
        if (gameMode === 'online' && currentTurn !== mySide) return;
        if (gameMode === 'pvai' && currentTurn !== mySide) return; // AI思考时不能动

        const clickedPiece = board[r][c];
        
        // 1. 如果已选中棋子，且点击了合法移动位置 -> 移动
        if (selectedPos) {
            const moves = getLegalMoves(selectedPos.r, selectedPos.c);
            const move = moves.find(m => m.r === r && m.c === c);
            
            if (move) {
                // 执行移动
                if (gameMode === 'online') {
                    sendMove(selectedPos.r, selectedPos.c, r, c);
                }
                makeMove(selectedPos.r, selectedPos.c, r, c);
                return;
            }
        }

        // 2. 如果点击的是己方棋子 -> 选中
        if (clickedPiece && clickedPiece.color === currentTurn) {
            selectedPos = {r, c};
            playSound('select');
            renderBoard();
        } else {
            // 点击空白或对方棋子(且不能吃) -> 取消选中
            selectedPos = null;
            renderBoard();
        }
    }

    // Toast 提示
    function showToast(message, duration = 3000) {
        const $toast = $('<div>')
            .addClass('bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm animate-fade-in-up')
            .text(message);
        
        $('#toast-container').append($toast);
        
        setTimeout(() => {
            $toast.fadeOut(300, () => $toast.remove());
        }, duration);
    }

    function bindEvents() {
        // 强制退出按钮
        $('#btn-force-quit').click(() => {
            location.reload();
        });

        // 棋盘点击代理
        $('#interaction-layer').on('click', 'div', function() {
            const {r, c} = $(this).data();
            handleBoardClick(r, c);
        });

        // 菜单按钮
        $('#btn-ai').click(() => startGame('pvai'));
        $('#btn-pvp').click(() => startGame('pvp'));
        $('#btn-endgame').click(() => {
            $('#lobby-menu').addClass('hidden');
            $('#endgame-list').removeClass('hidden');
            renderEndgameList();
        });
        $('#btn-back-lobby').click(() => {
            $('#endgame-list').addClass('hidden');
            $('#lobby-menu').removeClass('hidden');
        });
        
        // 游戏内按钮
        $('#btn-undo').click(undoMove);
        $('#btn-giveup').click(() => {
            if (confirm('确定认输吗？')) {
                if (gameMode === 'online' && conn && conn.open) {
                    conn.send({ type: 'giveup' });
                }
                
                let winnerText = '';
                if (gameMode === 'online' || gameMode === 'pvai') {
                     winnerText = (mySide === RED ? '黑方获胜' : '红方获胜');
                } else {
                     // 本地 PvP，默认当前回合方认输
                     winnerText = (currentTurn === RED ? '黑方获胜' : '红方获胜');
                }
                
                showGameOver(winnerText, '认输');
            }
        });
        $('#btn-restart').click(() => {
            if (gameMode === 'online') {
                if (isHost) {
                    if (conn && conn.open) {
                        conn.send({ type: 'restart' });
                    }
                    $('#message-overlay').addClass('hidden');
                    startGame('online');
                }
            } else {
                $('#message-overlay').addClass('hidden');
                startGame(gameMode);
            }
        });
        $('#btn-quit').click(() => {
             location.reload();
        });

        // 在线功能
        $('#btn-create').click(createRoom);
        $('#btn-join').click(() => {
            const roomId = $('#room-id-input').val().trim();
            if (roomId) joinRoom(roomId);
        });
        $('#btn-copy').click(function() {
            const url = $('#share-url').val();
            // 使用更兼容的复制方法
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(() => {
                    const originText = $(this).text();
                    $(this).text('已复制!');
                    setTimeout(() => $(this).text(originText), 2000);
                }).catch(err => {
                     console.error('Failed to copy: ', err);
                     fallbackCopyTextToClipboard(url, $(this));
                });
            } else {
                fallbackCopyTextToClipboard(url, $(this));
            }
        });
    }

    function fallbackCopyTextToClipboard(text, $btn) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        
        // Avoid scrolling to bottom
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                const originText = $btn.text();
                $btn.text('已复制!');
                setTimeout(() => $btn.text(originText), 2000);
            } else {
                alert('复制失败，请手动复制');
            }
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
            alert('复制失败，请手动复制');
        }

        document.body.removeChild(textArea);
    }

    function startGame(mode) {
        log('Start Game:', mode);
        gameMode = mode;
        $('#lobby').addClass('hidden');
        // 重置大厅状态，以便返回时正常显示
        $('#lobby-menu').removeClass('hidden');
        $('#endgame-list').addClass('hidden');
        $('#game-area').removeClass('hidden');
        
        if (mode === 'pvai') {
            mySide = RED; // 玩家默认红方
            initBoard();
            startTimer();
        } else if (mode === 'pvp') {
            // pvp 模式下 mySide 默认为 RED，或者我们可以让 mySide 随 currentTurn 变？
            // 不，mySide 用于 UI 显示 "我" 的位置。
            // 在本地 PvP，通常不旋转棋盘，所以 "我" (下方) 应该是红方视角。
            mySide = RED; 
            initBoard();
            startTimer();
        } else if (mode === 'online') {
            initBoard();
            startTimer();
        }
    }

    function showGameOver(title, desc) {
        stopTimer();
        $('#message-title').text(title);
        $('#message-desc').text(desc);
        
        // 修正旋转问题：如果棋盘翻转了，消息框也要翻转回来
        if ($('#board-container').hasClass('rotate-180')) {
             $('#message-overlay').children().addClass('rotate-180');
        } else {
             $('#message-overlay').children().removeClass('rotate-180');
        }
        
        // 联机模式下，只有房主能点再来一局
        if (gameMode === 'online' && !isHost) {
            $('#btn-restart').addClass('hidden');
        } else {
            $('#btn-restart').removeClass('hidden');
        }
        
        $('#message-overlay').removeClass('hidden');
        isGameOver = true;
    }

    function showCheckEffect() {
        const kingPos = findKing(currentTurn);
        if (kingPos) {
            const $effect = $('<div>').addClass('check-effect')
                .css({
                    left: (kingPos.c * 11.11) + '%',
                    top: (kingPos.r * 10) + '%'
                });
            $('#effects-layer').append($effect);
            setTimeout(() => $effect.remove(), 2000);
        }
    }

    function updateStatusUI() {
        const redTurn = currentTurn === RED;
        let text = redTurn ? '红方回合' : '黑方回合';
        
        // 如果有超时记录，显示出来
        if (redTurn && redTimeoutCount > 0) text += ` (超时 ${redTimeoutCount}/3)`;
        if (!redTurn && blackTimeoutCount > 0) text += ` (超时 ${blackTimeoutCount}/3)`;

        $('#turn-indicator').text(text)
            .removeClass('bg-slate-100 bg-red-100 bg-slate-800 text-white')
            .addClass(redTurn ? 'bg-red-100 text-red-800' : 'bg-slate-800 text-white');
    }

    function updateHistoryUI() {
        const $history = $('#move-history');
        $history.empty();
        moveHistory.forEach((m, i) => {
            const $item = $('<div>').text(`${i+1}. ${m.notation}`);
            $history.append($item);
        });
        $history.scrollTop($history[0].scrollHeight);
    }

    // --- 计时器逻辑 ---
    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        
        timerInterval = setInterval(() => {
            if (isGameOver) {
                stopTimer();
                return;
            }
            
            if (currentTurn === RED) {
                redTime--;
                if (redTime <= 0) {
                    redTimeoutCount++;
                    if (redTimeoutCount >= 3) {
                        stopTimer();
                        showGameOver('黑方获胜', '红方超时3次');
                    } else {
                        // 给予额外读秒时间 (例如3分钟)
                        redTime = 180;
                        playSound('check'); // 播放提示音
                        // 简单的视觉提示，也可以用 Toast
                        $('#turn-indicator').text(`红方超时 (${redTimeoutCount}/3)`);
                    }
                }
            } else {
                blackTime--;
                if (blackTime <= 0) {
                    blackTimeoutCount++;
                    if (blackTimeoutCount >= 3) {
                        stopTimer();
                        showGameOver('红方获胜', '黑方超时3次');
                    } else {
                        blackTime = 180;
                        playSound('check');
                        $('#turn-indicator').text(`黑方超时 (${blackTimeoutCount}/3)`);
                    }
                }
            }
            updateTimerUI();
        }, 1000);
        
        updateTimerUI();
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    function updateTimerUI() {
        const formatTime = (t) => {
            const m = Math.floor(t / 60).toString().padStart(2, '0');
            const s = (t % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        // 默认视角：我方在下，对方在上
        // 如果是在线模式且我执黑，或者本地模式翻转视角（暂不支持），则需要交换显示
        
        // 简单逻辑：
        // bottom 显示 mySide 的时间
        // top 显示 !mySide 的时间
        
        // 在本地 PvP (mySide=RED) 或 PvAI (mySide=RED) 或 Online Host (mySide=RED)
        // bottom -> RED, top -> BLACK
        
        // 在 Online Guest (mySide=BLACK)
        // bottom -> BLACK, top -> RED
        
        let bottomTime, topTime;
        
        if (mySide === RED) {
            bottomTime = redTime;
            topTime = blackTime;
        } else {
            bottomTime = blackTime;
            topTime = redTime;
        }
        
        $('#timer-bottom').text(formatTime(bottomTime));
        $('#timer-top').text(formatTime(topTime));
        
        // 颜色提示
        if (currentTurn === mySide) {
             $('#timer-bottom').addClass('text-red-600 font-bold').removeClass('text-slate-500');
             $('#timer-top').removeClass('text-red-600 font-bold').addClass('text-slate-500');
        } else {
             $('#timer-top').addClass('text-red-600 font-bold').removeClass('text-slate-500');
             $('#timer-bottom').removeClass('text-red-600 font-bold').addClass('text-slate-500');
        }
    }

    // --- 音效系统 ---
    let isMuted = false;

    function initAudio() {
        // 简单的合成音效，不需要加载文件
        $(document).on('click', () => {
            if (audioCtx.state === 'suspended') audioCtx.resume();
        });

        // 绑定静音按钮事件
        $('#btn-sound').click(function() {
            isMuted = !isMuted;
            if (isMuted) {
                $(this).html('🔇 声音: 关')
                       .addClass('text-slate-400 bg-slate-50')
                       .removeClass('text-slate-700 bg-slate-100');
            } else {
                $(this).html('🔊 声音: 开')
                       .addClass('text-slate-700 bg-slate-100')
                       .removeClass('text-slate-400 bg-slate-50');
            }
        });
    }

    function playSound(type) {
        if (isMuted) return;
        if (audioCtx.state === 'suspended') return;
        
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        if (type === 'select') {
            osc.frequency.setValueAtTime(400, t);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
            osc.start(t);
            osc.stop(t + 0.1);
        } else if (type === 'move') {
            osc.frequency.setValueAtTime(200, t);
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
            osc.start(t);
            osc.stop(t + 0.1);
        } else if (type === 'capture') {
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.linearRampToValueAtTime(100, t + 0.1);
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
            osc.start(t);
            osc.stop(t + 0.2);
        } else if (type === 'check') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, t);
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
            osc.start(t);
            osc.stop(t + 0.3);
        }
    }

    // --- 残局模式 ---
    function renderEndgameList() {
        const $grid = $('#endgame-grid');
        $grid.empty();
        
        ENDGAMES.forEach((game, idx) => {
            const $card = $('<div>').addClass('bg-amber-50 p-4 rounded-lg border border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors')
                .append($('<h4>').addClass('font-bold text-slate-800').text(game.title))
                .append($('<p>').addClass('text-sm text-slate-600').text(game.desc))
                .click(() => startEndgame(idx));
            $grid.append($card);
        });
    }

    function startEndgame(idx) {
        const game = ENDGAMES[idx];
        gameMode = 'pvai'; // 残局也是打 AI
        mySide = RED;
        
        // 隐藏大厅（包括残局列表）
        $('#lobby').addClass('hidden');
        $('#lobby-menu').removeClass('hidden'); // 重置
        $('#endgame-list').addClass('hidden');
        $('#game-area').removeClass('hidden');
        
        // 初始化残局棋盘
        board = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
        game.setup.forEach(p => {
            board[p.r][p.c] = { type: p.type, color: p.color };
        });
        
        currentTurn = RED;
        isGameOver = false;
        moveHistory = [];
        redTime = 1200;
        blackTime = 1200;
        redTimeoutCount = 0;
        blackTimeoutCount = 0;
        renderBoard();
        updateStatusUI();
        startTimer();
    }

    // --- 在线对战 (PeerJS) ---
    
    function createRoom() {
        $('#create-room-section').addClass('hidden');
        $('#waiting-section').removeClass('hidden');
        
        initPeer(null, (id) => {
            const url = new URL(window.location.href);
            url.searchParams.set('room', id);
            $('#share-url').val(url.toString());
            $('#btn-copy').prop('disabled', false);
            
            isHost = true;
            mySide = RED; // 房主执红
        });
    }

    function joinRoom(hostId) {
        initPeer(null, (id) => {
            connectToPeer(hostId);
        });
    }

    function initPeer(forceId, callback) {
        log('Init PeerJS');
        // 使用 peer-config.js 中的配置
        peer = new Peer(forceId, PEER_CONFIG);
        
        peer.on('open', (id) => {
            myPeerId = id;
            log('My Peer ID:', id);
            if (callback) callback(id);
        });
        
        peer.on('connection', (connection) => {
            // 被动连接 (房主)
            if (conn && conn.open) {
                conn.close();
            }
            conn = connection;
            setupConnection();
            
            // 隐藏重连遮罩
            $('#reconnect-overlay').addClass('hidden');
            showToast('对手已连接');
            
            // 房主发送初始状态
            conn.on('open', () => {
                if (hasGameStarted) {
                     // 同步状态
                     conn.send({
                         type: 'sync',
                         board: board,
                         currentTurn: currentTurn,
                         moveHistory: moveHistory,
                         redTime: redTime,
                         blackTime: blackTime,
                         redTimeoutCount: redTimeoutCount,
                         blackTimeoutCount: blackTimeoutCount,
                         side: BLACK,
                         isGameOver: isGameOver
                     });
                } else {
                    startGame('online');
                    hasGameStarted = true;
                    conn.send({ type: 'start', side: BLACK }); // 告诉对方执黑
                }
            });
        });

        peer.on('error', (err) => {
            console.error(err);
            showToast('连接服务器失败，请重试');
        });
    }

    function connectToPeer(hostId) {
        conn = peer.connect(hostId);
        setupConnection();
    }

    function setupConnection() {
        conn.on('data', (data) => {
            log('Received:', data);
            
            if (data.type === 'start') {
                mySide = data.side; // 接收分配的阵营
                startGame('online');
                // 如果是后手，翻转棋盘视角 (TODO: CSS transform)
                if (mySide === BLACK) {
                     $('#board-container').addClass('rotate-180');
                     // 棋子也要转回来
                     // CSS rule handles .chess-piece-inner rotation
                }
            } else if (data.type === 'move') {
                makeMove(data.from.r, data.from.c, data.to.r, data.to.c);
            } else if (data.type === 'undo_request') {
                if (confirm('对方请求悔棋（回退2步），是否同意？')) {
                    undoMoveLocal(); // 我方也回退
                    conn.send({ type: 'undo_accept' });
                } else {
                    conn.send({ type: 'undo_reject' });
                }
            } else if (data.type === 'undo_accept') {
                undoMoveLocal(); // 对方同意了，我方回退
                showToast('对方同意了您的悔棋请求。');
            } else if (data.type === 'undo_reject') {
                showToast('对方拒绝了您的悔棋请求。');
            } else if (data.type === 'giveup') {
                showGameOver(mySide === RED ? '红方获胜' : '黑方获胜', '对方认输');
            } else if (data.type === 'sync') {
                // 恢复状态
                board = data.board;
                currentTurn = data.currentTurn;
                moveHistory = data.moveHistory;
                redTime = data.redTime;
                blackTime = data.blackTime;
                redTimeoutCount = data.redTimeoutCount;
                blackTimeoutCount = data.blackTimeoutCount;
                mySide = data.side;
                isGameOver = data.isGameOver;

                // 切换界面
                gameMode = 'online';
                $('#lobby').addClass('hidden');
                $('#lobby-menu').removeClass('hidden');
                $('#endgame-list').addClass('hidden');
                $('#game-area').removeClass('hidden');

                // 恢复 UI
                renderBoard();
                updateStatusUI();
                updateHistoryUI();
                updateTimerUI();
                
                if (mySide === BLACK) {
                     $('#board-container').addClass('rotate-180');
                } else {
                     $('#board-container').removeClass('rotate-180');
                }
                
                if (isGameOver) {
                    showGameOver('游戏结束', '已恢复结束状态');
                } else {
                    startTimer();
                }
            } else if (data.type === 'restart') {
                $('#message-overlay').addClass('hidden');
                startGame('online');
            }
        });
        
        conn.on('close', () => {
            $('#reconnect-overlay').removeClass('hidden');
            showToast('对手已断开连接，等待重连...');
        });
    }

    function sendMove(fr, fc, tr, tc) {
        log('Send Move:', fr, fc, 'to', tr, tc);
        if (conn && conn.open) {
            conn.send({
                type: 'move',
                from: {r: fr, c: fc},
                to: {r: tr, c: tc}
            });
        }
    }
    
    // 启动
    init();

    // 检查 URL 是否有房间号
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        // 自动加入
        $('#room-id-input').val(roomParam);
        // 可以选择自动点击加入，或者让用户点
        $('#btn-join').click();
    }
});
