$(document).ready(function() {
    let peer = null;
    let conn = null;
    let myId = null;
    let isHost = false;
    let isAIMode = false;
    let isFeedbackActive = false;
    let feedbackTimeout = null;
    let gameState = {
        myTiles: [],
        oppTiles: [], 
        visitorTiles: [], // 房主特有：记录访客的完整牌数据（含数值），用于恢复
        pool: { black: [], white: [] },
        turn: null, 
        phase: 'waiting', 
        hasGuessedCorrectlyThisTurn: false, // 记录本回合是否猜对过牌
        lastDrawnTile: null, // 玩家刚摸到但尚未放入手牌的牌
        oppLastDrawnTile: null // 对手刚摸到但尚未放入手牌的牌（仅颜色）
    };

    const COLORS = { BLACK: 'black', WHITE: 'white' };

    // --- PeerJS Setup ---
    function initPeer() {
        if (isAIMode) {
            myId = 'player';
            isHost = true; // AI 模式下，玩家作为主机
            conn = { open: true }; // 模拟连接
            initGame();
            return;
        }

        // 尝试从 localStorage 获取之前的 ID，实现刷新后 ID 不变
        const savedId = localStorage.getItem('coda_peer_id');
        
        peer = new Peer(savedId, PEER_CONFIG);

        peer.on('open', (id) => {
            myId = id;
            localStorage.setItem('coda_peer_id', id);
            console.log('My peer ID is: ' + id);
            
            const url = new URL(window.location.href);
            url.searchParams.set('room', id);
            $('#share-url').val(url.toString());
            
            // 启用复制按钮
            $('#btn-copy').prop('disabled', false)
                .removeClass('text-slate-300 cursor-not-allowed')
                .addClass('text-orange-500 hover:text-orange-600 cursor-pointer');
            
            if (isHost) {
                $('#waiting-section').find('p').text('房间已创建，请分享链接给好友');
            }
            
            // 检查是否是通过链接进入的访客
            const joinId = new URLSearchParams(window.location.search).get('room');
            if (joinId && joinId !== id) {
                joinRoom(joinId);
            }
        });

        peer.on('connection', (connection) => {
            // 如果已有活跃连接，且连接状态正常，则拒绝新连接
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
                    localStorage.removeItem('coda_peer_id'); // 清除损坏或占用的 ID
                    break;
                default:
                    msg = '连接出错: ' + err.type;
            }
            
            // 使用更友好的方式显示错误，而不是 alert
            $('#status-msg').text(msg).addClass('text-red-500');
            alert(msg);
            
            // 如果是找不到房间，清理 URL
            if (err.type === 'peer-unavailable') {
                const url = new URL(window.location.href);
                url.searchParams.delete('room');
                window.history.pushState({}, '', url);
            }

            // 如果是加入失败，恢复大厅 UI
            if (!isHost) {
                $('#lobby').removeClass('hidden'); // 确保大厅显示
                $('#game-board').addClass('hidden'); // 确保游戏界面隐藏
                $('#waiting-section').addClass('hidden');
                $('#create-room-section').removeClass('hidden');
                $('#btn-join').prop('disabled', false).text('加入');
            } else {
                $('#waiting-section').addClass('hidden');
                $('#create-room-section').removeClass('hidden');
                $('#btn-create').prop('disabled', false).text('创建游戏房间');
            }
        });
    }

    function setupConnection() {
        conn.on('open', () => {
            $('#lobby').addClass('hidden');
            $('#game-board').removeClass('hidden');
            
            // 如果房主已有进行中的游戏，则同步给连进来的访客
            if (isHost && gameState.phase !== 'waiting' && gameState.phase !== 'ended') {
                $('#status-msg').text('玩家已重连，正在同步进度...').removeClass('text-red-500');
                // 构建安全的 fullState，避免泄露房主手牌数值
                const safeFullState = {
                    ...gameState,
                    myTiles: gameState.myTiles.map(t => ({
                        color: t.color,
                        isRevealed: t.isRevealed,
                        value: t.isRevealed ? t.value : null
                    })),
                    // oppLastDrawnTile 对访客来说是自己的 lastDrawnTile，需要完整数据
                    // lastDrawnTile 对访客来说是对手（房主）的待定牌，需要遮蔽
                    lastDrawnTile: gameState.lastDrawnTile ? {
                        color: gameState.lastDrawnTile.color,
                        isRevealed: gameState.lastDrawnTile.isRevealed,
                        value: gameState.lastDrawnTile.isRevealed ? gameState.lastDrawnTile.value : null
                    } : null
                };

                send('resume', {
                    pool: gameState.pool,
                    tiles: gameState.myTiles, // 这里的 tiles 字段其实在 handleMessage 中并未被使用，主要靠 fullState
                    oppTiles: gameState.myTiles.map(t => ({ // 这里的 oppTiles 对应访客视角的对手牌
                        color: t.color,
                        isRevealed: t.isRevealed,
                        value: t.isRevealed ? t.value : null // 确保未翻开时 value 为 null
                    })),
                    fullState: safeFullState // 发送脱敏后的状态
                });
                
                // 房主端提示恢复成功
                setTimeout(() => {
                    showStatusFeedback('🎮 进度恢复成功，对手已回到游戏', 'success');
                }, 500);
            } else {
                $('#status-msg').text('玩家已连接，准备开始...').removeClass('text-red-500');
                if (isHost) {
                    initGame();
                }
            }
        });

        conn.on('data', (data) => {
            handleMessage(data);
        });

        conn.on('close', () => {
            console.log('Connection closed');
            handleDisconnect();
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            handleDisconnect();
        });
    }

    function handleDisconnect() {
        // 关键：清除当前连接对象，允许新的连接（重连）进来
        conn = null;
        
        if (gameState.phase !== 'ended' && gameState.phase !== 'waiting') {
            // 如果是在游戏中途断开
            $('#status-msg').text('对手已断开连接，正在等待重连...').addClass('text-red-500');
            
            // 房主不刷新页面，而是回到等待界面或保持当前状态
            if (isHost) {
                // 房主可以选择留在原地，或者回到等待大厅
                setTimeout(() => {
                    if (!conn) { // 如果 3 秒后还没连上，显示大厅
                        $('#game-board').addClass('hidden');
                        $('#lobby').removeClass('hidden');
                        $('#waiting-section').removeClass('hidden').find('p').text('对手已离开，等待新玩家加入或原玩家重连...');
                    }
                }, 3000);
            } else {
                // 访客如果断了，尝试自动重连或提示
                alert('与房主的连接已断开，请尝试刷新页面重连。');
                location.reload();
            }
        } else {
            // 如果还没开始就断了，直接回大厅
            $('#game-board').addClass('hidden');
            $('#lobby').removeClass('hidden');
            if (isHost) {
                $('#waiting-section').removeClass('hidden').find('p').text('等待对手加入...');
            }
        }
    }

    function handleMessage(msg) {
        console.log('Received:', msg);
        switch(msg.type) {
            case 'init':
                gameState.pool = msg.pool;
                gameState.myTiles = msg.tiles; 
                gameState.oppTiles = msg.oppTiles; 
                gameState.turn = msg.turn;
                gameState.phase = 'drawing';
                updateUI();
                break;
            case 'resume':
                // 访客收到房主的恢复指令
                gameState.pool = msg.fullState.pool;
                // 注意：房主发来的 myTiles 对访客来说是 oppTiles
                // 房主发来的 oppTiles 实际上是访客自己的 myTiles 的缩略版（不含值）
                // 所以这里我们需要房主发来的完整数据中提取访客自己的牌（如果有）
                // 简化处理：房主在 resume 时应该发一份访客视角的数据
                
                // 重新校准访客视角：
                gameState.pool = msg.fullState.pool;
                gameState.turn = msg.fullState.turn;
                gameState.phase = msg.fullState.phase;
                
                // 访客需要找回自己的完整牌（包含数值）
                if (msg.fullState.visitorTiles) {
                    gameState.myTiles = msg.fullState.visitorTiles.map(t => ({
                        ...t,
                        // 强制数值校验：如果是 null/undefined，且不是 Joker，则标记异常（但这里我们主要靠 displayValue 处理）
                        // 重点：确保 value 字段存在
                        value: t.value
                    }));
                }
                
                // 对手（房主）的牌，访客只能看到颜色和已翻开的值
                if (msg.fullState.myTiles) {
                    gameState.oppTiles = msg.fullState.myTiles.map(t => ({
                        id: t.id,
                        color: t.color,
                        isRevealed: t.isRevealed,
                        value: t.isRevealed ? t.value : undefined
                    }));
                }
                
                // 恢复待定牌
                if (msg.fullState.lastDrawnTile) {
                    // 房主保存的 lastDrawnTile 实际上是房主的待定牌
                    gameState.oppLastDrawnTile = {
                        id: msg.fullState.lastDrawnTile.id,
                        color: msg.fullState.lastDrawnTile.color,
                        isRevealed: msg.fullState.lastDrawnTile.isRevealed,
                        value: msg.fullState.lastDrawnTile.isRevealed ? msg.fullState.lastDrawnTile.value : undefined
                    };
                }
                if (msg.fullState.oppLastDrawnTile) {
                    // 房主保存的 oppLastDrawnTile 实际上是访客的待定牌
                    gameState.lastDrawnTile = msg.fullState.oppLastDrawnTile;
                }
                
                updateUI();
                showStatusFeedback('🎮 游戏恢复成功，请继续您的对局', 'success');
                break;
            case 'sync':
                // 收到同步消息时，只有当发送方确实是当前回合者时，才允许同步回合状态
                // 防止延迟的 sync 消息将回合状态回滚
                const incomingTurn = msg.turn;
                const isIncomingFromCurrentPlayer = (isHost && incomingTurn === 'guest') || (!isHost && incomingTurn === 'host');
                
                // 房主不接受 pool 同步，防止 race condition
                if (!isHost) {
                    gameState.pool = msg.pool;
                    gameState.oppTiles = msg.oppTiles;
                }
                
                // 房主视角：根据访客发来的同步信息，更新 visitorTiles 的揭开状态
                if (isHost && msg.oppTiles) {
                    msg.oppTiles.forEach((tile) => {
                        // 优先尝试通过 ID 匹配（更准确）
                        let targetTile = null;
                        if (tile.id) {
                            targetTile = gameState.visitorTiles.find(t => t.id === tile.id);
                        }
                        
                        // 降级策略：如果没 ID 或找不到，暂时尝试按顺序（仅作为最后的 fallback，实际上应该都有 ID）
                        // 注意：如果对方摸牌了，长度可能不一致，所以 ID 匹配是必须的
                        if (!targetTile && !tile.id) {
                            // 无法匹配，跳过
                            return;
                        }

                        if (targetTile) {
                            // 仅当状态发生变化时才更新，防止意外覆盖数值
                            if (tile.isRevealed) {
                                targetTile.isRevealed = true;
                                if (tile.value !== undefined && tile.value !== null) {
                                    targetTile.value = tile.value;
                                }
                            }
                        }
                    });
                    
                    // 房主视角：更新完 visitorTiles 后，重新生成 oppTiles
                    syncOppTilesFromVisitor();
                }
                
                // 访客视角：如果是房主发来的同步，oppTiles 就是房主的牌
                // 无需特殊处理，直接覆盖即可（上面已经覆盖了 gameState.oppTiles = msg.oppTiles）
                
                // 同步待定牌 (lastDrawnTile)
                // 检查消息中是否显式包含了 lastDrawnTile 字段 (可能是 null)
                if (msg.hasOwnProperty('lastDrawnTile')) {
                    if (msg.lastDrawnTile) {
                        // 对方摸了一张牌，放在一边
                        // 仅当本地没有待定牌，或者新消息包含数值（惩罚阶段）时才更新
                        if (!gameState.oppLastDrawnTile || msg.lastDrawnTile.value !== undefined) {
                            // 如果本地已经有带数值的牌（房主从 pool 弹出），不要被不带数值的 sync 覆盖
                            if (isHost && gameState.oppLastDrawnTile && gameState.oppLastDrawnTile.value !== undefined && msg.lastDrawnTile.value === undefined) {
                                // 保持原样，只更新揭开状态
                                gameState.oppLastDrawnTile.isRevealed = msg.lastDrawnTile.isRevealed || false;
                            } else {
                                gameState.oppLastDrawnTile = msg.lastDrawnTile;
                            }
                        }
                    } else {
                        // 显式为 null，说明对方已将待定牌归入手牌
                        // 关键修复：如果是房主，且本地有记录待定牌，说明该牌已从“待定”变为“手牌”
                        // 需要将其移入 visitorTiles 以防丢失（因为房主维护着访客的真实数据）
                        if (isHost && gameState.oppLastDrawnTile) {
                            gameState.visitorTiles.push(gameState.oppLastDrawnTile);
                            gameState.visitorTiles = sortTiles(gameState.visitorTiles);
                        }
                        gameState.oppLastDrawnTile = null;
                    }
                } else if (msg.phase === 'drawing') {
                    // 如果对方处于摸牌阶段，说明还没摸牌，清空待定牌
                    gameState.oppLastDrawnTile = null;
                }
                
                // 仅当状态合理时才更新回合和阶段
                // 如果是我的回合，且我处于活跃状态（非 waiting），则忽略对方发来的 phase（通常是 waiting），防止覆盖我的状态
                const amIActive = checkIsMyTurn() && gameState.phase !== 'waiting' && gameState.phase !== 'ended';
                
                // 关键修复：如果我当前处于活跃状态（即我认为是我的回合），则拒绝接受对方通过 sync 消息发来的“对方回合”状态
                // 这防止了 race condition：例如对方发送 sync (Turn=Opponent) 后紧接着发送 end-turn (Turn=Me)
                // 如果 sync 晚于 end-turn 到达，会导致我刚变成活跃状态又被 sync 改回非活跃状态，造成死锁
                if (!amIActive && (isIncomingFromCurrentPlayer || (!gameState.turn))) {
                    gameState.turn = incomingTurn;
                }
                
                if (!amIActive) {
                    gameState.phase = msg.phase;
                }
                
                updateUI();
                break;
            case 'move-tile':
                // 对方移动了牌（目前仅限 Joker）
                if (isHost) {
                    // 房主视角：更新对应的 visitorTiles 顺序
                    const tiles = gameState.visitorTiles;
                    const [tile] = tiles.splice(msg.from, 1);
                    tiles.splice(msg.to, 0, tile);
                } else {
                    // 访客视角：更新对手的牌顺序
                    const tiles = gameState.oppTiles;
                    const [tile] = tiles.splice(msg.from, 1);
                    tiles.splice(msg.to, 0, tile);
                }
                updateUI();
                break;
            case 'guess':
                processGuess(msg.index, msg.value);
                break;
            case 'guess-result':
                handleGuessResult(msg.success, msg.index, msg.value, msg.color);
                break;
            case 'draw':
                handleOpponentDraw(msg.color);
                break;
            case 'end-turn':
                // 对手结束回合：同步对手的手牌状态
                if (msg.oppTiles) {
                    if (!isHost) {
                        gameState.oppTiles = msg.oppTiles;
                    }

                    if (isHost) {
                        if (gameState.oppLastDrawnTile) {
                            gameState.visitorTiles.push(gameState.oppLastDrawnTile);
                            gameState.visitorTiles = sortTiles(gameState.visitorTiles);
                        }
                        
                        // 房主视角：根据 ID 匹配更新 visitorTiles
                        msg.oppTiles.forEach((tile) => {
                            let targetTile = null;
                            if (tile.id) {
                                targetTile = gameState.visitorTiles.find(t => t.id === tile.id);
                            }
                            // Fallback (虽然理论上都应该有 ID)
                            if (!targetTile && !tile.id) {
                                return;
                            }

                            if (targetTile) {
                                targetTile.isRevealed = tile.isRevealed;
                                if (tile.value !== undefined && tile.value !== null) {
                                    targetTile.value = tile.value;
                                }
                            }
                        });
                        
                        // 更新完 visitorTiles 后，重新生成 oppTiles（带数值）
                        syncOppTilesFromVisitor();
                    }
                }
                gameState.oppLastDrawnTile = null;
                
                // 切换到我的角色
                gameState.turn = isHost ? 'host' : 'guest';
                gameState.phase = 'drawing';
                updateUI();
                checkWin(); // 关键修复：收到回合结束信号后，检查对手是否已输掉游戏
                break;
            case 'restart-game':
                // 收到房主的重新开始指令
                gameState.pool = msg.pool;
                gameState.myTiles = msg.tiles; 
                
                // 访客重新获得的手牌需要正确处理 isMovable
                gameState.myTiles.forEach(t => {
                    if (t.value === 'J') t.isMovable = true;
                });
                
                gameState.oppTiles = msg.oppTiles; 
                gameState.turn = msg.turn;
                gameState.phase = 'drawing';
                gameState.hasGuessedCorrectlyThisTurn = false;
                gameState.lastDrawnTile = null;
                gameState.oppLastDrawnTile = null;
                
                $('#end-modal').addClass('hidden').removeClass('flex');
                updateUI();
                showStatusFeedback('🔄 房主已重新开始游戏', 'info');
                break;
        }
    }

    function send(type, data = {}) {
        if (isAIMode) {
            handleAIMessage(type, data);
            return;
        }
        if (conn && conn.open) {
            conn.send({ type, ...data });
        }
    }

    // --- AI Logic ---
    function handleAIMessage(type, data) {
        // AI 接收玩家发出的消息
        // 在 AI 模式下，AI 和玩家共享同一个 gameState 对象
        // 因此 AI 不需要处理 'init', 'draw', 'sync' 等会修改共享状态的消息
        setTimeout(() => {
            switch(type) {
                case 'guess':
                    // 玩家猜测 AI 的牌
                    // AI 的牌在 gameState.visitorTiles 中，或者是刚摸的待定牌
                    const isLastDrawn = data.index === -1;
                    const tile = isLastDrawn ? gameState.oppLastDrawnTile : gameState.visitorTiles[data.index];
                    if (!tile) return;
                    const success = tile.value === data.value;
                    
                    if (success) {
                        tile.isRevealed = true;
                        // 如果被猜中的是待定牌，归入手牌
                        if (isLastDrawn) {
                            gameState.visitorTiles.push(tile);
                            gameState.oppLastDrawnTile = null;
                        }
                        
                        // 如果被猜中的是 Joker
                        if (tile.value === 'J') {
                            // 保持原位置，不移动到末尾
                        } else if (isLastDrawn) {
                            // 正常的待定牌，排序
                            gameState.visitorTiles = sortTiles(gameState.visitorTiles);
                        }
                        
                        syncOppTilesFromVisitor();
                        showStatusFeedback(`🎉 猜对了！AI 的${isLastDrawn ? '新摸牌' : '第 ' + (data.index + 1) + ' 张牌'}是 ${data.value}`, 'success');
                    } else {
                        // 惩罚：玩家翻开自己最后摸的牌
                        if (gameState.lastDrawnTile) {
                            gameState.lastDrawnTile.isRevealed = true;
                        }
                        showStatusFeedback(`❌ 猜错了！AI 的${isLastDrawn ? '新摸牌' : '第 ' + (data.index + 1) + ' 张牌'}不是 ${data.value}`, 'error');
                    }
                    
                    // 发送结果回馈给玩家（这里直接调用 handleGuessResult）
                    handleGuessResult(success, data.index, data.value, tile.color);
                    
                    // 如果玩家猜错了，轮到 AI 行动
                    if (!success && gameState.phase !== 'ended') {
                        setTimeout(aiPlayTurn, 1000);
                    }
                    break;
                case 'end-turn':
                    // 玩家结束回合，AI 准备开始
                    gameState.turn = 'ai';
                    
                    // AI 模式下，AI 视角不需要同步玩家发来的牌，因为是共享状态
                    // 只需要确保阶段和 UI 更新
                    if (gameState.pool.black.length === 0 && gameState.pool.white.length === 0) {
                        gameState.phase = 'guessing';
                    } else {
                        gameState.phase = 'drawing';
                    }
                    
                    updateUI();
                    
                    // 轮到 AI 行动
                    setTimeout(aiPlayTurn, 1000);
                    break;
            }
        }, 500);
    }

    function aiPlayTurn() {
        if (!isAIMode || (gameState.turn !== 'ai') || gameState.phase === 'ended') return;

        gameState.hasGuessedCorrectlyThisTurn = false;
        // 1. 摸牌
        // 检查牌堆是否为空
        const blackCount = gameState.pool.black.length;
        const whiteCount = gameState.pool.white.length;
        
        if (blackCount === 0 && whiteCount === 0) {
            // 牌堆已空，跳过摸牌，直接进入猜测阶段
            showStatusFeedback('🤖 牌堆已空，AI 直接开始猜测...', 'info');
            gameState.phase = 'guessing'; // 确保阶段正确
            setTimeout(aiThinkAndGuess, 2000);
            return;
        }

        const color = (blackCount > 0 && Math.random() > 0.5) || whiteCount === 0 ? COLORS.BLACK : COLORS.WHITE;
        const tile = color === COLORS.BLACK ? gameState.pool.black.pop() : gameState.pool.white.pop();
        tile.isNew = true; // 标记新摸的牌，用于猜错惩罚
        
        gameState.visitorTiles.push(tile); // 房主（这里是 AI）视角记录
        // AI 摸到的牌不参与排序，直接作为待定牌
        // gameState.visitorTiles = sortTiles(gameState.visitorTiles); // 移除此行，AI 的牌也需要像玩家一样有待定状态
        gameState.oppLastDrawnTile = tile; // AI 摸到的牌，放在待定区

        syncOppTilesFromVisitor(); // 同步缩略版手牌
        
        showStatusFeedback('🤖 AI 正在摸牌...', 'info');
        updateUI();

        // 2. 思考并猜测
        setTimeout(aiThinkAndGuess, 2000);
    }

    function aiThinkAndGuess() {
        if (gameState.phase === 'ended') return;

        // AI 逻辑：尝试猜测玩家的牌
        // 找到玩家未揭开的牌
        const hiddenIndices = gameState.myTiles.map((t, i) => t.isRevealed ? -1 : i).filter(i => i !== -1);
        if (hiddenIndices.length === 0) return;

        // 随机选一张
        const targetIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
        const targetTile = gameState.myTiles[targetIndex];
        
        // 智能猜测逻辑（简单版）：
        // 获取所有已知的数字（AI 自己的手牌 + 场上已揭开的牌）
        const knownNumbers = [
            ...gameState.visitorTiles.map(t => t.value),
            ...gameState.myTiles.filter(t => t.isRevealed).map(t => t.value)
        ];
        
        // 可能的数字 0-11 + J
        let possibleValues = [...Array.from({length: 12}, (_, i) => i), 'J'].filter(v => !knownNumbers.includes(v));
        
        // 进一步缩小范围：根据排序逻辑
        // 找到左边最近的已揭开牌
        let minVal = -1;
        for (let i = targetIndex - 1; i >= 0; i--) {
            if (gameState.myTiles[i].isRevealed) {
                // 如果左边是 Joker，没法提供数字边界参考
                if (gameState.myTiles[i].value === 'J') continue;
                minVal = gameState.myTiles[i].value;
                break;
            }
        }
        // 找到右边最近的已揭开牌
        let maxVal = 13;
        for (let i = targetIndex + 1; i < gameState.myTiles.length; i++) {
            if (gameState.myTiles[i].isRevealed) {
                if (gameState.myTiles[i].value === 'J') continue;
                maxVal = gameState.myTiles[i].value;
                break;
            }
        }
        
        // 过滤可能的值 (Joker 始终可能，除非已被揭开)
        possibleValues = possibleValues.filter(v => {
            if (v === 'J') return true;
            return v > minVal && v < maxVal;
        });
        
        // 如果没有可能的值（极少发生，除非逻辑错），则随机猜
        const guessVal = possibleValues.length > 0 ? 
            possibleValues[Math.floor(Math.random() * possibleValues.length)] : 
            Math.floor(Math.random() * 12);

        showStatusFeedback(`🤖 AI 正在猜测您的第 ${targetIndex + 1} 张牌为 ${guessVal}...`, 'info');
        
        setTimeout(() => {
            const success = targetTile.value === guessVal;
            if (success) {
                targetTile.isRevealed = true;
                showStatusFeedback(`🤖 AI 猜对了！您的第 ${targetIndex + 1} 张牌是 ${guessVal}`, 'error');
                updateUI();
                checkWin();
                
                // 猜对了有概率继续猜
                if (gameState.phase !== 'ended' && Math.random() > 0.4) {
                    setTimeout(aiThinkAndGuess, 2000);
                } else {
                    aiEndTurn();
                }
            } else {
                // 猜错了，AI 惩罚翻牌
                const lastDrawn = gameState.visitorTiles.find(t => t.isNew) || gameState.visitorTiles[gameState.visitorTiles.length - 1];
                if (lastDrawn) {
                    lastDrawn.isRevealed = true;
                    // 同步到 oppTiles
                    syncOppTilesFromVisitor();
                }
                showStatusFeedback(`🤖 AI 猜错了！数字不是 ${guessVal}`, 'success');
                aiEndTurn();
            }
        }, 1500);
    }

    function aiEndTurn() {
        if (gameState.phase === 'ended') return;
        
        gameState.hasGuessedCorrectlyThisTurn = false; // AI 结束回合，重置状态
        // AI 结束回合：将新牌归入手牌序列
        // 找到 AI 最后摸的那张牌
        const lastDrawn = gameState.visitorTiles.find(t => t.isNew);
        if (lastDrawn) {
            delete lastDrawn.isNew;
            gameState.visitorTiles = sortTiles(gameState.visitorTiles);
            syncOppTilesFromVisitor();
        }
        
        gameState.oppLastDrawnTile = null; // 清除 AI 的待定牌
        
        gameState.turn = 'player'; // AI 模式下，玩家的 ID 固定为 'player'
        gameState.phase = 'drawing';
        
        updateUI();
    }

    // --- Utils ---
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // --- Game Logic ---

    function initGame() {
        // Create pool: 0-11 + Joker for each color
        const black = Array.from({length: 12}, (_, i) => ({ id: generateUUID(), value: i, color: COLORS.BLACK, isRevealed: false }));
        black.push({ id: generateUUID(), value: 'J', color: COLORS.BLACK, isRevealed: false });
        
        const white = Array.from({length: 12}, (_, i) => ({ id: generateUUID(), value: i, color: COLORS.WHITE, isRevealed: false }));
        white.push({ id: generateUUID(), value: 'J', color: COLORS.WHITE, isRevealed: false });
        
        gameState.pool.black = shuffle(black);
        gameState.pool.white = shuffle(white);

        // Initial deal (4 each)
        // 修改：让双方各摸两黑两白，而不是房主全黑、访客全白
        const hostTiles = [];
        const guestTiles = [];
        for(let i=0; i<2; i++) {
            hostTiles.push(gameState.pool.black.pop());
            hostTiles.push(gameState.pool.white.pop());
            
            guestTiles.push(gameState.pool.black.pop());
            guestTiles.push(gameState.pool.white.pop());
        }

        gameState.myTiles = sortTiles(hostTiles);
        
        // 初始手牌中的 Joker 允许移动
        gameState.myTiles.forEach(t => {
            if (t.value === 'J') t.isMovable = true;
        });

        gameState.visitorTiles = sortTiles(guestTiles); // 房主存一份访客的完整牌
        
        // 初始手牌中的 Joker 允许移动
        gameState.visitorTiles.forEach(t => {
            if (t.value === 'J') t.isMovable = true;
        });

        syncOppTilesFromVisitor(); // 根据 visitorTiles 生成最初的 oppTiles

        gameState.turn = 'host'; // 使用角色标识而非 ID
        gameState.phase = 'drawing';
        gameState.hasGuessedCorrectlyThisTurn = false;

        send('init', {
            pool: gameState.pool,
            tiles: gameState.visitorTiles, // 发送已排序且包含 isMovable 标记的牌
            oppTiles: gameState.myTiles.map(t => ({ color: t.color, isRevealed: false })),
            turn: 'host'
        });

        updateUI();
    }

    function sortTiles(tiles) {
        // 分离 Joker 和普通数字
        const jokers = [];
        const others = [];
        
        tiles.forEach((t, i) => {
            if (t.value === 'J') {
                jokers.push({ tile: t, index: i });
            } else {
                others.push(t);
            }
        });

        // 对数字进行排序
        others.sort((a, b) => {
            if (a.value !== b.value) {
                return a.value - b.value;
            }
            return a.color === COLORS.BLACK ? -1 : 1;
        });

        // 如果是初始发牌（手牌较少），Joker 默认放最后
        if (tiles.length <= 4) {
            return [...others, ...jokers.map(j => j.tile)];
        }

        // 游戏中，尝试保持 Joker 的原位置
        const result = [...others];
        // 按索引从小到大插入
        jokers.sort((a, b) => a.index - b.index).forEach(j => {
            if (j.index < result.length) {
                result.splice(j.index, 0, j.tile);
            } else {
                result.push(j.tile);
            }
        });

        return result;
    }

    // 新增：同步 oppTiles 到 visitorTiles (用于 AI 模式或房主视角)
    function syncOppTilesFromVisitor() {
        if (!gameState.visitorTiles) return;
        // 只有非新摸的牌（已归入手牌的）才同步到 oppTiles
        gameState.oppTiles = gameState.visitorTiles
            .filter(t => !t.isNew)
            .map(t => ({
                id: t.id,
                color: t.color,
                isRevealed: t.isRevealed,
                value: t.value // 房主本地保存完整数据，无需隐藏数值
            }));
    }

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // --- Persistence ---
    function saveGameState() {
        if (isAIMode) return; // AI 模式不持久化

        // 关键修改：只有房主负责保存游戏状态，访客不保存，完全依赖房主同步
        if (!isHost) return;

        const roomId = new URLSearchParams(window.location.search).get('room') || myId;
        if (roomId && gameState.phase !== 'waiting') {
            localStorage.setItem(`coda_state_${roomId}`, JSON.stringify({
                gameState,
                isHost,
                myId // 保存自己的 ID 以便恢复身份
            }));
        }
    }

    function loadGameState() {
        const roomId = new URLSearchParams(window.location.search).get('room') || myId;
        if (roomId) {
            const saved = localStorage.getItem(`coda_state_${roomId}`);
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    // 只有当保存的状态不是 'waiting' 且 ID 匹配时才恢复
                    if (data.gameState && data.gameState.phase !== 'waiting' && data.gameState.phase !== 'ended') {
                        // 额外检查：如果保存的 myId 和当前 myId 不同，说明不是同一个人，不恢复
                        if (data.myId && data.myId !== myId) return null;

                        // 迁移逻辑：确保 turn 标识是新格式 ('host'/'guest')
                        if (data.gameState.turn && data.gameState.turn !== 'host' && data.gameState.turn !== 'guest' && data.gameState.turn !== 'ai' && data.gameState.turn !== 'waiting') {
                            // 如果是旧的 Peer ID 格式，根据 data.isHost 恢复为新格式
                            data.gameState.turn = data.isHost ? 'host' : 'guest';
                        }
                        
                        return data;
                    }
                } catch (e) {
                    console.error('Error parsing saved state:', e);
                    return null;
                }
            }
        }
        return null;
    }

    function clearSavedState() {
        const roomId = new URLSearchParams(window.location.search).get('room') || myId;
        if (roomId) {
            localStorage.removeItem(`coda_state_${roomId}`);
        }
    }

    function checkIsMyTurn() {
        if (isAIMode) return gameState.turn !== 'ai';
        if (gameState.turn === 'host') return isHost;
        if (gameState.turn === 'guest') return !isHost;
        if (gameState.turn === 'player') return true; // AI 模式兼容
        return gameState.turn === myId; // 兼容旧版 ID 格式
    }

    let lastTurnOwner = null;

    function updateUI() {
        const isMyTurn = checkIsMyTurn();
        
        // 如果轮到我的回合，且之前不是我的回合，播放闪烁特效
        if (isMyTurn && lastTurnOwner !== 'me' && gameState.phase !== 'waiting') {
            $('body').addClass('turn-start-flash');
            setTimeout(() => $('body').removeClass('turn-start-flash'), 1000);
            lastTurnOwner = 'me';
        } else if (!isMyTurn) {
            lastTurnOwner = 'opp';
        }

        // 每次 UI 更新时保存状态
        saveGameState();
        
        // Update Indicator
        $('#player-indicator')
            .text(isMyTurn ? '您的回合' : '对手回合')
            .removeClass('bg-orange-100 text-orange-600 bg-slate-100 text-slate-600')
            .addClass(isMyTurn ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-600');

        // Update Status
        if (!isFeedbackActive) {
            let statusText = '';
            if (isMyTurn) {
                if (gameState.phase === 'drawing') statusText = '请从牌堆中摸一张牌';
                else if (gameState.phase === 'guessing') statusText = '点击对方磁砖进行猜测';
                else if (gameState.phase === 'punishing') statusText = '猜错了！请选择自己的一张牌翻开作为惩罚';
                else if (gameState.phase === 'ended') statusText = '游戏已结束';
                else statusText = '请等待...';
            } else {
                const oppName = isAIMode ? 'AI' : '对手';
                if (gameState.phase === 'drawing') statusText = `${oppName}正在摸牌...`;
                else if (gameState.phase === 'guessing') statusText = `${oppName}正在猜测您的牌...`;
                else if (gameState.phase === 'punishing') statusText = `${oppName}正在接受惩罚...`;
                else if (gameState.phase === 'ended') statusText = '游戏已结束';
                else statusText = `等待${oppName}操作...`;
            }
            $('#status-msg').text(statusText);
        }

        if (gameState.phase === 'drawing') {
            $('#btn-end-turn').addClass('hidden');
        }

        // Render My Tiles
        const $myContainer = $('#my-tiles').empty();
        gameState.myTiles.forEach((tile, i) => {
            const isLastDrawn = false; // 已入手牌的不可能是 lastDrawn
            const $tile = createTileElement(tile, true, isLastDrawn);
            
            // 如果处于惩罚阶段，允许点击未翻开的牌进行翻开
            if (isMyTurn && gameState.phase === 'punishing' && !tile.isRevealed) {
                $tile.addClass('cursor-pointer ring-4 ring-red-400 hover:scale-105').on('click', () => handlePunishment(i));
            }
            
            // Joker 移动逻辑：必须是我的回合，且 Joker 未翻开且标记为可移动
            // gameState.hasGuessedCorrectlyThisTurn 不再是唯一条件，改为 tile.isMovable
            const canMoveJoker = isMyTurn && gameState.phase !== 'punishing' && !tile.isRevealed && tile.value === 'J' && tile.isMovable;
            if (tile.value === 'J' && canMoveJoker) {
                // 优化按钮样式：更小，半透明，图标更精致
                const btnClass = "absolute top-1/2 -translate-y-1/2 bg-slate-800/80 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md hover:bg-orange-500 z-30 transition-all active:scale-95 backdrop-blur-sm";
                const $moveLeft = $(`<button class="${btnClass} -left-3" title="向左移动"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" /></svg></button>`);
                const $moveRight = $(`<button class="${btnClass} -right-3" title="向右移动"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg></button>`);
                
                if (i > 0) {
                    $moveLeft.on('click', (e) => {
                        e.stopPropagation();
                        moveJoker(i, i - 1);
                    });
                    $tile.append($moveLeft);
                }
                if (i < gameState.myTiles.length - 1) {
                    $moveRight.on('click', (e) => {
                        e.stopPropagation();
                        moveJoker(i, i + 1);
                    });
                    $tile.append($moveRight);
                }
            }
            
            $myContainer.append($tile);
        });
        
        // 渲染我刚摸到的待定牌
        if (gameState.lastDrawnTile) {
            const $tile = createTileElement(gameState.lastDrawnTile, true, true);
            $tile.addClass('ml-8'); // 与手牌隔开一点距离
            $myContainer.append($tile);
        }

        // Render Opponent Tiles
        const $oppContainer = $('#opponent-tiles').empty();
        gameState.oppTiles.forEach((tile, i) => {
            const $tile = createTileElement(tile, false);
            if (isMyTurn && gameState.phase === 'guessing' && !tile.isRevealed) {
                $tile.addClass('cursor-pointer hover:scale-105').on('click', () => showGuessModal(i));
            }
            $oppContainer.append($tile);
        });
        
        // 渲染对手刚摸到的待定牌
        if (gameState.oppLastDrawnTile) {
            const $tile = createTileElement(gameState.oppLastDrawnTile, false, true); // 待定牌显示特殊样式
            $tile.addClass('ml-8');
            if (isMyTurn && gameState.phase === 'guessing' && !gameState.oppLastDrawnTile.isRevealed) {
                $tile.addClass('cursor-pointer hover:scale-105').on('click', () => showGuessModal(-1));
            }
            $oppContainer.append($tile);
        }

        // Update Pool
        $('#draw-black').toggle(gameState.pool.black.length > 0);
        $('#draw-white').toggle(gameState.pool.white.length > 0);
        $('#pool-count').text(`剩余: 黑 ${gameState.pool.black.length} / 白 ${gameState.pool.white.length}`);
        
        // Pool interaction & Auto-skip drawing if pool is empty
        if (isMyTurn && gameState.phase === 'drawing') {
            if (gameState.pool.black.length === 0 && gameState.pool.white.length === 0) {
                // 牌堆已空，自动进入猜测阶段
                gameState.phase = 'guessing';
                showStatusFeedback('牌堆已空，请直接猜测对方的牌', 'info');
                // 同步状态给对方
                send('sync', {
                    pool: gameState.pool,
                    oppTiles: gameState.myTiles.map(t => ({ 
                        id: t.id,
                        color: t.color, 
                        isRevealed: t.isRevealed,
                        value: t.isRevealed ? t.value : undefined
                    })),
                    turn: gameState.turn,
                    phase: 'guessing'
                });
                updateUI();
                return;
            }
            $('#pool-section').removeClass('opacity-50 pointer-events-none').addClass('action-pulse');
        } else {
            $('#pool-section').addClass('opacity-50 pointer-events-none').removeClass('action-pulse');
        }
    }

    function moveJoker(from, to) {
        const tiles = gameState.myTiles;
        if (tiles[from].isRevealed) {
            showStatusFeedback('❌ 已翻开的 Joker 不能移动', 'error');
            return;
        }
        if (!tiles[from].isMovable) {
            showStatusFeedback('❌ 此 Joker 此时无法移动（仅新获得或初始时可移动）', 'error');
            return;
        }
        const [joker] = tiles.splice(from, 1);
        tiles.splice(to, 0, joker);
        
        // 发送移动指令，确保对手（尤其是房主）也能同步调整对应的数组顺序
        send('move-tile', { from, to });
        
        // 紧接着发送 sync 以确保状态一致
        send('sync', {
            pool: gameState.pool,
            oppTiles: gameState.myTiles.map(t => ({ 
                id: t.id, // 关键：同步 ID
                color: t.color, 
                isRevealed: t.isRevealed, 
                value: t.isRevealed ? t.value : undefined 
            })),
            turn: gameState.turn,
            phase: gameState.phase,
            lastDrawnTile: gameState.lastDrawnTile ? { 
                id: gameState.lastDrawnTile.id, // 关键：同步 ID
                color: gameState.lastDrawnTile.color, 
                isRevealed: gameState.lastDrawnTile.isRevealed,
                value: gameState.lastDrawnTile.isRevealed ? gameState.lastDrawnTile.value : undefined
            } : null
        });
        
        updateUI();
        showStatusFeedback('🃏 Joker 已移动', 'success');
    }

    function createTileElement(tile, isMine, isSpecial = false) {
        if (!tile) return $('<div class="tile-placeholder"></div>');

        // 确保 value 为 undefined 时显示问号，而不是显示 "null" 字符串
        const displayValue = (tile.value === undefined || tile.value === null) ? '?' : tile.value;
        const backContent = isMine ? displayValue : '?';
        // 如果已经翻开，则双方都应该看到数值
        const frontContent = (tile.isRevealed || isMine) ? displayValue : '?';

        // 确保 color 属性正确
        const isBlack = tile.color === COLORS.BLACK || tile.color === 'black';
        const colorClass = isBlack ? 'tile-black' : 'tile-white';

        // 核心修改：如果是对手的牌且已翻开，我们必须强制显示正确的数值和颜色
        // tile.value 在 opponents 视角下可能为 undefined，除非 isRevealed 为 true
        // 但 createTileElement 被调用时，如果是对手的牌，传入的 tile 对象来自于 gameState.oppTiles
        
        // 渲染对手牌时，如果已翻开，确保样式正确
        // 注意：.tile-front 是翻开后显示的那一面（数值面）
        // .tile-back 是未翻开时显示的那一面（背面图案）
        
        const $el = $(`
            <div class="tile ${colorClass} ${tile.isRevealed ? 'revealed' : ''} ${isSpecial ? 'special' : ''} relative">
                <div class="tile-inner">
                    <div class="tile-front">${tile.isRevealed ? tile.value : (isMine ? tile.value : '?')}</div>
                    <div class="tile-back">${isMine ? tile.value : '?'}</div>
                </div>
            </div>
        `);
        return $el;
    }

    // --- Actions ---

    $('#draw-black').on('click', () => drawTile(COLORS.BLACK));
    $('#draw-white').on('click', () => drawTile(COLORS.WHITE));

    function drawTile(color) {
        if (!checkIsMyTurn() || gameState.phase !== 'drawing') return;

        const tile = color === COLORS.BLACK ? gameState.pool.black.pop() : gameState.pool.white.pop();
        tile.isNew = true;
        gameState.lastDrawnTile = tile;
        // 注意：根据新规则，摸到的牌先不放入 gameState.myTiles
        
        gameState.phase = 'guessing';
        
        // Notify opponent
        send('draw', { color });
        send('sync', {
                pool: gameState.pool,
                oppTiles: gameState.myTiles.map(t => ({ 
                    id: t.id,
                    color: t.color, 
                    isRevealed: t.isRevealed,
                    value: t.isRevealed ? t.value : undefined
                })),
                lastDrawnTile: { id: tile.id, color: tile.color, isRevealed: false }, // 告诉对方我摸了一张什么颜色的牌
                turn: gameState.turn,
                phase: 'guessing'
            });
        
        updateUI();
    }

    function handleOpponentDraw(color) {
        const tile = color === COLORS.BLACK ? gameState.pool.black.pop() : gameState.pool.white.pop();
        
        // 房主视角：更新 visitorTiles 的待定牌
        if (isHost) {
            gameState.oppLastDrawnTile = tile;
        } else {
            // 访客视角：记录待定牌颜色
            gameState.oppLastDrawnTile = { color: tile.color, isRevealed: false };
        }
        
        // 重要：更新 UI 以便保存状态到 localStorage
        updateUI();
    }

    let currentGuessIndex = -1;
    function showGuessModal(index) {
        currentGuessIndex = index;
        $('#guess-modal').removeClass('hidden').addClass('flex');
    }

    $('.guess-num-btn').on('click', function() {
        const text = $(this).text();
        const val = text === 'Joker' ? 'J' : parseInt(text);
        
        $('#guess-modal').addClass('hidden').removeClass('flex');
        
        send('guess', { index: currentGuessIndex, value: val });
        if (currentGuessIndex === -1) {
            $('#status-msg').text(`猜测对方新摸的牌为 ${val}...`);
        } else {
            $('#status-msg').text(`猜测第 ${currentGuessIndex + 1} 张牌为 ${val}...`);
        }
    });

    function processGuess(index, value) {
        const isLastDrawn = index === -1;
        const tile = isLastDrawn ? gameState.lastDrawnTile : gameState.myTiles[index];
        if (!tile) return;
        
        const success = tile.value === value;
        
        if (success) {
            tile.isRevealed = true;
            let finalIndex = index;
            // 如果被猜中的是 Joker
            if (tile.value === 'J') {
                if (isLastDrawn) {
                    gameState.myTiles.push(tile);
                    gameState.lastDrawnTile = null;
                    finalIndex = gameState.myTiles.length - 1;
                    showStatusFeedback(`❌ 哎呀！新摸的 Joker 被对手猜对了`, 'error');
                } else {
                    // 保持原位置，不移动到末尾
                    finalIndex = index;
                    showStatusFeedback(`❌ 哎呀！您的 Joker 被对手猜对了`, 'error');
                }
            } else {
                if (isLastDrawn) {
                    // 如果猜中的是待定牌，且不是 Joker，按规则需要放入手牌并保持翻开
                    gameState.myTiles.push(tile);
                    gameState.myTiles = sortTiles(gameState.myTiles);
                    gameState.lastDrawnTile = null;
                    // 重新找到该牌在手牌中的索引用于动画
                    finalIndex = gameState.myTiles.findIndex(t => t === tile);
                }
                showStatusFeedback(`❌ 哎呀！${isLastDrawn ? '新摸的牌' : '第 ' + (index + 1) + ' 张牌'}被对手猜对了 (${value})`, 'error');
            }
            
            updateUI();
            const $tile = (isLastDrawn && finalIndex === -1) ? 
                $('#my-tiles .tile').last() : // Fallback
                $('#my-tiles .tile').eq(finalIndex);
            $tile.addClass('revealed-new');
            setTimeout(() => $tile.removeClass('revealed-new'), 3000);
        } else {
            // 对方猜错了，给被猜方显示提示
            showStatusFeedback(`🎉 好险！对手猜错了您的 ${isLastDrawn ? '新摸的牌' : '第 ' + (index + 1) + ' 张牌'}`, 'success');
        }

        send('guess-result', { success, index, value, color: tile.color });
        
        if (!success) {
            // 对方猜错了，回合即将切换（等待对手处理完惩罚发来的 end-turn）
            gameState.phase = 'waiting';
        } else {
            // 对方猜对了，对方可以选择继续猜或结束
            gameState.phase = 'waiting';
        }

        checkWin();
        
        send('sync', {
            pool: gameState.pool,
            oppTiles: gameState.myTiles.map(t => ({ 
                id: t.id,
                color: t.color, 
                isRevealed: t.isRevealed, 
                value: t.isRevealed ? t.value : undefined 
            })),
            turn: gameState.turn,
            phase: gameState.phase,
            lastDrawnTile: gameState.lastDrawnTile ? { 
                id: gameState.lastDrawnTile.id,
                color: gameState.lastDrawnTile.color, 
                isRevealed: gameState.lastDrawnTile.isRevealed,
                value: gameState.lastDrawnTile.isRevealed ? gameState.lastDrawnTile.value : undefined
            } : null
        });
        
        updateUI();
    }

    function handleGuessResult(success, index, value, color) {
        const isLastDrawn = index === -1;
        if (success) {
            gameState.hasGuessedCorrectlyThisTurn = true; // 记录猜对了
            
            let tile;
            if (isLastDrawn) {
                tile = gameState.oppLastDrawnTile;
                // 如果猜中的是待定牌，归入对手手牌
                gameState.oppTiles.push(tile);
                gameState.oppLastDrawnTile = null;
            } else {
                tile = gameState.oppTiles[index];
            }
            
            if (!tile) return;

            tile.isRevealed = true;
            tile.value = value;
            if (color) {
                tile.color = color;
            }
            
            // 记录最终显示索引，如果是 Joker 移位了，动画索引会变
            let finalIndex = isLastDrawn ? gameState.oppTiles.length - 1 : index;
            
            // 如果对手被猜中的是 Joker
            if (value === 'J') {
                if (isLastDrawn) {
                    finalIndex = gameState.oppTiles.length - 1;
                } else {
                    // 保持原位置
                    finalIndex = index;
                }
            } else if (isLastDrawn) {
                // 如果是普通待定牌，排序（注意对手的牌排序逻辑在访客端只能模拟）
                // 简单处理：保持在末尾或根据颜色简单排序
            }
            
            // 房主视角：同时更新 visitorTiles 的状态
            if (isHost && gameState.visitorTiles && !isAIMode) {
                // 注意：AI 模式下 visitorTiles 的更新已在 handleAIMessage 中处理
                // 非 AI 模式下，如果是房主，需要同步更新访客的数据
                // 这里我们依赖 sync 覆盖，暂不手动操作
            }
        
            // 猜测成功后，显示提示，并让玩家选择继续还是结束
            const posText = isLastDrawn ? '新摸的牌' : `第 ${index + 1} 张牌`;
            showStatusFeedback(`🎉 猜对了！对手的 ${posText} 确实是 ${value}。您可以继续猜测，或移动 Joker，或点击“结束回合”。`, 'success');
        
            // 关键修改：猜对了，将自己刚摸到的牌（如果有）归入手牌，以便进行 Joker 移动等操作
            if (gameState.lastDrawnTile) {
                // 如果是 Joker，标记为可移动
                if (gameState.lastDrawnTile.value === 'J') {
                    gameState.lastDrawnTile.isMovable = true;
                }

                gameState.myTiles.push(gameState.lastDrawnTile);
                gameState.myTiles = sortTiles(gameState.myTiles);
                gameState.lastDrawnTile = null;
                
                // 立即通知对方我把待定牌拿进来了
                send('sync', {
                    pool: gameState.pool,
                    oppTiles: gameState.myTiles.map(t => ({ 
                        id: t.id,
                        color: t.color, 
                        isRevealed: t.isRevealed, 
                        value: t.isRevealed ? t.value : undefined 
                    })),
                    lastDrawnTile: null, // 显式清除待定牌
                    turn: gameState.turn,
                    phase: gameState.phase
                });
            }

            $('#btn-end-turn').removeClass('hidden');
            gameState.phase = 'guessing';
            
            // 重新渲染后应用“新翻开”动画
            updateUI(); 
            const $tile = $('#opponent-tiles .tile').eq(finalIndex);
            $tile.addClass('revealed-new');
            setTimeout(() => $tile.removeClass('revealed-new'), 3000);
        } else {
            gameState.hasGuessedCorrectlyThisTurn = false; // 猜错了，重置状态
            
            // 猜错了：执行惩罚
            // 优先查找待定牌，如果已归入则查找标记为 isNew 的牌
            let penaltyTile = gameState.lastDrawnTile;
            let isMergedNew = false;
            
            if (!penaltyTile) {
                penaltyTile = gameState.myTiles.find(t => t.isNew);
                isMergedNew = true;
            }

            if (penaltyTile) {
                 // 惩罚：翻开刚才摸到的那张牌
                 penaltyTile.isRevealed = true;
                 
                 // 如果摸到的是 Joker，放到末尾，否则按原逻辑排序
                 if (penaltyTile.value === 'J') {
                     if (isMergedNew) {
                         // 已经在手牌里，如果是 Joker，移到末尾
                         const idx = gameState.myTiles.indexOf(penaltyTile);
                         if (idx !== -1) {
                             gameState.myTiles.splice(idx, 1);
                             gameState.myTiles.push(penaltyTile);
                         }
                     } else {
                         gameState.myTiles.push(penaltyTile);
                     }
                     showStatusFeedback(`❌ 猜错了！摸到的 Joker 已翻开并移至末尾`, 'error');
                 } else {
                     if (!isMergedNew) {
                        gameState.myTiles.push(penaltyTile);
                     }
                     // 无论是否新并入，都要排序
                     gameState.myTiles = sortTiles(gameState.myTiles);
                     showStatusFeedback(`❌ 猜错了！刚摸到的牌已翻开 (${penaltyTile.value})`, 'error');
                 }
                 
                 const revealedValue = penaltyTile.value;
                 gameState.lastDrawnTile = null;
                 
                 // 立即更新 UI 并显示动画
                 updateUI();
                 // 找到刚插入的那张牌（即刚才被翻开的那张）
                 const newTileIdx = gameState.myTiles.findIndex(t => t.value === revealedValue && t.isRevealed);
                 if (newTileIdx !== -1) {
                     const $tile = $('#my-tiles .tile').eq(newTileIdx);
                     $tile.addClass('revealed-new');
                     setTimeout(() => $tile.removeClass('revealed-new'), 3000);
                 }
                 
                 // 延迟一下再结束回合，让玩家看清楚
                 setTimeout(() => {
                    // 清理标记
                    gameState.myTiles.forEach(t => { delete t.isNew; delete t.isMovable; });

                    send('end-turn', {
                        oppTiles: gameState.myTiles.map(t => ({ color: t.color, isRevealed: t.isRevealed, value: t.isRevealed ? t.value : undefined }))
                    });
                    gameState.turn = isAIMode ? 'ai' : (isHost ? 'guest' : 'host');
                    gameState.phase = 'drawing';
                    updateUI();
                }, 2000);
            } else {
                // 如果没有待定牌（牌堆已空），则必须选择一张现有手牌翻开
                showStatusFeedback('❌ 猜错了！由于牌堆已空，请选择一张您的手牌翻开示众', 'error');
                gameState.phase = 'punishing'; // 进入惩罚阶段
            }
            
            $('#btn-end-turn').addClass('hidden');
        }
        
        updateUI();
        checkWin();
    }

    // 新增：统一的状态反馈提示函数
    function showStatusFeedback(message, type) {
        const $status = $('#status-msg');
        isFeedbackActive = true;
        
        if (feedbackTimeout) {
            clearTimeout(feedbackTimeout);
        }
        
        // 视觉提示优化
        if (type === 'success') {
            $status.addClass('scale-105');
            setTimeout(() => $status.removeClass('scale-105'), 500);
        }

        $status.text(message)
            .removeClass('text-slate-500 text-green-600 text-red-600 text-blue-600')
            .addClass(type === 'success' ? 'text-green-600 font-bold' : (type === 'error' ? 'text-red-600 font-bold' : 'text-blue-600 font-bold'));

        // 3秒后恢复默认提示
        feedbackTimeout = setTimeout(() => {
            isFeedbackActive = false;
            feedbackTimeout = null;
            updateUI(); // 使用 updateUI 统一恢复逻辑
        }, 3000);
    }

    // 全局快捷键
    $(document).on('keydown', (e) => {
        // 如果弹窗开启，Enter 键用于确认猜测
        if (!$('#guess-modal').hasClass('hidden')) {
            // 目前弹窗是点击数字，Enter 键暂不处理，以免误操作
        } else {
            // Enter 键结束回合
            if (e.key === 'Enter' && !$('#btn-end-turn').hasClass('hidden')) {
                $('#btn-end-turn').click();
            }
        }
    });

    function handlePunishment(index) {
        const tile = gameState.myTiles[index];
        tile.isRevealed = true;
        
        // 如果翻开的是 Joker，移动到末尾
        if (tile.value === 'J') {
            gameState.myTiles.splice(index, 1);
            gameState.myTiles.push(tile);
            showStatusFeedback(`❌ 已选择翻开 Joker，并移至末尾`, 'error');
        } else {
            showStatusFeedback(`❌ 已选择翻开第 ${index + 1} 张牌 (${tile.value})`, 'error');
        }
        
        gameState.hasGuessedCorrectlyThisTurn = false; // 重置状态
        
        setTimeout(() => {
            // 清理标记
            gameState.myTiles.forEach(t => { delete t.isNew; delete t.isMovable; });

            send('end-turn', {
            oppTiles: gameState.myTiles.map(t => ({ 
                id: t.id, // 关键：同步 ID
                color: t.color, 
                isRevealed: t.isRevealed, 
                value: t.isRevealed ? t.value : undefined 
            }))
        });
            // 切换到对方角色
            gameState.turn = isAIMode ? 'ai' : (isHost ? 'guest' : 'host');
            gameState.phase = 'drawing';
            updateUI();
            checkWin();
        }, 2000);
    }

    function checkWin() {
        const allMyRevealed = gameState.myTiles.every(t => t.isRevealed);
        const allOppRevealed = gameState.oppTiles.every(t => t.isRevealed);

        if (allMyRevealed) {
            showEndGame(false);
        } else if (allOppRevealed) {
            showEndGame(true);
        }
    }

    function showEndGame(isWin) {
        gameState.phase = 'ended';
        $('#end-icon').text(isWin ? '🏆' : '💀');
        $('#end-title').text(isWin ? '获得胜利！' : '遗憾落败');
        $('#end-msg').text(isWin ? '你破解了对手所有的密码。' : '你的所有密码已被揭开。');
        $('#end-modal').removeClass('hidden').addClass('flex');

        // 如果是房主，显示“再来一局”按钮
        if (isHost) {
            $('#btn-play-again').removeClass('hidden');
        } else {
            $('#btn-play-again').addClass('hidden');
        }
    }

    $('#btn-play-again').on('click', () => {
        if (!isHost) return;

        // 重置游戏状态
        initGame();
        
        // 通知对手重新开始
        send('restart-game', {
            pool: gameState.pool,
            tiles: gameState.visitorTiles,
            oppTiles: gameState.myTiles.map(t => ({ color: t.color, isRevealed: false })),
            turn: 'host'
        });

        $('#end-modal').addClass('hidden').removeClass('flex');
    });

    // --- UI Events ---

    $('#btn-ai').on('click', () => {
        isAIMode = true;
        isHost = true; // AI 模式下玩家作为主控方
        $('#btn-ai').prop('disabled', true).text('正在初始化 AI...');
        $('#create-room-section').addClass('hidden');
        $('#lobby').addClass('hidden');
        $('#game-board').removeClass('hidden');
        initPeer();
    });

    $('#btn-create').on('click', () => {
        isHost = true;
        $('#btn-create').prop('disabled', true).text('正在初始化...');
        $('#create-room-section').addClass('hidden');
        $('#waiting-section').removeClass('hidden').find('p').text('正在创建房间...');
        initPeer();
    });

    $('#btn-join').on('click', () => {
        const id = $('#room-id-input').val().trim();
        if (id) {
            $('#btn-join').prop('disabled', true).text('连接中...');
            joinRoom(id);
        }
    });

    function joinRoom(id) {
        isHost = false;
        $('#waiting-section').removeClass('hidden').find('p').text('正在连接房间...');
        $('#create-room-section').addClass('hidden');
        
        if (!peer) {
            initPeer();
            peer.on('open', () => {
                conn = peer.connect(id);
                setupConnection();
            });
        } else {
            conn = peer.connect(id);
            setupConnection();
        }
    }

    $('#btn-copy').on('click', () => {
        const $input = $('#share-url');
        const text = $input.val();
        
        if (!text) return;

        // 优先尝试现代 API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showCopyStatus();
            }).catch(err => {
                console.error('Clipboard API failed, trying select & execCommand:', err);
                copyUsingInput($input);
            });
        } else {
            copyUsingInput($input);
        }
    });

    function copyUsingInput($input) {
        try {
            // 移动端兼容性处理
            $input.prop('readonly', true); // 确保只读防止键盘弹出
            $input[0].select();
            $input[0].setSelectionRange(0, 99999); // For mobile devices

            const successful = document.execCommand('copy');
            if (successful) {
                showCopyStatus();
            } else {
                // 如果还不行，尝试旧的 fallbackCopy（创建临时元素）
                fallbackCopy($input.val());
            }
            
            // 取消选中
            window.getSelection().removeAllRanges();
            $input.blur();
        } catch (err) {
            console.error('Selection copy failed:', err);
            fallbackCopy($input.val());
        }
    }

    function showCopyStatus() {
        const $btn = $('#btn-copy');
        const originalText = $btn.text();
        $btn.text('已复制').addClass('text-green-500').removeClass('text-orange-500');
        setTimeout(() => {
            $btn.text(originalText).addClass('text-orange-500').removeClass('text-green-500');
        }, 2000);
    }

    function fallbackCopy(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        // Ensure textarea is not visible but still part of the document
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showCopyStatus();
            } else {
                alert('复制失败，请手动选择链接复制');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            alert('复制失败，请手动选择链接复制');
        }
        document.body.removeChild(textArea);
    }

    $('#btn-cancel-guess').on('click', () => {
        $('#guess-modal').addClass('hidden').removeClass('flex');
    });

    $('#btn-end-turn').on('click', () => {
        gameState.hasGuessedCorrectlyThisTurn = false; // 结束回合，重置状态
        // 结束回合：将摸到的待定牌插入手牌
        if (gameState.lastDrawnTile) {
            gameState.myTiles.push(gameState.lastDrawnTile);
            gameState.myTiles = sortTiles(gameState.myTiles);
            gameState.lastDrawnTile = null;
        }
        
        // 清除所有牌的 isNew 标记和 isMovable 标记
        gameState.myTiles.forEach(t => {
            delete t.isNew;
            delete t.isMovable;
        });
        
        send('end-turn', {
            oppTiles: gameState.myTiles.map(t => ({ 
                id: t.id, // 关键：同步 ID
                color: t.color, 
                isRevealed: t.isRevealed, 
                value: t.isRevealed ? t.value : undefined 
            }))
        });
        
        // 切换到对方的角色
        gameState.turn = isAIMode ? 'ai' : (isHost ? 'guest' : 'host');
        gameState.phase = 'drawing';
        updateUI();
    });

    $('#btn-quit').on('click', () => {
        if (confirm('确定要退出游戏吗？')) {
            location.href = '../../online.html';
        }
    });

    // Auto-init peer if room in URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const savedId = localStorage.getItem('coda_peer_id');

    if (roomParam) {
        if (roomParam === savedId) {
            // 我是房主，正在刷新页面
            isHost = true;
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden').find('p').text('正在恢复房间...');

            // 房主恢复本地保存的游戏状态
            const savedState = loadGameState();
            if (savedState) {
                gameState = savedState.gameState;
                isHost = savedState.isHost;
                console.log('Host state restored from localStorage');
            }
        } else {
            // 我是访客
            isHost = false;
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden').find('p').text('正在重新加入房间，等待房主同步...');

            // 访客不再尝试从本地恢复状态，完全依赖房主同步
            // 确保不显示错误/过期的本地状态
            $('#lobby').addClass('hidden');
            // 暂时不显示游戏界面，直到收到房主的 resume 消息
            $('#game-board').addClass('hidden'); 
        }
        initPeer();
    }
});