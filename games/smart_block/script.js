
// 游戏常量
const GRID_SIZE = 6;
const CELL_SIZE = 80;
const BOARD_COLOR = '#8B5A2B'; // 木纹色
const GRID_COLOR = '#5C3A1E'; // 深色木纹网格
const BLOCKER_COLOR = '#3E2723'; // 深色木纹阻挡块
const TOUCH_OFFSET_Y = 0; // 手指上方的悬浮距离（0 = 禁用）

// 积木定义
const PIECES_DEF = [
    { id: 1, name: 'Mono', color: '#ef4444', shape: [[1]] },
    { id: 2, name: 'Domino', color: '#f97316', shape: [[1, 1]] },
    { id: 3, name: 'Tromino I', color: '#f59e0b', shape: [[1, 1, 1]] },
    { id: 4, name: 'Tromino L', color: '#84cc16', shape: [[1, 0], [1, 1]] },
    { id: 5, name: 'Square', color: '#10b981', shape: [[1, 1], [1, 1]] },
    { id: 6, name: 'Tetromino T', color: '#06b6d4', shape: [[1, 1, 1], [0, 1, 0]] },
    { id: 7, name: 'Tetromino L', color: '#3b82f6', shape: [[1, 0], [1, 0], [1, 1]] },
    { id: 8, name: 'Tetromino Z', color: '#8b5cf6', shape: [[1, 1, 0], [0, 1, 1]] },
    { id: 9, name: 'Tetromino I', color: '#d946ef', shape: [[1, 1, 1, 1]] }
];

// 游戏状态
let board = [];
let pieces = [];
let blockers = [];
let isDragging = false;
let draggedPieceIndex = -1;
let dragOffset = { x: 0, y: 0 };
let startTime = 0;
let timerInterval = null;
let isGameActive = false;
let isBotMode = false;
let isMultiplayer = false;
let isHost = false;
let peer = null;
let conn = null;
let guestState = null; // 房主保存客人的积木/棋盘状态以便重连

// 画布
const canvas = document.getElementById('game-board');
const ctx = canvas.getContext('2d');
const piecesContainer = document.getElementById('pieces-container');

// 初始化
function init() {
    initBoard();
    initPieces();
    
    // 初始渲染以清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    setupEvents();
    
    // 绑定大厅按钮
    document.getElementById('btn-single').onclick = startSingleMode;
    document.getElementById('btn-multi').onclick = showCreateRoomUI;
    document.getElementById('btn-join').onclick = () => {
        const roomId = document.getElementById('room-id-input').value.trim();
        if (roomId) joinRoom(roomId);
    };
    document.getElementById('btn-cancel-wait').onclick = hideCreateRoomUI;
    
    // 绑定游戏按钮
    document.getElementById('btn-leave').onclick = leaveGame;
    document.getElementById('btn-roll').onclick = rollDice;
    document.getElementById('btn-reset').onclick = resetBoard;
    document.getElementById('btn-solve').onclick = () => {
        const solution = solvePuzzle(blockers, true);
        if (solution) {
            // 可视化解法
            // 先重置棋盘
            resetBoard();
            solution.forEach(move => {
                const piece = pieces.find(p => p.id === move.id);
                if (piece) {
                    piece.currentShape = move.shape;
                    placePieceOnBoard(piece, move.r, move.c);
                }
            });
            render();
            renderPiecesInHand();
        } else {
            alert("无解！(理论上不可能)");
        }
    };

    // 检查 URL 参数中的房间号
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId) {
        document.getElementById('room-id-input').value = roomId;
        joinRoom(roomId);
    }

    document.getElementById('btn-result-close').onclick = () => {
        document.getElementById('result-overlay').classList.add('hidden');
        if (!isMultiplayer) {
            rollDice(); // 单人模式自动重新开始？或者停留在棋盘界面
        }
        // 如果是多人游戏，可能需要等待房主？
    };
}

// UI 状态管理
function showLobby() {
    document.getElementById('lobby').classList.remove('hidden');
    document.getElementById('game-room').classList.add('hidden');
    document.getElementById('waiting-section').classList.add('hidden');
    document.getElementById('create-room-section').classList.remove('hidden');
    isGameActive = false;
    if (timerInterval) clearInterval(timerInterval);
}

function showGameRoom() {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('game-room').classList.remove('hidden');
    
    // 如果需要调整画布大小（虽然 HTML 中固定了宽度）
    // render(); 
    // renderPiecesInHand();
    // 需要稍后渲染以确保容器有尺寸
    setTimeout(() => {
        render();
        renderPiecesInHand();
    }, 100);
}

function showCreateRoomUI() {
    initHost();
    document.getElementById('create-room-section').classList.add('hidden');
    document.getElementById('waiting-section').classList.remove('hidden');
}

function hideCreateRoomUI() {
    document.getElementById('create-room-section').classList.remove('hidden');
    document.getElementById('waiting-section').classList.add('hidden');
    if (peer) {
        peer.destroy();
        peer = null;
    }
}

function leaveGame() {
    if (confirm("确定要退出游戏吗？")) {
        isGameActive = false;
        if (timerInterval) clearInterval(timerInterval);
        if (conn) conn.close();
        if (peer) peer.destroy();
        
        showLobby();
        initBoard();
        initPieces();
        document.getElementById('opponent-view').classList.add('hidden');
    }
}

function startSingleMode() {
    isMultiplayer = false;
    isBotMode = false;
    isHost = false;
    
    showGameRoom();
    document.getElementById('opponent-view').classList.add('hidden');
    document.getElementById('status-text').textContent = "单人挑战模式";
    
    // 自动掷骰子
    setTimeout(rollDice, 500);
}

function initBoard() {
    board = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    blockers = [];
}

function initPieces() {
    pieces = PIECES_DEF.map(def => ({
        ...def,
        currentShape: def.shape,
        x: 0, y: 0,
        r: -1, c: -1,
        onBoard: false,
        rotation: 0
    }));
    renderPiecesInHand();
}

function resetBoard() {
    // 清空棋盘但保留阻挡块
    board = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    blockers.forEach(b => {
        board[b.r][b.c] = -1;
    });
    
    pieces.forEach(p => {
        p.onBoard = false;
        p.r = -1;
        p.c = -1;
        p.currentShape = p.shape; // 重置旋转？也许保留。为了简单起见，我们重置它。
    });
    
    render();
    renderPiecesInHand();
    
    if (isMultiplayer && conn) {
        conn.send({ type: 'update', board: simplifyBoard() });
    }
}

// ----------------------
// 逻辑：骰子与设置
// ----------------------

function startCountdown(callback) {
    const overlay = document.getElementById('countdown-overlay');
    const number = document.getElementById('countdown-number');
    overlay.classList.remove('hidden');
    let count = 3;
    number.textContent = count;
    number.style.transform = 'scale(1)';
    
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            number.textContent = count;
            // Reset animation
            number.style.animation = 'none';
            number.offsetHeight; /* trigger reflow */
            number.style.animation = null;
        } else if (count === 0) {
            number.textContent = "GO!";
        } else {
            clearInterval(interval);
            overlay.classList.add('hidden');
            if (callback) callback();
        }
    }, 1000);
}

function showResult(title, message) {
    document.getElementById('result-title').textContent = title;
    document.getElementById('result-message').textContent = message;
    document.getElementById('result-overlay').classList.remove('hidden');
}

async function rollDice() {
    if (isMultiplayer && !isHost) return;
    
    document.getElementById('status-text').textContent = "生成谜题中...";
    document.getElementById('btn-roll').disabled = true;
    
    // 使用 setTimeout 以允许 UI 更新
    setTimeout(() => {
        let validConfigFound = false;
        let attempts = 0;
        let tempBlockers = [];

        while (!validConfigFound && attempts < 500) {
            tempBlockers = [];
            let used = new Set();
            while (tempBlockers.length < 7) {
                let r = Math.floor(Math.random() * GRID_SIZE);
                let c = Math.floor(Math.random() * GRID_SIZE);
                let key = `${r},${c}`;
                if (!used.has(key)) {
                    used.add(key);
                    tempBlockers.push({ r, c });
                }
            }
            
            if (solvePuzzle(tempBlockers)) {
                validConfigFound = true;
                blockers = tempBlockers;
            }
            attempts++;
        }

        document.getElementById('btn-roll').disabled = false;

        if (!validConfigFound) {
            alert("无法生成有效谜题，请重试。");
            document.getElementById('status-text').textContent = "生成失败";
            return;
        }

        if (isMultiplayer && isHost && conn) {
            conn.send({ type: 'pre_start', blockers: blockers });
            // 房主开始倒计时
            startGame(true);
        } else {
            // 单人模式 - 立即开始
            startGame(false);
        }
        
    }, 50);
}

function startGame(useCountdown = false) {
    // 初始隐藏求解按钮（如果允许，将在 startLogic 中显示）
    document.getElementById('btn-solve').classList.add('hidden');

    board = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    blockers.forEach(b => {
        board[b.r][b.c] = -1;
    });

    pieces.forEach(p => {
        p.onBoard = false;
        p.r = -1;
        p.c = -1;
        p.currentShape = p.shape;
    });
    
    // 初始渲染（玩家现在可以看到谜题）
    renderPiecesInHand();
    render();
    
    const startLogic = () => {
        isGameActive = true;
        startTime = Date.now();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(updateTimer, 1000);
        document.getElementById('status-text').textContent = "游戏开始！";
        
        if (!isMultiplayer) {
            document.getElementById('btn-solve').classList.remove('hidden');
        } else {
            document.getElementById('btn-solve').classList.add('hidden');
        }
    };

    if (useCountdown) {
        isGameActive = false; // 锁定控制
        startCountdown(startLogic);
    } else {
        startLogic();
    }
}

function updateTimer() {
    const delta = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(delta / 60).toString().padStart(2, '0');
    const s = (delta % 60).toString().padStart(2, '0');
    document.getElementById('timer').textContent = `${m}:${s}`;
}

// ----------------------
// 渲染
// ----------------------

let bgCanvas = null;

function initBackground() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const bgCtx = bgCanvas.getContext('2d');
    
    // 绘制木纹背景
    bgCtx.fillStyle = BOARD_COLOR;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    
    // 添加木纹效果（简单的线条）
    bgCtx.save();
    bgCtx.strokeStyle = 'rgba(0,0,0,0.05)';
    bgCtx.lineWidth = 2;
    for (let i = 0; i < bgCanvas.width; i += 5) {
        if (Math.random() > 0.5) {
            bgCtx.beginPath();
            bgCtx.moveTo(i, 0);
            bgCtx.lineTo(i + Math.random() * 10 - 5, bgCanvas.height);
            bgCtx.stroke();
        }
    }
    bgCtx.restore();
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制缓存背景
    if (!bgCanvas) initBackground();
    ctx.drawImage(bgCanvas, 0, 0);
    
    // 网格
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            const x = c * CELL_SIZE;
            const y = r * CELL_SIZE;
            
            // 单元格背景（棋盘格或简单的内嵌效果）
            // 让我们做一个内嵌效果
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
            
            // 网格线
            ctx.strokeStyle = GRID_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
            
            if (board[r][c] === -1) {
                // 绘制阻挡块（逼真的原木/树桩）
                const cx = x + CELL_SIZE/2;
                const cy = y + CELL_SIZE/2;
                const radius = CELL_SIZE/2 - 8; // 留一些边距
                
                // 1. 柔和的阴影
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath();
                ctx.arc(cx + 2, cy + 4, radius, 0, Math.PI * 2);
                ctx.fill();
                
                // 2. 树皮（外层） - 深棕色
                ctx.fillStyle = '#4E342E'; 
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
                
                // 3. 边材（内层） - 浅木色渐变
                const innerRadius = radius - 4;
                const woodGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, innerRadius);
                woodGrad.addColorStop(0, '#D7CCC8'); // 中心亮
                woodGrad.addColorStop(1, '#BCAAA4'); // 边缘稍暗
                ctx.fillStyle = woodGrad;
                ctx.beginPath();
                ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
                ctx.fill();
                
                // 4. 年轮
                ctx.strokeStyle = 'rgba(93, 64, 55, 0.3)';
                ctx.lineWidth = 1.5;
                for (let ringR = 6; ringR < innerRadius; ringR += 5) {
                    ctx.beginPath();
                    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
                    ctx.stroke();
                }
                
                // 5. 心材/核心
                ctx.fillStyle = '#8D6E63';
                ctx.beginPath();
                ctx.arc(cx, cy, 5, 0, Math.PI * 2);
                ctx.fill();
                
                // 6. 裂纹/裂缝（原木的特征）
                ctx.strokeStyle = 'rgba(62, 39, 35, 0.6)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + innerRadius - 2, cy - 5);
                ctx.stroke();
                
                // 另一条小裂缝
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx - 10, cy + 10);
                ctx.stroke();
            }
        }
    }
    
    // 棋盘上的积木
    pieces.forEach(p => {
        if (p.onBoard) {
            drawPiece(ctx, p, p.c * CELL_SIZE, p.r * CELL_SIZE);
        }
    });

    // 幽灵积木（预览）
    if (hoverGrid && (dragUIIndex !== -1 || draggedPieceIndex !== -1)) {
        const idx = dragUIIndex !== -1 ? dragUIIndex : draggedPieceIndex;
        const p = pieces[idx];
        const gx = hoverGrid.c * CELL_SIZE;
        const gy = hoverGrid.r * CELL_SIZE;
        
        ctx.save();
        ctx.globalAlpha = 0.4;
        drawPiece(ctx, p, gx, gy, false);
        ctx.restore();
    }

    // 被拖拽的积木（旧版逻辑）
    if (isDragging && draggedPieceIndex !== -1) {
        // 旧版拖拽逻辑（现在统一拖拽后应该很少触发）
        const p = pieces[draggedPieceIndex];
        ctx.save();
        ctx.globalAlpha = 0.95;
        drawPiece(ctx, p, p.x, p.y, true);
        ctx.restore();
    }
}

function drawPiece(context, piece, x, y, isFloating = false) {
    const shape = piece.currentShape;
    const blockSize = CELL_SIZE;
    
    context.fillStyle = piece.color;
    context.strokeStyle = 'rgba(0,0,0,0.2)'; // 更柔和的边框
    context.lineWidth = 1;
    
    if (isFloating) {
        context.shadowColor = 'rgba(0,0,0,0.5)';
        context.shadowBlur = 15;
        context.shadowOffsetY = 10;
    }

    for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
            if (shape[r][c]) {
                const bx = x + c * blockSize;
                const by = y + r * blockSize;
                
                // Base Color
                context.fillStyle = piece.color;
                context.fillRect(bx + 1, by + 1, blockSize - 2, blockSize - 2);
                
                // Bevel Effect (Inner Shadow/Highlight)
                // Top & Left (Highlight)
                context.fillStyle = 'rgba(255,255,255,0.4)';
                context.beginPath();
                context.moveTo(bx, by);
                context.lineTo(bx + blockSize, by);
                context.lineTo(bx + blockSize - 4, by + 4);
                context.lineTo(bx + 4, by + 4);
                context.lineTo(bx + 4, by + blockSize - 4);
                context.lineTo(bx, by + blockSize);
                context.fill();
                
                // Bottom & Right (Shadow)
                context.fillStyle = 'rgba(0,0,0,0.2)';
                context.beginPath();
                context.moveTo(bx + blockSize, by + blockSize);
                context.lineTo(bx, by + blockSize);
                context.lineTo(bx + 4, by + blockSize - 4);
                context.lineTo(bx + blockSize - 4, by + blockSize - 4);
                context.lineTo(bx + blockSize - 4, by + 4);
                context.lineTo(bx + blockSize, by);
                context.fill();
                
                // Inner center (Flat)
                // context.fillStyle = piece.color;
                // context.fillRect(bx + 4, by + 4, blockSize - 8, blockSize - 8);
                
                // Outline
                context.strokeStyle = 'rgba(0,0,0,0.1)';
                context.strokeRect(bx, by, blockSize, blockSize);
            }
        }
    }
    
    if (isFloating) {
        context.shadowColor = 'transparent';
        context.shadowBlur = 0;
        context.shadowOffsetY = 0;
    }
}

let isDraggingFromUI = false;
let dragUIIndex = -1;
let dragUIStart = { x: 0, y: 0 };
let dragUIMoved = false;
let dragProxyEl = null;
let activeTouchId = null;
let hoverGrid = null;


function renderPiecesInHand() {
    const previousScrollLeft = piecesContainer.scrollLeft;
    piecesContainer.innerHTML = '';
    pieces.forEach((p, index) => {
        // 如果正在从 UI 拖拽（并且已移动），则不在列表中显示以模拟“拾起”
        // 或者保持显示但变暗？如果移动了就隐藏它。
        if (!p.onBoard && index !== draggedPieceIndex && !(isDraggingFromUI && dragUIMoved && dragUIIndex === index)) {
            const wrapper = document.createElement('div');
            wrapper.className = 'p-1 md:p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer flex justify-center items-center flex-shrink-0';
            wrapper.style.width = '70px'; // 移动端更小
            wrapper.style.height = '70px';
            if (window.innerWidth >= 768) {
                wrapper.style.width = '100px';
                wrapper.style.height = '100px';
            }
            // 使用 'none' 在 JS 中完全控制触摸事件（手动滚动 vs 拖拽）
            wrapper.style.touchAction = 'none'; 
            
            const pCanvas = document.createElement('canvas');
            const rows = p.currentShape.length;
            const cols = p.currentShape[0].length;
            const size = window.innerWidth < 768 ? 14 : 20; // 移动端手牌积木缩放比例更小
            pCanvas.width = cols * size + 4;
            pCanvas.height = rows * size + 4;
            
            const pCtx = pCanvas.getContext('2d');
            p.currentShape.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if (cell) {
                        pCtx.fillStyle = p.color;
                        pCtx.fillRect(c * size, r * size, size, size);
                        pCtx.strokeStyle = '#fff';
                        pCtx.strokeRect(c * size, r * size, size, size);
                    }
                });
            });
            
            // 将监听器移动到 wrapper 以获得更大的点击区域
            wrapper.onmousedown = (e) => handleUIInputStart(e, index);
            
            wrapper.addEventListener('touchstart', (e) => {
                handleUIInputStart(e, index);
            }, { passive: false });
            
            // wrapper.onclick = () => rotatePiece(index); // 在 mouseup 中处理
            
            wrapper.appendChild(pCanvas);
            // 添加数据索引以便快速访问
            wrapper.dataset.index = index;
            piecesContainer.appendChild(wrapper);
        }
    });
    
    // 恢复滚动位置
    piecesContainer.scrollLeft = previousScrollLeft;
}

let containerStartScrollLeft = 0;

function handleUIInputStart(e, index) {
    if (!isGameActive) return;
    
    // 防止重复触发（触摸 + 鼠标）
    // 如果是触摸事件，使用 preventDefault 阻止后续的鼠标事件
    if (e.type === 'touchstart') {
        e.preventDefault();
    }
    
    e.stopPropagation();
    
    if (e.changedTouches && e.changedTouches.length > 0) {
        activeTouchId = e.changedTouches[0].identifier;
    } else {
        activeTouchId = null;
    }
    
    isDraggingFromUI = true;
    dragUIIndex = index;
    
    let clientX, clientY;
    if (activeTouchId !== null && e.touches) {
        // 查找触摸点
        for (let i=0; i<e.touches.length; i++) {
            if (e.touches[i].identifier === activeTouchId) {
                clientX = e.touches[i].clientX;
                clientY = e.touches[i].clientY;
                break;
            }
        }
        // 后备方案
        if (clientX === undefined) {
             clientX = e.touches[0].clientX;
             clientY = e.touches[0].clientY;
        }
    } else {
        clientX = e.clientX || 0;
        clientY = e.clientY || 0;
    }

    dragUIStart = { x: clientX, y: clientY };
    containerStartScrollLeft = piecesContainer.scrollLeft;
    dragUIMoved = false;
    
    // 重置代理
    if (dragProxyEl) {
        if (dragProxyEl.parentNode) dragProxyEl.parentNode.removeChild(dragProxyEl);
        dragProxyEl = null;
    }
}

// ----------------------
// 交互
// ----------------------

function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function setupEvents() {
    canvas.addEventListener('mousedown', handleInputStart);
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('mouseup', handleInputEnd);
    
    // 使用 passive: false 以允许 preventDefault
    canvas.addEventListener('touchstart', (e) => { 
        // 始终阻止画布触摸的默认行为，以避免游戏时滚动
        e.preventDefault(); 
        handleInputStart(e); 
    }, {passive: false});
    
    window.addEventListener('touchmove', (e) => { 
        // 如果正在拖动积木，阻止滚动
        if(isDragging || isDraggingFromUI) {
            e.preventDefault(); 
        }
        handleInputMove(e); 
    }, {passive: false});
    
    window.addEventListener('touchend', handleInputEnd);
    window.addEventListener('touchcancel', handleInputEnd);
}



function createDragProxy(index, x, y, center = false) {
    // 如果存在代理，移除它
    if (dragProxyEl) {
        if (dragProxyEl.parentNode) dragProxyEl.parentNode.removeChild(dragProxyEl);
    }
    
    dragProxyEl = document.createElement('div');
    dragProxyEl.style.position = 'fixed';
    dragProxyEl.style.zIndex = '9999';
    dragProxyEl.style.pointerEvents = 'none';
    dragProxyEl.style.left = x + 'px';
    dragProxyEl.style.top = y + 'px';
    
    if (center) {
        dragProxyEl.style.transform = 'translate(-50%, -50%)';
    } else {
        dragProxyEl.style.transform = 'translate(0, 0)';
    }
    
    dragProxyEl.style.opacity = '0.95'; 
    
    // 绘制内容到代理
    const p = pieces[index];
    
    // 根据当前画布显示大小计算视觉大小
    const rect = canvas.getBoundingClientRect();
    const visualCellSize = rect.width / GRID_SIZE;
    
    const rows = p.currentShape.length;
    const cols = p.currentShape[0].length;
    
    const proxyCanvas = document.createElement('canvas');
    proxyCanvas.width = cols * visualCellSize + 4;
    proxyCanvas.height = rows * visualCellSize + 4;
    const ctx = proxyCanvas.getContext('2d');
    
    // 缩放上下文以使积木适应视觉大小
    const scale = visualCellSize / CELL_SIZE;
    ctx.scale(scale, scale);
    
    drawPiece(ctx, p, 0, 0, true);
    
    dragProxyEl.appendChild(proxyCanvas);
    document.body.appendChild(dragProxyEl);
}

function handleInputStart(e) {
    if (!isGameActive) return;
    
    let clientX, clientY;
    if (e.changedTouches && e.changedTouches.length > 0) {
        activeTouchId = e.changedTouches[0].identifier;
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        activeTouchId = null;
        clientX = e.clientX;
        clientY = e.clientY;
    }
    
    const rect = canvas.getBoundingClientRect();
    
    // 计算视觉大小和内部大小之间的缩放因子
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // 将屏幕坐标转换为内部画布坐标
    const pos = {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
    
    for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i];
        if (p.onBoard) {
            const px = p.c * CELL_SIZE;
            const py = p.r * CELL_SIZE;
            const pw = p.currentShape[0].length * CELL_SIZE;
            const ph = p.currentShape.length * CELL_SIZE;
            
            // 首先检查边界框
            if (pos.x >= px && pos.x < px + pw && pos.y >= py && pos.y < py + ph) {
                // 检查确切的单元格
                const gridX = Math.floor((pos.x - px) / CELL_SIZE);
                const gridY = Math.floor((pos.y - py) / CELL_SIZE);
                
                if (gridY >= 0 && gridY < p.currentShape.length && 
                    gridX >= 0 && gridX < p.currentShape[0].length && 
                    p.currentShape[gridY][gridX]) {
                        
                    // 切换到统一拖拽模式（使用代理）
                    isDraggingFromUI = true; // 重用此标志用于统一拖拽
                    dragUIIndex = i;
                    dragUIMoved = true; // 棋盘拖拽始终是移动
                    
                    // 计算积木左上角到鼠标的偏移量
                    // 积木左上角的画布坐标：(px, py)
                    // 鼠标的画布坐标：pos.x, pos.y
                    const offsetX = pos.x - px;
                    const offsetY = pos.y - py;
                    
                    // 初始代理位置应与屏幕上的积木视觉位置匹配
                    // 我们需要将积木的内部 (px, py) 转换为视觉坐标
                    // 视觉 X = rect.left + (px / scaleX)
                    // 视觉 Y = rect.top + (py / scaleY)
                    
                    const visualPx = rect.left + (px / scaleX);
                    const visualPy = rect.top + (py / scaleY);
                    
                    // 存储移动偏移量（相对于视觉位置）
                    // 这是从积木左上角（视觉上）到鼠标指针的偏移量
                    dragUIStart = { 
                        x: clientX - visualPx, 
                        y: clientY - visualPy 
                    }; 
                    
                    removePieceFromBoard(p);
                    p.onBoard = false;
                    
                    // 在当前视觉位置启动代理
                    createDragProxy(i, visualPx, visualPy);
                    
                    // 如果是触摸，立即将偏移量应用于视觉代理
                    if (activeTouchId !== null && dragProxyEl) {
                        // 居中？还是遵循逻辑？
                        // 如果我们刚在 visualPx/visualPy 创建它，它与棋盘位置完美匹配。
                        // 用户的手机在 clientX, clientY。
                        // 我们希望拖拽是相对的。
                        // 所以我们还不需要强制移动它。
                    }
                    
                    render();
                    renderPiecesInHand();
                    return;
                }
            }
        }
    }
}

let animationFrameId = null;

function handleInputMove(e) {
    // 统一拖拽
    if (isDraggingFromUI) {
        let clientX, clientY;
        
        if (activeTouchId !== null && e.touches) {
            // 查找触摸点
            let found = false;
            for (let i=0; i<e.touches.length; i++) {
                if (e.touches[i].identifier === activeTouchId) {
                    clientX = e.touches[i].clientX;
                    clientY = e.touches[i].clientY;
                    found = true;
                    break;
                }
            }
            if (!found) return; // 触摸结束或未找到，忽略
        } else {
             clientX = e.clientX || 0;
             clientY = e.clientY || 0;
        }
        
        const dx = clientX - dragUIStart.x;
        const dy = clientY - dragUIStart.y;
        
        // 方向锁定和拖出逻辑
        if (!dragUIMoved) {
             // 鼠标模式 (PC)：无阈值，立即拖拽
             if (activeTouchId === null) {
                 dragUIMoved = true;
             } 
             // 触摸模式：智能阈值
             else {
                 const containerRect = piecesContainer.getBoundingClientRect();
                 const isOutside = clientY < containerRect.top || clientY > containerRect.bottom;
                 
                 // 优先级 1：越界 -> 强制拖拽
                 if (isOutside) {
                     dragUIMoved = true;
                     if (e.cancelable) e.preventDefault();
                 }
                 // 优先级 2：严格水平滚动
                 // 仅当水平移动占主导地位（例如 > 2倍垂直移动）时才允许滚动
                 // 且垂直移动不多
                 // 降低阈值以便更容易拖出
                 else if (Math.abs(dx) > Math.abs(dy) * 2 && Math.abs(dy) < 5) {
                      // 水平主导 -> 滚动
                      piecesContainer.scrollLeft = containerStartScrollLeft - dx;
                      return; 
                 }
                 // 优先级 3：其他所有情况 -> 拖拽
                 // 如果有任何垂直移动或轻微对角线移动，我们假设是拖拽
                 else {
                     const dist = Math.sqrt(dx*dx + dy*dy);
                     if (dist > 10) {
                         dragUIMoved = true;
                         if (e.cancelable) e.preventDefault();
                     }
                 }
             }
        } else if (dragUIMoved && activeTouchId !== null) {
             // 已经在拖拽，始终阻止默认行为
             if (e.cancelable) e.preventDefault();
        }

        if (dragUIMoved) {
             // 如果不存在代理，则创建
             if (!dragProxyEl) {
                // 传递 'true' 以启用中心模式
                createDragProxy(dragUIIndex, clientX, clientY, true);
                
                // 视觉上隐藏原始元素，但不要销毁它
                // 销毁它会中断某些浏览器上的触摸事件流
                // renderPiecesInHand(); <--- 已移除
                
                // 查找元素并隐藏它
                // 由于过滤后的积木（例如在棋盘上的），piecesContainer 子元素可能不与索引 1:1 匹配，
                // 我们需要通过 data-index 查找或直接迭代。
                // 等等，renderPiecesInHand 过滤掉了棋盘上的积木。
                // 当前 piecesContainer 子元素对应于过滤后的列表。
                // 我们可以直接使用 querySelector。
                const el = piecesContainer.querySelector(`div[data-index="${dragUIIndex}"]`);
                if (el) {
                    el.style.opacity = '0';
                }
             }
        
            if (dragProxyEl) {
                // 应用视觉偏移
                // 注意：我们使用 TOUCH_OFFSET_Y 将积木显示在手指上方
                // 但是，逻辑必须遵循此视觉位置。
                const visualY = (activeTouchId !== null) ? clientY - TOUCH_OFFSET_Y : clientY;
                
                if (dragProxyEl.style.transform.includes('translate(-50%, -50%)')) {
                    // UI 源：以 (clientX, visualY) 为中心
                    dragProxyEl.style.left = clientX + 'px';
                    dragProxyEl.style.top = visualY + 'px';
                } else {
                    // 棋盘源：基于左上角
                    // 逻辑：代理的左上角位于 (clientX - dragUIStart.x, visualY - dragUIStart.y)
                    // 等等，如果我们对 visualY 应用偏移，我们会将整个东西向上移动。
                    dragProxyEl.style.left = (clientX - dragUIStart.x) + 'px';
                    dragProxyEl.style.top = (visualY - dragUIStart.y) + 'px';
                }
                
                // 计算幽灵位置（必须与视觉位置匹配）
                const rect = canvas.getBoundingClientRect();
                const visualCellSize = rect.width / GRID_SIZE;
                let canvasX, canvasY;
                const p = pieces[dragUIIndex];
                 
                if (dragProxyEl.style.transform.includes('translate(-50%, -50%)')) {
                    // 积木中心位于 (clientX, visualY)
                    const pieceWidth = p.currentShape[0].length * visualCellSize;
                    const pieceHeight = p.currentShape.length * visualCellSize;
                    
                    // 屏幕坐标中的积木左上角
                    const pieceScreenX = clientX - (pieceWidth / 2);
                    const pieceScreenY = visualY - (pieceHeight / 2);
                    
                    // 相对于画布
                    canvasX = pieceScreenX - rect.left;
                    canvasY = pieceScreenY - rect.top;
                } else {
                    // 积木左上角位于 (clientX - dragUIStart.x, visualY - dragUIStart.y)
                    canvasX = (clientX - dragUIStart.x) - rect.left;
                    canvasY = (visualY - dragUIStart.y) - rect.top;
                }
                
                // canvasX 现在是屏幕像素。
                // 我们需要网格坐标。
                // 使用 Math.floor + 0.5 四舍五入到最近的单元格中心？
                // 如果 canvasX 是积木的左上角，Math.round 是正确的？
                // 不，canvasX 是相对于棋盘的积木左上角像素。
                // 所以除以 cellSize 得到小数索引。四舍五入得到最近的整数索引。
                const c = Math.round(canvasX / visualCellSize);
                const r = Math.round(canvasY / visualCellSize);
                
                // 更新 hoverGrid
                if (isValidPlacement(p.currentShape, r, c)) {
                    hoverGrid = { r, c };
                    // 视觉提示：添加 'snap' 类或效果到代理？
                    // 也许只是改变不透明度或边框
                    dragProxyEl.style.filter = 'brightness(1.1) drop-shadow(0 0 5px gold)';
                } else {
                    hoverGrid = null;
                    dragProxyEl.style.filter = 'none';
                }
                
                // 节流渲染
                if (!animationFrameId) {
                    animationFrameId = requestAnimationFrame(() => {
                        render();
                        animationFrameId = null;
                    });
                }
            }
        }
    }
}

function handleInputEnd(e) {
    // 统一拖拽结束
    if (isDraggingFromUI) {
        let clientX, clientY;
        
        // 如果正在追踪，查找触摸点
        if (activeTouchId !== null && e.changedTouches) {
             let found = false;
             for (let i=0; i<e.changedTouches.length; i++) {
                 if (e.changedTouches[i].identifier === activeTouchId) {
                     clientX = e.changedTouches[i].clientX;
                     clientY = e.changedTouches[i].clientY;
                     found = true;
                     break;
                 }
             }
             if (!found) {
                 return; // 不是我们的触摸结束
             }
        } else {
             clientX = e.clientX || (e.changedTouches ? e.changedTouches[0].clientX : 0);
             clientY = e.clientY || (e.changedTouches ? e.changedTouches[0].clientY : 0);
        }

        if (!dragUIMoved) {
            // 点击 UI -> 旋转
            // 如果我们没有触发拖拽移动（handleInputMove 中距离 > 10），
            // 无论释放时坐标是否有微小偏移，都将其视为点击/轻触。
            rotatePiece(dragUIIndex);
        } else {
            // 放置逻辑
            const rect = document.getElementById('game-board').getBoundingClientRect();
            
            // 检查是否放置在画布内（大约）
            if (clientX >= rect.left && clientX <= rect.right &&
                clientY >= rect.top && clientY <= rect.bottom) {
                
                let r, c;
                
                // 如果可用，首选预计算的 hoverGrid（它正确处理缩放）
                if (hoverGrid) {
                    r = hoverGrid.r;
                    c = hoverGrid.c;
                } else {
                    // 如果需要，重新计算（例如没有移动事件的快速放置）
                    // 必须使用视觉缩放！
                    const visualCellSize = rect.width / GRID_SIZE;
                    const p = pieces[dragUIIndex];
                    let canvasX, canvasY;
                    
                    if (dragProxyEl && dragProxyEl.style.transform.includes('translate(-50%, -50%)')) {
                        // UI 源：基于中心
                        const pieceWidth = p.currentShape[0].length * visualCellSize;
                        const pieceHeight = p.currentShape.length * visualCellSize;
                        canvasX = clientX - rect.left - (pieceWidth / 2);
                        canvasY = clientY - rect.top - (pieceHeight / 2);
                    } else {
                        // 棋盘源：基于左上角
                        // visualPx = clientX - dragUIStart.x
                        canvasX = (clientX - dragUIStart.x) - rect.left;
                        canvasY = (clientY - dragUIStart.y) - rect.top;
                    }
                    
                    c = Math.round(canvasX / visualCellSize);
                    r = Math.round(canvasY / visualCellSize);
                }
                
                const p = pieces[dragUIIndex];
                if (isValidPlacement(p.currentShape, r, c)) {
                    placePieceOnBoard(p, r, c);
                    checkWin();
                    if (isMultiplayer && conn) {
                        conn.send({ type: 'update', board: simplifyBoard(), pieces: pieces });
                    }
                } else {
                    // 无效放置 -> 返回手牌
                }
            } else {
                // 放置在画布外 -> 返回手牌
            }
        }
        
        // 清理
        if (dragProxyEl && dragProxyEl.parentNode) {
            dragProxyEl.parentNode.removeChild(dragProxyEl);
        }
        dragProxyEl = null;
        isDraggingFromUI = false;
        dragUIIndex = -1;
        dragUIMoved = false;
        isDragging = false; 
        draggedPieceIndex = -1;
        activeTouchId = null;
        hoverGrid = null;
        renderPiecesInHand();
        render();
    }
}

function rotatePiece(index) {
    if (isGameActive && pieces[index] && !pieces[index].onBoard) {
        // 循环遍历所有唯一的方向（旋转 + 翻转）
        // 这确保用户通过重复点击可以看到所有可能的形状状态。
        
        const p = pieces[index];
        const baseShape = p.shape; // 原始定义
        const currentShape = p.currentShape;
        
        // 获取唯一方向的规范列表
        const allShapes = getOrientations(baseShape);
        
        // 在列表中查找当前形状
        let currentIndex = -1;
        const currentStr = JSON.stringify(currentShape);
        
        for (let i = 0; i < allShapes.length; i++) {
            if (JSON.stringify(allShapes[i]) === currentStr) {
                currentIndex = i;
                break;
            }
        }
        
        // 计算下一个索引（循环）
        // 如果未找到当前形状（奇怪），从 0 开始
        const nextIndex = (currentIndex + 1) % allShapes.length;
        
        p.currentShape = allShapes[nextIndex];
        
        // 视觉反馈（可选，但 renderPiecesInHand 已处理）
        renderPiecesInHand();
    }
}

// ----------------------
// 逻辑：棋盘辅助函数
// ----------------------

function isValidPlacement(shape, r, c) {
    const rows = shape.length;
    const cols = shape[0].length;
    
    if (r < 0 || c < 0 || r + rows > GRID_SIZE || c + cols > GRID_SIZE) return false;
    
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (shape[i][j]) {
                if (board[r + i][c + j] !== 0) return false;
            }
        }
    }
    return true;
}

function placePieceOnBoard(piece, r, c) {
    piece.onBoard = true;
    piece.r = r;
    piece.c = c;
    const shape = piece.currentShape;
    for (let i = 0; i < shape.length; i++) {
        for (let j = 0; j < shape[0].length; j++) {
            if (shape[i][j]) {
                board[r + i][c + j] = piece.id;
            }
        }
    }
}

function removePieceFromBoard(piece) {
    const shape = piece.currentShape;
    const r = piece.r;
    const c = piece.c;
    for (let i = 0; i < shape.length; i++) {
        for (let j = 0; j < shape[0].length; j++) {
            if (shape[i][j]) {
                board[r + i][c + j] = 0;
            }
        }
    }
}

function checkWin() {
    let isFull = true;
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (board[r][c] === 0) {
                isFull = false;
                break;
            }
        }
    }
    
    if (isFull) {
        clearInterval(timerInterval);
        const time = document.getElementById('timer').textContent;
        document.getElementById('status-text').textContent = "恭喜！你赢了！";
        
        showResult("胜利！", `用时: ${time}`);
        document.getElementById('result-icon').textContent = "🏆";
        document.getElementById('result-title').textContent = "恭喜胜利！";
        
        if (isMultiplayer && conn) {
            conn.send({ type: 'win', time: time });
        }
    }
}

function simplifyBoard() {
    return board.map(row => row.map(cell => cell === 0 ? 0 : (cell === -1 ? -1 : 1)));
}

// ----------------------
// 逻辑：求解器（回溯法）
// ----------------------

function solvePuzzle(blockerConfig, returnSolution = false) {
    let tempBoard = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    blockerConfig.forEach(b => tempBoard[b.r][b.c] = -1);
    
    let availablePieces = PIECES_DEF.map((p, i) => ({...p, originalIndex: i}));
    
    // 按大小（从大到小）对积木排序以加速剪枝
    availablePieces.sort((a, b) => {
        const sizeA = a.shape.flat().filter(x=>x).length;
        const sizeB = b.shape.flat().filter(x=>x).length;
        return sizeB - sizeA;
    });

    const solution = solveRecursive(tempBoard, availablePieces);
    
    if (returnSolution && solution) {
        return solution;
    }
    return !!solution;
}

function solveRecursive(currentBoard, piecesLeft) {
    if (piecesLeft.length === 0) return []; // 已解决！返回空列表以开始链
    
    // 查找第一个空单元格
    let emptyR = -1, emptyC = -1;
    outer: for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (currentBoard[r][c] === 0) {
                emptyR = r;
                emptyC = c;
                break outer;
            }
        }
    }
    
    if (emptyR === -1) return []; // 应该被 piecesLeft 检查捕获，但没关系
    
    // 尝试将剩余的任何积木放入此空槽
    // 优化：只尝试*可以*覆盖此槽的积木。
    
    for (let i = 0; i < piecesLeft.length; i++) {
        const piece = piecesLeft[i];
        const orientations = getOrientations(piece.shape);
        
        for (let shape of orientations) {
            const rows = shape.length;
            const cols = shape[0].length;
            
            // 尝试放置积木，使其单元格之一覆盖 (emptyR, emptyC)
            // 我们遍历积木形状的所有单元格
            for (let pr = 0; pr < rows; pr++) {
                for (let pc = 0; pc < cols; pc++) {
                    if (shape[pr][pc]) {
                        const r = emptyR - pr;
                        const c = emptyC - pc;
                        
                        if (canPlace(currentBoard, shape, r, c)) {
                            // 放置
                            place(currentBoard, shape, r, c, piece.id);
                            
                            // 递归
                            const nextPieces = piecesLeft.filter((_, idx) => idx !== i);
                            const result = solveRecursive(currentBoard, nextPieces);
                            
                            if (result) {
                                // 找到解决方案！将此移动添加到结果
                                return [{
                                    id: piece.id,
                                    index: piece.originalIndex,
                                    r: r,
                                    c: c,
                                    shape: shape
                                }, ...result];
                            }
                            
                            // 回溯
                            place(currentBoard, shape, r, c, 0);
                        }
                    }
                }
            }
        }
    }
    
    return null; // 从此状态无解
}

// 缓存方向
const orientationCache = new Map();

function getOrientations(shape) {
    const key = JSON.stringify(shape);
    if (orientationCache.has(key)) return orientationCache.get(key);

    let results = [];
    let current = shape;
    
    // 旋转
    for (let i = 0; i < 4; i++) {
        results.push(current);
        current = rotateMatrix(current);
    }
    
    // 翻转
    current = flipMatrix(shape);
    for (let i = 0; i < 4; i++) {
        results.push(current);
        current = rotateMatrix(current);
    }
    
    // 去重
    const unique = [];
    const hashes = new Set();
    results.forEach(s => {
        const h = JSON.stringify(s);
        if (!hashes.has(h)) {
            hashes.add(h);
            unique.push(s);
        }
    });
    
    orientationCache.set(key, unique);
    return unique;
}

function rotateMatrix(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    let res = Array(cols).fill().map(() => Array(rows).fill(0));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            res[c][rows - 1 - r] = matrix[r][c];
        }
    }
    // 旋转后，我们需要确保积木是“标准化”的
    // 例如，如果有空行/列，则修剪（尽管对于实心形状通常不需要）
    // 但重要的是对于某些形状（如 I 形积木），旋转 1x4 数组变为 4x1。
    // 以前的实现对于标准矩阵顺时针旋转 90 度看起来是正确的。
    // 让我们验证：
    // [1, 1, 1, 1] (1x4)
    // r=0, c=0..3
    // res 是 4x1
    // res[0][0] = m[0][0] = 1
    // res[1][0] = m[0][1] = 1 ... Correct.
    
    // 检查用户提到的“之”字形/“S”形问题。
    // 用户说“横条变成了之子的”（直条变成了之字形/Z 形？）
    
    // 关键修复：
    // 如果输入矩阵不是矩形的（例如锯齿状数组），rotateMatrix 会失败。
    // 首先确保输入是矩形的。
    // 我在 PIECES_DEF 中的定义是数组的数组，但它们保证是矩形的吗？
    // 让我们检查：
    // 四格 L：[[1, 0], [1, 0], [1, 1]] -> 3x2。OK。
    // 四格 Z：[[1, 1, 0], [0, 1, 1]] -> 2x3。OK。
    
    // 但是，如果我们之前旋转了一个积木，它不知何故变成了锯齿状？
    // rotateMatrix: `res[c][rows - 1 - r] = matrix[r][c];`
    // 如果 matrix[r] 没有索引 c，则为 undefined。
    // matrix[r][c] 将为 undefined。
    // 新矩阵中的 undefined 可能会被视为 0 或导致后续问题？
    
    // 让我们强制 undefined 为 0。
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const val = matrix[r][c] !== undefined ? matrix[r][c] : 0;
            res[c][rows - 1 - r] = val;
        }
    }
    
    return res;
}

function flipMatrix(matrix) {
    return matrix.map(row => [...row].reverse());
}

function canPlace(board, shape, r, c) {
    const rows = shape.length;
    const cols = shape[0].length;
    if (r < 0 || c < 0 || r + rows > GRID_SIZE || c + cols > GRID_SIZE) return false;
    
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (shape[i][j] && board[r + i][c + j] !== 0) return false;
        }
    }
    return true;
}

function place(board, shape, r, c, val) {
    const rows = shape.length;
    const cols = shape[0].length;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (shape[i][j]) board[r + i][c + j] = val;
        }
    }
}

// ----------------------
// UI 绑定和多人游戏
// ----------------------

document.getElementById('btn-copy').onclick = () => {
    const input = document.getElementById('room-link');
    input.select();
    document.execCommand('copy');
    // alert('链接已复制！'); // 可选，也许显示一个提示框
    const btn = document.getElementById('btn-copy');
    const originalText = btn.textContent;
    btn.textContent = "已复制";
    setTimeout(() => btn.textContent = originalText, 2000);
};

function initHost() {
    isMultiplayer = true;
    isBotMode = false;
    isHost = true;
    if (peer) peer.destroy();
    peer = new Peer(null, PEER_CONFIG);
    
    peer.on('open', (id) => {
        // 构建链接。假设 index.html 是入口点。
        // 如果我们在 games/smart_block/index.html 中，如果用户复制，我们需要小心相对路径。
        // 最好使用 window.location.href（减去查询参数）
        const url = new URL(window.location.href);
        url.searchParams.set('room', id);
        document.getElementById('room-link').value = url.toString();
    });
    
    peer.on('connection', (c) => {
        conn = c;
        setupConnection(conn);
        
        // 访客加入
        showGameRoom();
        document.getElementById('status-text').textContent = "玩家已连接！请掷骰子。";
        document.getElementById('opponent-view').classList.remove('hidden');

        // 检查游戏是否处于活动状态（重连逻辑）
        // 移至 setupConnection 'join' 处理程序以避免竞争条件
    });
    
    peer.on('error', (err) => {
        console.error(err);
        alert("连接服务错误: " + err.type);
    });
}

function joinRoom(id) {
    isMultiplayer = true;
    isBotMode = false;
    isHost = false;
    if (peer) peer.destroy();
    peer = new Peer(null, PEER_CONFIG);
    
    document.getElementById('status-text').textContent = "正在连接...";
    
    peer.on('open', (myId) => {
        conn = peer.connect(id);
        
        conn.on('open', () => {
             setupConnection(conn);
             // 如果需要，发送握手以触发同步
             conn.send({ type: 'join' });
             
             showGameRoom();
             document.getElementById('status-text').textContent = "已连接！等待房主开始...";
             document.getElementById('opponent-view').classList.remove('hidden');
             document.getElementById('btn-roll').classList.add('hidden');
        });
        
        conn.on('error', (err) => {
            alert("无法连接到房间: " + err);
            showLobby();
        });
    });
    
    peer.on('error', (err) => {
        console.error(err);
        alert("连接服务错误: " + err.type);
    });
}

function setupConnection(connection) {
    connection.on('data', (data) => {
        if (data.type === 'join') {
            // 来自访客的握手
            if (isHost && isGameActive && blockers.length > 0) {
                 const elapsedTime = Date.now() - startTime;
                 connection.send({
                     type: 'sync_state',
                     blockers: blockers,
                     elapsedTime: elapsedTime,
                     guestPieces: guestState ? guestState.pieces : null
                 });
                 document.getElementById('status-text').textContent = "玩家已重连！";
            }
        } else if (data.type === 'start') {
            blockers = data.blockers;
            startGame();
        } else if (data.type === 'pre_start') {
            blockers = data.blockers;
            // 访客收到 pre_start 后开始倒计时
            startGame(true);
        } else if (data.type === 'win') {
            showResult("可惜！", `对手赢了！用时: ${data.time}`);
            document.getElementById('result-icon').textContent = "😢";
            document.getElementById('result-title').textContent = "再接再厉";
            isGameActive = false;
            clearInterval(timerInterval);
        } else if (data.type === 'update') {
            // data.board 是一个简化的网格 (0, 1, -1)
            // 但 renderOpponentBoard 期望 1 表示填充，-1 表示阻挡物
            // 检查 simplifyBoard 实现：0->0, -1->-1, 其他->1。匹配。
            if (isHost && data.pieces) {
                guestState = {
                    board: data.board,
                    pieces: data.pieces
                };
            }
            renderOpponentBoard(data.board);
        } else if (data.type === 'sync_state') {
            // 恢复游戏状态（重连）
            blockers = data.blockers;
            
            // 如果可用，恢复积木
            if (data.guestPieces) {
                pieces = data.guestPieces;
            } else {
                // 如果没有保存状态，将积木重置为手牌（或作为新游戏处理？）
                // 默认 initPieces 已在 init() 中调用
            }
            
            // 重建棋盘
            board = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
            blockers.forEach(b => board[b.r][b.c] = -1);
            
            pieces.forEach(p => {
                if (p.onBoard) {
                    const shape = p.currentShape;
                    for(let r=0; r<shape.length; r++) {
                        for(let c=0; c<shape[0].length; c++) {
                            if(shape[r][c]) {
                                board[p.r + r][p.c + c] = 1;
                            }
                        }
                    }
                }
            });
            
            // 恢复计时器
            startTime = Date.now() - data.elapsedTime;
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimer, 1000);
            isGameActive = true;
            
            // UI
            showGameRoom();
            document.getElementById('status-text').textContent = "重连成功！";
            document.getElementById('btn-roll').classList.add('hidden');
            document.getElementById('btn-solve').classList.add('hidden');
            document.getElementById('opponent-view').classList.remove('hidden');
            
            render();
            renderPiecesInHand();
        }
    });
    
    connection.on('close', () => {
        // 如果是房主：不要立即报错，等待重连。
        // 如果是访客：只有被踢或服务器问题才报错？
        
        if (isHost) {
            document.getElementById('status-text').textContent = "玩家已断开，等待重连...";
            // 我们不调用 leaveGame()。我们等待。
            // 连接对象已死，但 peer 仍存活。
            // 我们只是等待 peer 上的新 'connection' 事件。
            conn = null; 
        } else {
            // 访客端：
            // 如果我刷新了，我是新的。旧的我已死。
            // 如果房主死了，我应该知道。
            // 但如果连接只是关闭了，也许是网络故障？
            
            // 如果游戏处于活动状态，也许尝试重连？
            // 但通常 'close' 意味着结束。
            // 让我们只显示一个 toast/状态，而不是模态警报。
            document.getElementById('status-text').textContent = "连接已断开";
            // alert("连接已断开"); 
            // leaveGame();
        }
    });
}

function renderOpponentBoard(boardData) {
    const cvs = document.getElementById('opponent-board');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const width = cvs.width;
    const height = cvs.height;
    const size = width / GRID_SIZE;
    
    ctx.clearRect(0, 0, width, height);
    
    let emptyCount = 0;
    
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            const val = boardData[r][c];
            if (val === 0) emptyCount++;
            
            if (val === -1) {
                // 阻挡物
                ctx.fillStyle = '#4b5563';
                ctx.beginPath();
                ctx.arc(c * size + size/2, r * size + size/2, size/3, 0, Math.PI * 2);
                ctx.fill();
            } else if (val === 1) {
                // 积木
                ctx.fillStyle = '#3b82f6';
                ctx.fillRect(c * size + 1, r * size + 1, size - 2, size - 2);
            } else {
                // 空
                ctx.fillStyle = '#e2e8f0'; // 浅灰色
                ctx.fillRect(c * size + 1, r * size + 1, size - 2, size - 2);
            }
        }
    }

    const statusEl = document.getElementById('opponent-status');
    if (statusEl) {
        if (emptyCount === 0) {
             statusEl.textContent = "已完成！";
             statusEl.classList.add('text-green-600', 'font-bold');
        } else {
             statusEl.textContent = `剩余空格: ${emptyCount}`;
             statusEl.classList.remove('text-green-600', 'font-bold');
        }
    }
}

// 开始
init();
