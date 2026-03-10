
$(document).ready(function() {
    // --- Toast 提示 ---
    function showToast(message, type = 'info') {
        const $container = $('#toast-container');
        if ($container.length === 0) {
            $('body').append('<div id="toast-container" class="fixed top-4 right-4 z-[100] flex flex-col gap-2"></div>');
        }

        const colors = {
            info: 'bg-slate-800 text-white',
            success: 'bg-green-600 text-white',
            error: 'bg-red-600 text-white',
            warning: 'bg-yellow-500 text-white'
        };

        const $toast = $(`
            <div class="${colors[type]} px-6 py-3 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full opacity-0 flex items-center gap-2">
                <span>${message}</span>
            </div>
        `);

        $('#toast-container').append($toast);

        // 动画显示
        requestAnimationFrame(() => {
            $toast.removeClass('translate-x-full opacity-0');
        });

        // 自动消失
        setTimeout(() => {
            $toast.addClass('translate-x-full opacity-0');
            setTimeout(() => $toast.remove(), 300);
        }, 3000);
    }

    // --- 提示逻辑 ---
    const RULES = {
        8: { eats: '狮、虎、豹、狼、狗、猫', note: '不能吃鼠' },
        7: { eats: '虎、豹、狼、狗、猫、鼠', note: '可跳河' },
        6: { eats: '豹、狼、狗、猫、鼠', note: '可跳河' },
        5: { eats: '狼、狗、猫、鼠', note: '' },
        4: { eats: '狗、猫、鼠', note: '' },
        3: { eats: '猫、鼠', note: '' },
        2: { eats: '鼠', note: '' },
        1: { eats: '象', note: '可下河，陆地不能吃河里的鼠' }
    };

    $('#board').on('mouseenter', '.piece', function(e) {
        const pieceId = $(this).data('id'); // blue-elephant
        // 解析 ID 获取信息
        // ID 格式: color-engName (例如: blue-elephant)
        // 我们需要反查 rank
        const engName = pieceId.split('-')[1];
        let rank = 0;
        for (const [r, p] of Object.entries(PIECES)) {
            if (p.eng === engName) {
                rank = parseInt(r);
                break;
            }
        }
        
        if (rank > 0) {
            const rule = RULES[rank];
            const pInfo = PIECES[rank];
            let text = `${pInfo.name}`;
            if (rule.eats) text += `\n可吃: ${rule.eats}`;
            if (rule.note) text += `\n注意: ${rule.note}`;
            
            showTooltip(text, $(this));
        }
    }).on('mouseleave', '.piece', function() {
        hideTooltip();
    });

    function showTooltip(text, $target) {
        let $tooltip = $('#game-tooltip');
        if ($tooltip.length === 0) {
            $('body').append('<div id="game-tooltip" class="tooltip hidden"></div>');
            $tooltip = $('#game-tooltip');
        }
        
        $tooltip.text(text).removeClass('hidden');
        
        // 计算位置
        const offset = $target.offset();
        const width = $target.outerWidth();
        
        $tooltip.css({
            top: offset.top,
            left: offset.left + width / 2
        });
    }

    function hideTooltip() {
        $('#game-tooltip').addClass('hidden');
    }

    // --- Audio Manager ---
    const audioManager = {
        ctx: null,
        init: function() {
            if (!this.ctx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AudioContext();
            }
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(e => console.log(e));
            }
        },
        playTone: function(freq, type, duration, vol = 0.1) {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        },
        playSelect: function() {
            this.init();
            this.playTone(880, 'sine', 0.05, 0.05);
        },
        playMove: function() {
            this.init();
            this.playTone(300, 'triangle', 0.1, 0.1);
        },
        playCapture: function() {
            this.init();
            const bufferSize = this.ctx.sampleRate * 0.1;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
            noise.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start();
            
            this.playTone(150, 'sawtooth', 0.15, 0.15);
        },
        playWin: function() {
            this.init();
            [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.playTone(f, 'sine', 0.3, 0.1), i * 150));
        }
    };

    // --- 常量定义 ---
    const ROWS = 9;
    const COLS = 7;
    const BLUE = 1; // 上方
    const RED = 2;  // 下方
    
    // 棋子定义
    const PIECES = {
        8: { name: '象', rank: 8, emoji: '🐘', eng: 'elephant' },
        7: { name: '狮', rank: 7, emoji: '🦁', eng: 'lion' },
        6: { name: '虎', rank: 6, emoji: '🐯', eng: 'tiger' },
        5: { name: '豹', rank: 5, emoji: '🐆', eng: 'leopard' },
        4: { name: '狼', rank: 4, emoji: '🐺', eng: 'wolf' },
        3: { name: '狗', rank: 3, emoji: '🐕', eng: 'dog' },
        2: { name: '猫', rank: 2, emoji: '🐱', eng: 'cat' },
        1: { name: '鼠', rank: 1, emoji: '🐭', eng: 'rat' }
    };

    // 初始布局 (rank)
    // Blue (Top)
    const INITIAL_BLUE = [
        { r: 0, c: 0, rank: 7 }, { r: 0, c: 6, rank: 6 },
        { r: 1, c: 1, rank: 3 }, { r: 1, c: 5, rank: 2 },
        { r: 2, c: 0, rank: 1 }, { r: 2, c: 2, rank: 5 }, { r: 2, c: 4, rank: 4 }, { r: 2, c: 6, rank: 8 }
    ];
    // Red (Bottom)
    const INITIAL_RED = [
        { r: 8, c: 6, rank: 7 }, { r: 8, c: 0, rank: 6 },
        { r: 7, c: 5, rank: 3 }, { r: 7, c: 1, rank: 2 },
        { r: 6, c: 6, rank: 1 }, { r: 6, c: 4, rank: 5 }, { r: 6, c: 2, rank: 4 }, { r: 6, c: 0, rank: 8 }
    ];

    // 地形定义
    function getTerrain(r, c) {
        // 河流
        if (r >= 3 && r <= 5) {
            if (c === 1 || c === 2 || c === 4 || c === 5) return 'river';
        }
        // 兽穴
        if (r === 0 && c === 3) return 'den_blue';
        if (r === 8 && c === 3) return 'den_red';
        // 陷阱
        if ((r === 0 && c === 2) || (r === 0 && c === 4) || (r === 1 && c === 3)) return 'trap_blue';
        if ((r === 8 && c === 2) || (r === 8 && c === 4) || (r === 7 && c === 3)) return 'trap_red';
        
        return 'land';
    }

    // --- 状态变量 ---
    let board = []; // 存储 { player: BLUE/RED, rank: 1-8 } 或 null
    let currentPlayer = RED; // 红方先手
    let selectedPos = null; // {r, c}
    let validMoves = []; // [{r, c}, ...]
    let lastMove = null; // { from: {r, c}, to: {r, c} }
    let historyStack = []; // [{board, currentPlayer, lastMove}, ...]
    let gameMode = 'pvai'; // 'pvai', 'pvp', 'online'
    let isGameActive = false;
    let myColor = RED; // 在线/AI模式下的己方颜色
    let aiPlayer = BLUE; // AI 执蓝
    
    // 在线相关
    let peer = null;
    let conn = null;
    let myId = null;
    let isHost = false;
    let isReconnecting = false; // 是否处于等待重连状态

    // --- 初始化 ---
    function initBoard() {
        board = Array(ROWS).fill(null).map(() => Array(COLS).fill(null));
        
        INITIAL_BLUE.forEach(p => {
            board[p.r][p.c] = { player: BLUE, rank: p.rank };
        });
        INITIAL_RED.forEach(p => {
            board[p.r][p.c] = { player: RED, rank: p.rank };
        });

        // 清除状态
        selectedPos = null;
        validMoves = [];
        lastMove = null;
        historyStack = [];
        currentPlayer = RED;
        isGameActive = true;
        
        createBoardDOM(); // 只创建一次 DOM
        updateBoardUI();  // 更新 UI
        updateStatus();
        updatePerspective();
    }

    function updatePerspective() {
        const $board = $('#board');
        // 如果是联机模式且自己是蓝方，或者是人机模式且自己是蓝方(虽然默认人机是红方)，则翻转
        // 目前人机 myColor 默认 RED。
        // 在线 Guest 是 BLUE。
        if ((gameMode === 'online' || gameMode === 'pvai') && myColor === BLUE) {
            $board.addClass('board-flipped');
        } else {
            $board.removeClass('board-flipped');
        }
    }

    // 生成默认棋子图片 (SVG)
    function createPieceSVG(rank, color) {
        const p = PIECES[rank];
        const colorCode = color === BLUE ? '#3498db' : '#e74c3c';
        // 极简风格：白色背景，中间是Emoji
        const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="48" fill="#ecf0f1" stroke="${colorCode}" stroke-width="4"/>
            <text x="50" y="65" font-size="50" text-anchor="middle" font-family="Arial, sans-serif">${p.emoji}</text>
        </svg>`.trim();
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    }

    // 创建棋盘 DOM 结构 (仅执行一次)
    function createBoardDOM() {
        const $board = $('#board');
        $board.empty();

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const terrain = getTerrain(r, c);
                
                const $cell = $('<div>')
                    .addClass('cell')
                    .attr('data-r', r)
                    .attr('data-c', c);

                // 地形样式 (静态)
                if (terrain === 'river') $cell.addClass('river');
                else if (terrain.startsWith('trap')) $cell.addClass('trap');
                else if (terrain.startsWith('den')) $cell.addClass('den');

                $board.append($cell);
            }
        }
    }

    // 增量更新 UI
    function updateBoardUI() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const $cell = $(`.cell[data-r="${r}"][data-c="${c}"]`);
                const piece = board[r][c];

                // 1. 更新状态 Class
                $cell.removeClass('selected valid-move enemy last-move-from last-move-to');

                // 选中高亮
                if (selectedPos && selectedPos.r === r && selectedPos.c === c) {
                    $cell.addClass('selected');
                }

                // 可移动提示
                const moveIdx = validMoves.findIndex(m => m.r === r && m.c === c);
                if (moveIdx !== -1) {
                    $cell.addClass('valid-move');
                    if (piece) $cell.addClass('enemy');
                }

                // 上一步移动标记
                if (lastMove) {
                    if (lastMove.from.r === r && lastMove.from.c === c) {
                        $cell.addClass('last-move-from');
                    }
                    if (lastMove.to.r === r && lastMove.to.c === c) {
                        $cell.addClass('last-move-to');
                    }
                }

                // 2. 更新棋子 (Diff Update)
                const currentPieceHtml = $cell.find('.piece').prop('outerHTML');
                
                if (piece) {
                    const pInfo = PIECES[piece.rank];
                    const colorClass = piece.player === BLUE ? 'blue' : 'red';
                    // 构造一个唯一标识 key，避免不必要的重绘
                    const pieceId = `${colorClass}-${pInfo.eng}`;
                    
                    // 检查是否已经存在且是同一个棋子
                    const $existingPiece = $cell.find('.piece');
                    if ($existingPiece.length > 0 && $existingPiece.data('id') === pieceId) {
                        // 棋子没变，跳过 DOM 操作
                        continue;
                    }

                    // 创建新棋子
                    const $piece = $('<div>')
                        .addClass('piece')
                        .addClass(colorClass)
                        .data('id', pieceId); // 存储 ID 用于比对
                    
                    const $inner = $('<div>').addClass('piece-inner');
                    const imgPath = `img/${pInfo.eng}.png`;
                    const svgData = createPieceSVG(piece.rank, piece.player);
                    
                    const $img = $('<img>')
                        .attr('src', imgPath)
                        .addClass('w-full h-full object-cover rounded-full')
                        .on('error', function() {
                            $(this).attr('src', svgData);
                        });
                    
                    $inner.append($img);
                    $piece.append($inner);
                    
                    $cell.empty().append($piece); // 替换旧棋子
                } else {
                    // 如果本来有棋子，现在没了，才清空
                    if ($cell.find('.piece').length > 0) {
                        $cell.empty();
                    }
                }
            }
        }
    }

    // 替换原有的 renderBoard 为 updateBoardUI (兼容旧调用)
    function renderBoard() {
        updateBoardUI();
    }

    function updateStatus() {
        $('#player-blue').removeClass('player-active');
        $('#player-red').removeClass('player-active');
        
        const blueText = currentPlayer === BLUE ? '思考中...' : '等待';
        const redText = currentPlayer === RED ? '思考中...' : '等待';
        
        $('#player-blue .status-text').text(blueText);
        $('#player-red .status-text').text(redText);

        if (currentPlayer === BLUE) $('#player-blue').addClass('player-active');
        else $('#player-red').addClass('player-active');
    }

    // --- 核心规则逻辑 ---

    // 检查是否在河里
    function isRiver(r, c) {
        return getTerrain(r, c) === 'river';
    }
    
    // 检查是否在陷阱
    function isTrap(r, c, player) {
        const t = getTerrain(r, c);
        // 只有在敌方陷阱才算中陷阱
        if (player === BLUE && t === 'trap_red') return true;
        if (player === RED && t === 'trap_blue') return true;
        return false;
    }

    // 检查是否是己方兽穴
    function isMyDen(r, c, player) {
        const t = getTerrain(r, c);
        if (player === BLUE && t === 'den_blue') return true;
        if (player === RED && t === 'den_red') return true;
        return false;
    }

    // 判断能否吃子
    function canCapture(attacker, r1, c1, defender, r2, c2) {
        // attacker: {player, rank}, defender: {player, rank}
        // r1, c1: attacker pos; r2, c2: defender pos

        // 1. 陷阱规则：敌方在己方陷阱里，无视等级直接吃
        if (isTrap(r2, c2, defender.player)) return true;

        // 2. 鼠吃象
        if (attacker.rank === 1 && defender.rank === 8) {
            // 鼠不能从河里吃岸上的象
            if (isRiver(r1, c1) && !isRiver(r2, c2)) return false;
            return true;
        }
        
        // 3. 象不能吃鼠
        if (attacker.rank === 8 && defender.rank === 1) return false;

        // 4. 等级判定 (大吃小，同级互吃)
        if (attacker.rank >= defender.rank) {
            // 特殊：陆地不能吃河里的鼠
            if (!isRiver(r1, c1) && isRiver(r2, c2) && defender.rank === 1) return false;
            // 鼠在河里可以吃河里的鼠
            return true;
        }

        return false;
    }

    // 获取某个位置棋子的所有合法移动
    function getValidMoves(r, c) {
        const piece = board[r][c];
        if (!piece) return [];
        
        const moves = [];
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // 上下左右

        directions.forEach(([dr, dc]) => {
            let nr = r + dr;
            let nc = c + dc;

            // 越界检查
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;

            // 己方兽穴不可进
            if (isMyDen(nr, nc, piece.player)) return;

            // 目标位置如果有己方棋子，不可移动
            const target = board[nr][nc];
            if (target && target.player === piece.player) return;

            // --- 地形处理 ---
            const terrain = getTerrain(nr, nc);

            // 1. 河流逻辑
            if (terrain === 'river') {
                if (piece.rank === 1) {
                    // 鼠可以下河
                    // 如果河里有子
                    if (target) {
                        // 只能吃河里的鼠 (canCapture 已经包含逻辑，但这里为了清晰再次确认)
                        // 注意：canCapture(attacker, r, c, defender, nr, nc)
                        if (canCapture(piece, r, c, target, nr, nc)) {
                            moves.push({ r: nr, c: nc });
                        }
                    } else {
                        // 空河
                        moves.push({ r: nr, c: nc });
                    }
                } else if (piece.rank === 6 || piece.rank === 7) {
                    // 狮虎跳河
                    // 检查是否有老鼠阻挡
                    // 延伸直到对岸
                    while (isRiver(nr, nc)) {
                        if (board[nr][nc]) { // 河里有子（必然是鼠）
                            // 阻挡，不能跳
                            return; 
                        }
                        nr += dr;
                        nc += dc;
                    }
                    // 此时 nr, nc 是对岸的位置
                    // 检查对岸是否合法
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return; // 应该不会发生
                    
                    const targetLand = board[nr][nc];
                    if (!targetLand) {
                        moves.push({ r: nr, c: nc });
                    } else if (targetLand.player !== piece.player) {
                        if (canCapture(piece, r, c, targetLand, nr, nc)) {
                            moves.push({ r: nr, c: nc });
                        }
                    }
                }
                // 其他棋子不能进河
                return;
            }

            // 2. 陆地/陷阱/兽穴逻辑
            if (!target) {
                moves.push({ r: nr, c: nc });
            } else {
                if (canCapture(piece, r, c, target, nr, nc)) {
                    moves.push({ r: nr, c: nc });
                }
            }
        });

        return moves;
    }

    // --- 交互逻辑 ---
    function cloneBoard(b) {
        return b.map(row => row.map(cell => cell ? { ...cell } : null));
    }

    function saveState() {
        historyStack.push({
            board: cloneBoard(board),
            currentPlayer: currentPlayer,
            lastMove: lastMove ? { from: {...lastMove.from}, to: {...lastMove.to} } : null
        });
        // 限制历史记录长度
        if (historyStack.length > 50) historyStack.shift();
    }

    function undo() {
        if (historyStack.length === 0) return;
        
        // 恢复上一步
        const state = historyStack.pop();
        board = state.board;
        currentPlayer = state.currentPlayer;
        lastMove = state.lastMove;
        
        // 清除选中状态
        selectedPos = null;
        validMoves = [];
        
        renderBoard();
        updateStatus();
    }

    $('#btn-undo').click(() => {
        if (!isGameActive) return;
        
        if (gameMode === 'online') {
            if (conn) {
                // 发送悔棋请求
                showToast('已发送悔棋请求，等待对方同意...', 'info');
                conn.send({ type: 'request_undo' });
            }
            return;
        }

        if (gameMode === 'pvai') {
            // 人机模式，需要回退两步（因为AI已经走了一步）
            // 如果是 AI 思考中，不允许悔棋
            if (currentPlayer === aiPlayer) return;

            // 尝试回退
            // 正常情况下，栈顶是 AI 走之前的状态（轮到 AI），再下面是玩家走之前的状态（轮到玩家）
            // 我们需要回退到玩家走之前的状态
            
            // 1. 回退 AI 的一步
            if (historyStack.length > 0) undo();
            // 2. 回退 玩家 的一步
            if (historyStack.length > 0) undo();
        } else {
            // PvP 简单回退一步
            undo();
        }
    });

    // --- 悔棋请求处理 ---
    $('#btn-undo-agree').click(() => {
        if (conn) {
            conn.send({ type: 'undo_agree' });
            undo(); // 自己也执行悔棋
            $('#undo-request-modal').addClass('hidden');
            showToast('已同意对方悔棋', 'success');
        }
    });

    $('#btn-undo-refuse').click(() => {
        if (conn) {
            conn.send({ type: 'undo_refuse' });
            $('#undo-request-modal').addClass('hidden');
        }
    });

    $('#board').on('click', '.cell', function() {
        if (!isGameActive) return;
        
        // 模式判断：如果是联机模式，不是我的回合不能动
        if (gameMode === 'online' && currentPlayer !== myColor) return;
        // 如果是人机模式，AI回合不能动
        if (gameMode === 'pvai' && currentPlayer === aiPlayer) return;

        const r = parseInt($(this).data('r'));
        const c = parseInt($(this).data('c'));
        const clickedPiece = board[r][c];

        // 1. 选中己方棋子
        if (clickedPiece && clickedPiece.player === currentPlayer) {
            selectedPos = { r, c };
            validMoves = getValidMoves(r, c);
            renderBoard();
            audioManager.playSelect();
            return;
        }

        // 2. 移动或吃子 (必须先选中)
        if (selectedPos) {
            const move = validMoves.find(m => m.r === r && m.c === c);
            if (move) {
                // 联机模式发送移动
                if (gameMode === 'online' && conn) {
                    conn.send({
                        type: 'move',
                        from: selectedPos,
                        to: { r, c }
                    });
                }
                
                // 执行移动 (本地)
                executeMove(selectedPos, { r, c });
            } else {
                // 点击非法区域，取消选中
                selectedPos = null;
                validMoves = [];
                renderBoard();
            }
        }
    });

    function executeMove(from, to) {
        // 保存当前状态
        saveState();

        const piece = board[from.r][from.c];
        const target = board[to.r][to.c];
        
        // 播放音效
        if (target) {
            audioManager.playCapture();
        } else {
            audioManager.playMove();
        }

        // 记录最后一步
        lastMove = { from: { ...from }, to: { ...to } };

        // 移动棋子
        board[to.r][to.c] = piece;
        board[from.r][from.c] = null;

        // 检查胜利条件 (进兽穴)
        const terrain = getTerrain(to.r, to.c);
        if ((piece.player === BLUE && terrain === 'den_red') || 
            (piece.player === RED && terrain === 'den_blue')) {
            endGame(piece.player);
            renderBoard();
            return;
        }

        // 检查胜利条件 (对方无子)
        const opponent = piece.player === BLUE ? RED : BLUE;
        if (!hasPieces(opponent)) {
            endGame(piece.player);
            renderBoard();
            return;
        }

        // 切换回合
        currentPlayer = currentPlayer === BLUE ? RED : BLUE;
        selectedPos = null;
        validMoves = [];
        renderBoard();
        updateStatus();

        // AI 回合
        if (isGameActive && gameMode === 'pvai' && currentPlayer === aiPlayer) {
            setTimeout(makeAIMove, 500);
        }
    }

    function hasPieces(player) {
        for(let r=0; r<ROWS; r++) {
            for(let c=0; c<COLS; c++) {
                if (board[r][c] && board[r][c].player === player) return true;
            }
        }
        return false;
    }

    function endGame(winner) {
        audioManager.playWin();
        isGameActive = false;
        const winnerName = winner === BLUE ? '蓝方' : '红方';
        const colorClass = winner === BLUE ? 'text-blue-600' : 'text-red-600';
        
        $('#winner-text').text(`${winnerName}获胜!`).attr('class', `text-2xl font-bold mb-2 ${colorClass}`);
        $('#game-over-modal').removeClass('hidden');
    }

    // --- AI ---
    function makeAIMove() {
        if (!isGameActive) return;
        
        // 获取所有合法移动
        const allMoves = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c] && board[r][c].player === aiPlayer) {
                    const moves = getValidMoves(r, c);
                    moves.forEach(m => {
                        allMoves.push({ from: { r, c }, to: m });
                    });
                }
            }
        }

        if (allMoves.length === 0) {
            endGame(aiPlayer === BLUE ? RED : BLUE); // 无路可走判负
            return;
        }

        // 简单评估：优先吃子，优先进高价值区
        // 评分移动
        allMoves.sort((a, b) => {
            const scoreA = evaluateMove(a);
            const scoreB = evaluateMove(b);
            return scoreB - scoreA;
        });

        // 选取最佳移动 (稍微加点随机性避免死板)
        const bestMoves = allMoves.filter(m => evaluateMove(m) === evaluateMove(allMoves[0]));
        const move = bestMoves[Math.floor(Math.random() * bestMoves.length)];

        executeMove(move.from, move.to);
    }

    function evaluateMove(move) {
        let score = 0;
        const target = board[move.to.r][move.to.c];
        
        // 1. 吃子收益
        if (target) {
            score += target.rank * 10;
            // 吃掉对方高级棋子加分更多
        }

        // 2. 进兽穴收益
        const terrain = getTerrain(move.to.r, move.to.c);
        if ((aiPlayer === BLUE && terrain === 'den_red') || 
            (aiPlayer === RED && terrain === 'den_blue')) {
            score += 1000;
        }

        // 3. 进陷阱风险 (简单判断：如果进陷阱，扣分)
        if (isTrap(move.to.r, move.to.c, aiPlayer)) {
            score -= 50; 
        }

        // 4. 距离兽穴距离 (越近越好)
        const denR = aiPlayer === BLUE ? 8 : 0;
        const denC = 3;
        const distBefore = Math.abs(move.from.r - denR) + Math.abs(move.from.c - denC);
        const distAfter = Math.abs(move.to.r - denR) + Math.abs(move.to.c - denC);
        score += (distBefore - distAfter); // 靠近兽穴 +1 分

        return score;
    }

    // --- 界面控制 ---
    $('#btn-ai').click(() => {
        audioManager.init();
        gameMode = 'pvai';
        myColor = RED;
        aiPlayer = BLUE;
        startGame();
    });

    $('#btn-pvp').click(() => {
        audioManager.init();
        gameMode = 'pvp';
        startGame();
    });

    $('#btn-create').click(() => {
        audioManager.init();
        initPeer();
        $('#create-room-section').hide();
        $('#waiting-section').removeClass('hidden');
    });

    $('#btn-join').click(() => {
        audioManager.init();
        const roomId = $('#room-id-input').val().trim();
        if (!roomId) return showToast('请输入房间ID', 'warning');
        
        // 显示加载状态
        const $btn = $('#btn-join');
        $btn.prop('disabled', true).addClass('opacity-75 cursor-not-allowed');
        $('#join-loading').removeClass('hidden');
        
        initPeer(roomId);
    });

    $('#btn-copy').click(function() {
        const url = $('#share-url').val();
        const $btn = $(this);
        const originalText = $btn.text();

        const showSuccess = () => {
            $btn.text('已复制!');
            setTimeout(() => $btn.text(originalText), 2000);
        };

        const fallbackCopy = (text) => {
            try {
                const $tempInput = $('<input>');
                $('body').append($tempInput);
                $tempInput.val(text).select();
                document.execCommand('copy');
                $tempInput.remove();
                showSuccess();
            } catch (e) {
                console.error('Copy failed:', e);
                showToast('复制失败，请手动复制链接', 'error');
            }
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url)
                .then(showSuccess)
                .catch(() => fallbackCopy(url));
        } else {
            fallbackCopy(url);
        }
    });

    $('#btn-cancel-wait').click(() => {
        if (peer) peer.destroy();
        $('#waiting-section').addClass('hidden');
        $('#create-room-section').show();
    });

    $('#btn-restart, #btn-modal-restart').click(() => {
        $('#game-over-modal').addClass('hidden');
        if (gameMode === 'online') {
            if (isHost) {
                if (conn) conn.send({ type: 'restart' });
                initBoard();
            } else {
                showToast('只有房主可以重新开始游戏', 'warning');
            }
        } else {
            initBoard();
        }
    });

    $('#btn-home, #btn-modal-home').click(() => {
        $('#game-over-modal').addClass('hidden');
        $('#game-area').addClass('hidden');
        $('#lobby').removeClass('hidden');
        
        // 重置大厅状态
        $('#create-room-section').show();
        $('#waiting-section').addClass('hidden');

        if (peer) peer.destroy();
        isGameActive = false;
    });

    function startGame() {
        $('#lobby').addClass('hidden');
        $('#game-area').removeClass('hidden');
        $('#game-area').addClass('flex');
        initBoard();
    }

    // --- PeerJS 联机 ---
    // 公共 PeerJS Server 配置
    const PEER_CONFIG = {
        debug: 2
    };

    function initPeer(targetId = null) {
        peer = new Peer(null, PEER_CONFIG);

        peer.on('open', (id) => {
            myId = id;
            console.log('My ID:', id);
            
            if (targetId) {
                // 尝试连接
                connectToPeer(targetId);
            } else {
                // 等待连接 (Host)
                isHost = true;
                myColor = RED; // 房主执红(先手)
                
                const url = new URL(window.location.href);
                url.searchParams.set('room', id);
                $('#share-url').val(url.toString());
                $('#btn-copy').prop('disabled', false).removeClass('cursor-not-allowed').addClass('cursor-pointer text-orange-500');
                
                // 更新提示文字
                $('#waiting-text').text('房间创建成功! 请复制链接发送给好友');
            }
        });

        peer.on('connection', (c) => {
            // 被连接 (Host)
            if (conn && conn.open) {
                // 如果当前连接正常，拒绝新连接 (或者视情况踢掉旧连接)
                // 这里为了重连逻辑，我们需要判断是否是断线重连
                // 但简单起见，如果处于 isReconnecting 状态，则接受新连接
                if (!isReconnecting) {
                    c.close(); 
                    return; 
                }
            }
            
            // 接受连接
            if (conn) conn.close(); // 关闭旧连接（如果存在）
            conn = c;
            isReconnecting = false; // 重连成功
            $('#waiting-section').addClass('hidden'); // 隐藏等待提示(如果有)
            
            setupConnection();
            
            // 移除旧的直接发送逻辑，改为等待 'ready' 信号
            // conn.on('open', () => { ... }); 
        });

        peer.on('error', (err) => {
            console.error(err);
            showToast('连接错误: ' + err.type, 'error');
            $('#waiting-section').addClass('hidden');
            $('#create-room-section').show();
            
            // 重置加入按钮状态
            const $btn = $('#btn-join');
            $btn.prop('disabled', false).removeClass('opacity-75 cursor-not-allowed');
            $('#join-loading').addClass('hidden');
        });
    }

    function connectToPeer(id) {
        conn = peer.connect(id);
        setupConnection();
    }

    function setupConnection() {
        conn.on('open', () => {
            console.log('Connected');
            // 如果是加入者，发送准备就绪信号
            if (!isHost) {
                conn.send({ type: 'ready' });
            }
        });

        conn.on('data', (data) => {
            console.log('Received:', data);
            if (data.type === 'start') {
                // Guest 收到开始信号
                myColor = data.color; // 应该是 BLUE
                gameMode = 'online';
                startGame();
                updatePlayerLabels();
                updatePerspective(); // 确保翻转
            } else if (data.type === 'ready') {
                // Host 收到 Guest 就绪信号
                if (isHost) {
                    // 如果游戏已经在进行中（重连），发送当前状态
                    if (isGameActive && board.some(row => row.some(c => c !== null))) {
                         conn.send({
                            type: 'sync',
                            board: board,
                            currentPlayer: currentPlayer,
                            lastMove: lastMove,
                            myColor: BLUE // 告诉对方你是蓝方
                        });
                    } else {
                        // 新游戏
                        conn.send({ type: 'start', color: BLUE }); // 对方执蓝
                        gameMode = 'online';
                        startGame();
                        updatePlayerLabels();
                    }
                }
            } else if (data.type === 'sync') {
                // Guest 收到同步信号 (重连)
                board = data.board;
                currentPlayer = data.currentPlayer;
                lastMove = data.lastMove;
                myColor = data.myColor;
                gameMode = 'online';
                isGameActive = true;
                
                $('#lobby').addClass('hidden');
                $('#game-area').removeClass('hidden').addClass('flex');
                
                createBoardDOM();
                updateBoardUI();
                updateStatus();
                updatePlayerLabels();
                updatePerspective();
                
            } else if (data.type === 'move') {
                executeMove(data.from, data.to);
            } else if (data.type === 'request_undo') {
                // 收到悔棋请求
                $('#undo-request-modal').removeClass('hidden');
            } else if (data.type === 'undo_agree') {
                // 对方同意悔棋
                undo();
                showToast('对方同意了悔棋请求', 'success');
            } else if (data.type === 'undo_refuse') {
                // 对方拒绝悔棋
                showToast('对方拒绝了悔棋请求', 'error');
            } else if (data.type === 'restart') {
                initBoard();
            }
        });

        conn.on('close', () => {
            if (isHost && isGameActive) {
                // 房主发现对方断线
                showToast('对方已断开连接，等待重连...', 'warning');
                isReconnecting = true;
                // 不退出游戏，等待新连接
            } else {
                // 玩家发现房主断线 (或者游戏尚未开始时断线)
                showToast('房主已退出房间，游戏结束', 'error');
                $('#btn-home').click();
            }
        });
    }

    function updatePlayerLabels() {
        // 根据 myColor 更新 UI
        // 默认 UI 是：左边蓝方(我)，右边红方
        // 如果我是红方，左边显示红方(我)？
        // 为了简单，UI 保持 左蓝 右红。
        // 只是标记 "(我)" 的位置不同。
        
        const blueLabel = $('#player-blue div div:first-child');
        const redLabel = $('#player-red div div:first-child');
        
        if (gameMode === 'online') {
            if (myColor === BLUE) {
                blueLabel.text('蓝方 (我)');
                redLabel.text('红方 (对手)');
            } else {
                blueLabel.text('蓝方 (对手)');
                redLabel.text('红方 (我)');
            }
        } else if (gameMode === 'pvai') {
            // AI 是 Blue
            blueLabel.text('蓝方 (电脑)');
            redLabel.text('红方 (我)');
        } else {
            // PvP
            blueLabel.text('蓝方');
            redLabel.text('红方');
        }
    }
    
    // URL 参数自动加入
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        // 直接模拟点击加入
        $('#room-id-input').val(roomParam);
        $('#btn-join').click();
    }

});
