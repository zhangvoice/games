$(document).ready(function() {
    // --- 常量定义 ---
    const COLORS = { BLACK: 'black', RED: 'red', BLUE: 'blue', ORANGE: 'orange' };
    const JOKER_VALUE = 30; // 内部排序值
    
    // --- 调试配置 ---
    const DEBUG_MODE = false; // 调试开关
    
    function debug(...args) {
        if (DEBUG_MODE) {
            console.log('[Rummikub]', ...args);
        }
    }
    
    // --- 全局状态 ---
    let peer = null;
    let conn = null;
    let myId = null;
    let isHost = false;
    let isAIMode = false;
    
    // --- 玩家管理 ---
    // 重构：支持多玩家（最多4人）
    // 玩家对象结构： { id, name, isBot, hand: [], hasBrokenIce: false, isMyTurn: false }
    let gamePlayers = []; 
    let myPlayerIndex = -1;
    let currentTurnIndex = 0;
    
    // --- 计时器状态 ---
    let turnTimer = null;
    let timeLeft = 60;
    const TURN_TIME_LIMIT = 60;

    let gameState = {
        pool: [],           // 牌堆中剩余的牌
        // myHand 属性不再单独使用，而是直接引用 gamePlayers[myPlayerIndex].hand
        // 但为了兼容现有代码，可能需要保留或使用 getter
        tableSets: [],      // 桌面牌组
        backupState: null,  // 撤销用的快照
        lastMove: null,     // 记录最后一次出牌的牌组索引
        icebreakerEnabled: false,
        gameStarted: false,
    };
    
    // 兼容旧代码：通过 getter/setter 代理访问当前玩家手牌
    Object.defineProperty(gameState, 'myHand', {
        get: function() {
            if (myPlayerIndex === -1 || !gamePlayers[myPlayerIndex]) return [];
            return gamePlayers[myPlayerIndex].hand;
        },
        set: function(val) {
            if (myPlayerIndex === -1 || !gamePlayers[myPlayerIndex]) return;
            gamePlayers[myPlayerIndex].hand = val;
        }
    });
    
    // 兼容层：获取我的手牌
    function getMyHand() {
        if (myPlayerIndex === -1) return [];
        return gamePlayers[myPlayerIndex].hand;
    }
    
    // 兼容层：设置我的手牌
    function setMyHand(newHand) {
        if (myPlayerIndex === -1) return;
        gamePlayers[myPlayerIndex].hand = newHand;
    }

    let selectedTiles = new Set(); // 选中的手牌索引集合
    let draggingTile = null;       // 当前拖拽的牌信息
    let dragOverSet = null;        // 当前悬停的牌组
    
    // --- 大厅状态 ---
    let lobbyPlayers = []; // {id, name, isBot}

    // --- PeerJS 设置 (参考自 Coda) ---
    function initPeer() {
        if (isAIMode) {
            myId = 'player';
            isHost = true;
            conn = { open: true };
            
            // 本地模式初始化大厅
            lobbyPlayers = [{ id: myId, name: '玩家 (房主)', isBot: false }];
            
            // 自动添加一个机器人
            lobbyPlayers.push({ id: 'ai-player-' + Date.now(), name: 'Bot ' + lobbyPlayers.length, isBot: true });
            
            updateLobbyUI();
            
            $('#waiting-section').removeClass('hidden');
            $('#waiting-msg').text('玩家已就绪');
            $('#room-link-container').addClass('hidden'); // 本地模式隐藏链接
            return;
        }

        const savedId = localStorage.getItem('rummi_peer_id');

        peer = new Peer(savedId, PEER_CONFIG);

        peer.on('open', (id) => {
            myId = id;
            localStorage.setItem('rummi_peer_id', id);
            
            // 添加自己到列表
            lobbyPlayers = [{ id: myId, name: '玩家 (房主)', isBot: false }];
            updateLobbyUI();
            
            const url = new URL(window.location.href);
            url.searchParams.set('room', id);
            $('#share-url').val(url.toString());
            
            $('#btn-copy').prop('disabled', false)
                .removeClass('text-slate-300 cursor-not-allowed')
                .addClass('text-orange-500 hover:text-orange-600 cursor-pointer');
            
            if (isHost) {
                $('#waiting-section').removeClass('hidden'); // 确保显示
                $('#waiting-section').find('#waiting-msg').text('等待对手加入...');
            }
            
            const joinId = new URLSearchParams(window.location.search).get('room');
            if (joinId && joinId !== id) {
                joinRoom(joinId);
            }
        });

        peer.on('connection', (connection) => {
            if (conn && conn.open) {
                connection.close();
                return;
            }
            // 检查是否已添加机器人
            if (isAIMode) {
                connection.close();
                return;
            }
            
            conn = connection;
            isHost = true;
            setupConnection();
        });

        peer.on('error', (err) => {
            alert('连接错误: ' + err.type);
        });
    }

    function setupConnection() {
        if (!window.connections) window.connections = {}; // 初始化连接池

        conn.on('data', (data) => {
            handleMessage(data, conn.peer);
        });

        conn.on('open', () => {
            if (lobbyPlayers.length >= 4) { // 增加到4人
                conn.send({ type: 'error', message: '房间已满' });
                setTimeout(() => conn.close(), 500);
                return;
            }

            // 保存连接
            window.connections[conn.peer] = conn;

            // 有人加入
            lobbyPlayers.push({ id: conn.peer, name: '玩家' + (lobbyPlayers.length + 1), isBot: false });
            updateLobbyUI();
            
            // 广播新的大厅玩家列表给所有客户端
            broadcast('lobby-update', { players: lobbyPlayers });
            
            if (isHost) {
                // 如果游戏已经开始，说明是重连
                if (gameState.gameStarted) {
                    $('#lobby').addClass('hidden');
                    $('#game-board').removeClass('hidden');
                    
                    // 重连逻辑：找到该玩家的数据
                    const pIndex = gamePlayers.findIndex(p => p.id === conn.peer);
                    if (pIndex !== -1) {
                         gamePlayers[pIndex].isConnected = true;
                         // 发送完整状态
                         const state = {
                            pool: gameState.pool,
                            players: gamePlayers,
                            tableSets: gameState.tableSets,
                            currentTurnIndex: currentTurnIndex,
                            icebreakerEnabled: gameState.icebreakerEnabled
                         };
                         conn.send({ type: 'init', ...state });
                         showToast('玩家重新连接');
                    } else {
                        conn.send({ type: 'error', message: '游戏已开始，无法加入' });
                        conn.close();
                    }
                } else {
                    // 如果在等待大厅，发送当前大厅状态给新加入者
                    conn.send({ type: 'lobby-update', players: lobbyPlayers });
                }
            }
        });
        
        conn.on('close', () => {
             // 移除连接
             if (window.connections) delete window.connections[conn.peer];
             
             if (gameState.gameStarted) {
                 const p = gamePlayers.find(p => p.id === conn.peer);
                 if (p) {
                     p.isConnected = false;
                     showToast(`${p.name} 已断开连接`);
                 }
             } else {
                 lobbyPlayers = lobbyPlayers.filter(p => p.id !== conn.peer);
                 updateLobbyUI();
                 // 广播更新
                 broadcast('lobby-update', { players: lobbyPlayers });
             }
        });
    }
    
    function updateLobbyUI() {
        const $list = $('#lobby-players').empty();
        lobbyPlayers.forEach(p => {
            $list.append(`<li>${p.name} ${p.isBot ? '(电脑)' : ''}</li>`);
        });
        
        // 始终显示玩家列表
        $('#player-list-lobby').removeClass('hidden');
        
        // 只有房主能看到操作按钮
        if (!isHost) {
            $('#btn-add-bot').addClass('hidden');
            $('#btn-start-game').addClass('hidden');
            $('#room-link-container').addClass('hidden');
            $('#waiting-msg').text('等待房主开始...');
            $('#waiting-spinner').removeClass('hidden');
            return;
        }

        if (lobbyPlayers.length > 1) {
            $('#waiting-spinner').addClass('hidden');
            $('#waiting-msg').text('玩家已就绪');
            
            // 只要有 2 人，无论是不是机器人，都显示开始按钮
            $('#btn-start-game').removeClass('hidden');
            
            // 满员后禁止添加机器人 (4人)
            if (lobbyPlayers.length >= 4) {
                 $('#room-link-container').addClass('opacity-50 pointer-events-none');
                 $('#btn-add-bot').addClass('hidden');
            } else {
                 $('#room-link-container').removeClass('opacity-50 pointer-events-none');
                 $('#btn-add-bot').removeClass('hidden');
            }
        } else {
            $('#waiting-spinner').removeClass('hidden');
            $('#waiting-msg').text(isAIMode ? '请添加电脑玩家...' : '等待对手加入...');
            $('#room-link-container').removeClass('opacity-50 pointer-events-none');
            $('#btn-add-bot').removeClass('hidden');
            $('#btn-start-game').addClass('hidden');
        }
    }

    function handleMessage(msg, peerId) {
        debug('Received from ' + peerId + ':', msg);
        switch(msg.type) {
            case 'client-sync':
                if (isHost) {
                    const clientState = msg.state;
                    
                    // 更新桌面和牌堆
                    gameState.tableSets = clientState.tableSets;
                    gameState.pool = clientState.pool;
                    gameState.lastMove = clientState.lastMove;
                    
                    // 更新对应玩家手牌
                    const pIndex = gamePlayers.findIndex(p => p.id === peerId);
                    if (pIndex !== -1) {
                        gamePlayers[pIndex].hand = clientState.hand;
                        // 更新破冰状态
                        if (clientState.hasBrokenIce) {
                            gamePlayers[pIndex].hasBrokenIce = true;
                        }
                        
                        if (currentTurnIndex === pIndex) {
                             endTurn(); // 房主执行切换并广播
                        }
                    }
                }
                break;
            case 'lobby-update':
                // 客户端更新大厅
                lobbyPlayers = msg.players;
                updateLobbyUI();
                break;
            case 'init':
                $('#lobby').addClass('hidden');
                $('#game-board').removeClass('hidden');
                
                gameState.pool = msg.pool;
                
                // 客户端需要知道自己是谁
                gamePlayers = msg.players;
                myPlayerIndex = gamePlayers.findIndex(p => p.id === myId);
                
                // 设置本地状态
                gameState.tableSets = msg.tableSets;
                currentTurnIndex = msg.currentTurnIndex;
                gameState.icebreakerEnabled = msg.icebreakerEnabled;
                gameState.gameStarted = true;
                
                if (checkIsMyTurn()) startTurnTimer();
                updateUI();
                break;
            case 'sync':
                // 同步状态
                gameState.pool = msg.pool;
                gameState.tableSets = msg.tableSets;
                currentTurnIndex = msg.currentTurnIndex;
                gamePlayers = msg.players; // 接收最新的玩家状态（包括手牌）
                // 客户端可能不需要更新自己的手牌（除非强制同步），防止操作冲突
                // 但简单起见，我们全量同步
                
                gameState.icebreakerEnabled = msg.icebreakerEnabled;
                if (msg.lastMove) gameState.lastMove = msg.lastMove;
                
                if (checkIsMyTurn()) {
                    gameState.hasDrawn = false;
                    gameState.hasPlayed = false;
                    $('body').addClass('turn-start-flash');
                    setTimeout(() => $('body').removeClass('turn-start-flash'), 1000);
                    if (!turnTimer) startTurnTimer();
                } else {
                    stopTurnTimer();
                }
                updateUI();
                break;
            case 'game-over':
                showEndGame(msg.winnerId === myId);
                break;
            case 'host-left':
                showToast('房主已退出，房间解散');
                // ...
                break;
        }
    }

    function send(type, data = {}) {
        if (isAIMode) return; // 暂无 AI 逻辑
        if (conn && conn.open) {
            conn.send({ type, ...data });
        }
    }

    // --- 状态管理 ---
    
    function startTurn(shouldUpdateUI = true) {
        if (gameState.backupState) return; // 已经开始
        // 深拷贝用于备份
        gameState.backupState = {
            myHand: JSON.parse(JSON.stringify(gameState.myHand)),
            tableSets: JSON.parse(JSON.stringify(gameState.tableSets))
        };
        $('body').addClass('my-turn-active');
        if (shouldUpdateUI) updateUI();
    }

    function updateButtonsOnly() {
        const isMyTurn = checkIsMyTurn();
        const canAct = isMyTurn && !gameState.hasDrawn;
        const isDrafting = !!gameState.backupState;

        if (isDrafting) {
            $('#btn-reset').removeClass('hidden').prop('disabled', false);
            
            // 验证桌面合法性
            const allSetsValid = gameState.tableSets.every(set => isValidSet(set));
            
            // 验证是否实际改变了状态
            const hasChanged = hasStateChanged();
            
            // 只有当桌面合法且状态已改变时，才启用提交按钮
            $('#btn-commit').removeClass('hidden').prop('disabled', !(allSetsValid && hasChanged));
            $('#btn-draw').addClass('hidden');
        } else {
            $('#btn-reset').addClass('hidden');
            $('#btn-commit').addClass('hidden');
            $('#btn-draw').removeClass('hidden').prop('disabled', !canAct);
        }
        $('#status-msg').text(`牌堆剩余: ${gameState.pool.length} 张`);
    }
    
    function hasStateChanged() {
        if (!gameState.backupState) return false;
        
        // 1. 检查桌面是否变化
        const currentTableStr = JSON.stringify(gameState.tableSets);
        const backupTableStr = JSON.stringify(gameState.backupState.tableSets);
        
        if (currentTableStr !== backupTableStr) return true;
        
        // 2. 检查手牌是否变化（忽略顺序）
        // 如果手牌数量变了，那肯定变了
        if (gameState.myHand.length !== gameState.backupState.myHand.length) return true;
        
        // 如果数量没变，且桌面也没变，那么手牌的内容（ID集合）应该是一样的
        // 即使我们在手牌中重新排序了，只要 ID 集合没变，就不算“出牌”
        // 提取当前手牌 ID 并排序
        const currentHandIds = gameState.myHand.map(t => t.id).sort();
        // 提取备份手牌 ID 并排序
        const backupHandIds = gameState.backupState.myHand.map(t => t.id).sort();
        
        // 比较排序后的 ID 字符串
        const handChanged = JSON.stringify(currentHandIds) !== JSON.stringify(backupHandIds);
        
        if (handChanged) {
            debug('Hand content changed (real play)');
            return true;
        } else {
            debug('Hand content identical (just reordered)');
            return false;
        }
    }

    function resetTurn() {
        if (!gameState.backupState) return;
        
        gameState.myHand = JSON.parse(JSON.stringify(gameState.backupState.myHand));
        gameState.tableSets = JSON.parse(JSON.stringify(gameState.backupState.tableSets));
        gameState.hasPlayed = false;
        
        // 清除备份以允许摸牌或重置
        gameState.backupState = null;

        selectedTiles.clear();
        $('body').removeClass('my-turn-active'); // 视觉重置
        updateUI();
        syncState(); // 同时恢复对手视图
    }

    function commitTurn() {
        if (!checkIsMyTurn()) return;
        
        // 1. 验证桌面上所有牌组
        for (let set of gameState.tableSets) {
            if (!isValidSet(set)) {
                const reason = getSetInvalidReason(set);
                showToast(`非法牌组: ${reason}`);
                return;
            }
        }

        // 2. 检查是否实际出牌（手牌减少或桌面改变）
        // 简单检查：与备份对比
        const initialHandSize = gameState.backupState.myHand.length;
        const currentHandSize = gameState.myHand.length;
        
        if (currentHandSize === initialHandSize && JSON.stringify(gameState.tableSets) === JSON.stringify(gameState.backupState.tableSets)) {
            showToast('你还没有出牌！请出牌或摸牌。');
            return;
        }
        
        // 3. 破冰规则检查
        const me = gamePlayers[myPlayerIndex];
        if (gameState.icebreakerEnabled && !me.hasBrokenIce) {
            // 规则：首次出牌，打出的牌总分必须 >= 30
            // 且不允许操作现有的牌组（即现有牌组必须保持原样）
            
            // 检查是否有现有牌组被修改
            const backupTableStr = JSON.stringify(gameState.backupState.tableSets);
            // 简单比较：我们假设新牌组只是追加在后面？
            // 不一定，用户可能重新排序。
            // 更严格的检查：
            // 破冰时，通常要求你打出的所有牌组的总和 >= 30。
            // 且不能利用桌面上已有的牌。
            // 简单实现：检查本回合所有“新”牌组的分数总和。
            // 如果修改了旧牌组，视为犯规？或者必须保证旧牌组完全未动。
            
            // 为了简化，我们检查：
            // 1. 桌面上的牌组数量必须增加了。
            // 2. 且新增的牌组的总分 >= 30。
            // 3. 原有的牌组必须完全未动（内容一致）。
            
            // 但是 JS 对象比较比较麻烦。
            // 让我们用另一种思路：
            // 计算“本回合从手牌打出的所有牌”的总分。
            // 并且这些牌必须组成了独立的合法牌组。
            // 如果它们被合并到了旧牌组中，这在破冰规则中通常是不允许的。
            // Rummikub 规则： "Players must place ... sets ... with a total value of at least 30 points. These points must come from the tiles on the player's rack."
            // "You cannot manipulate other sets on the table until you have made your initial meld."
            
            // 所以：
            // 1. 检查 backupState.tableSets 中的所有牌组是否仍然原样存在于 tableSets 中。
            // 2. 计算 tableSets 中“不在 backupState 中”的牌组的总分。
            
            const backupSets = gameState.backupState.tableSets;
            const currentSets = gameState.tableSets;
            
            // 检查原有牌组是否被修改
            // 这一步比较严格：要求 backupSets 中的每个 set (按值) 都必须在 currentSets 中找到。
            // 必须处理排序问题：JSON.stringify 对数组顺序敏感。
            // 我们的牌组在 tableSets 中可能被 sortSet 重排，但 backupSets 中的也应该在操作前被排序。
            // 关键是：如果用户没有动旧牌组，它们的内容（包括顺序）应该完全一致。
            // 但是为了保险，我们比较“排序后的字符串”。
            
            const normalizeSet = (s) => JSON.stringify([...s].sort((a,b) => a.id.localeCompare(b.id)));
            
            const backupSetsNormalized = backupSets.map(normalizeSet);
            const currentSetsNormalized = currentSets.map(normalizeSet);
            
            let allBackupFound = true;
            for (let bStr of backupSetsNormalized) {
                if (!currentSetsNormalized.includes(bStr)) {
                    allBackupFound = false;
                    break;
                }
            }
            
            if (!allBackupFound) {
                 showToast('破冰回合（首次出牌）不能操作桌面已有的牌组！');
                 return;
            }
            
            // 计算新牌组分数
            let newPoints = 0;
            for (let i = 0; i < currentSets.length; i++) {
                const cSet = currentSets[i];
                const cSetStr = currentSetsNormalized[i];
                
                // 如果这个牌组不在备份中，那就是新的
                if (!backupSetsNormalized.includes(cSetStr)) {
                    newPoints += calculateSetPoints(cSet);
                }
            }
            
            if (newPoints < 30) {
                showToast(`破冰回合，打出的新牌组总分必须 ≥ 30 (当前: ${newPoints})`);
                return;
            }
            
            // 满足条件
            me.hasBrokenIce = true;
            showToast('破冰成功！');
        }

        // 4. 规则：不能将桌面上的牌收回手牌
        // (我们通过 UI 限制来实现这一点，但如果没有 ID 追踪，很难在此处验证。
        //  目前假设 UI 会处理)。

        // 计算本回合打出的牌（用于高亮显示给对手）
        const backupHandIds = new Set(gameState.backupState.myHand.map(t => t.id));
        const currentHandIds = new Set(gameState.myHand.map(t => t.id));
        const playedIds = [];
        for (let id of backupHandIds) {
            if (!currentHandIds.has(id)) {
                playedIds.push(id);
            }
        }
        gameState.lastMove = playedIds;

        // 成功
        gameState.backupState = null;
        gameState.hasPlayed = true;
        $('body').removeClass('my-turn-active');
        
        // 检查获胜
        if (gameState.myHand.length === 0) {
            // send('game-over', { winner: isHost ? 'host' : 'guest' }); // 旧逻辑
            showEndGame(true);
            if (isHost) broadcast('game-over', { winnerId: myId });
            return;
        }

        endTurn();
    }

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function initGame() {
        // 创建完整牌堆：4种颜色各2套1-13 + 2张百搭牌
        const deck = [];
        const colors = [COLORS.BLACK, COLORS.RED, COLORS.BLUE, COLORS.ORANGE];
        
        colors.forEach(color => {
            for (let i = 1; i <= 13; i++) {
                // 每张两份
                deck.push({ id: generateUUID(), value: i, color: color });
                deck.push({ id: generateUUID(), value: i, color: color });
            }
        });
        
        // 添加百搭牌
        deck.push({ id: generateUUID(), value: 'J', color: 'black' });
        deck.push({ id: generateUUID(), value: 'J', color: 'red' });

        const shuffled = shuffle(deck);
        
        // 初始化所有玩家
        // 使用 lobbyPlayers 填充 gamePlayers
        gamePlayers = lobbyPlayers.map((p, index) => {
             // 每个人发14张牌
             const hand = [];
             for(let i=0; i<14; i++) hand.push(shuffled.pop());
             
             if (p.id === myId) myPlayerIndex = index;
             
             return {
                 id: p.id,
                 name: p.name,
                 isBot: p.isBot,
                 hand: hand,
                 hasBrokenIce: false,
                 hasDrawn: false,
                 hasPlayed: false,
                 isConnected: true // 在线状态
             };
        });

        // 读取破冰设置
        const icebreakerEnabled = $('#chk-icebreaker').is(':checked');

        // 房主状态
        gameState.pool = shuffled;
        gameState.tableSets = [];
        currentTurnIndex = 0; // 房主先手
        gameState.icebreakerEnabled = icebreakerEnabled;
        gameState.backupState = null;
        gameState.gameStarted = true;

        // 广播初始化消息
        const stateForClients = {
            pool: gameState.pool, // 发送剩余牌堆（简单同步）
            players: gamePlayers, // 包含所有人的手牌，虽不安全但简单
            tableSets: [],
            currentTurnIndex: 0,
            icebreakerEnabled: icebreakerEnabled,
        };
        
        broadcast('init', stateForClients);
        
        updateUI();
        
        // 如果是AI先手（理论上房主先手，但如果房主把位置让了...目前房主总是index 0）
        if (gamePlayers[currentTurnIndex].isBot) {
            setTimeout(aiTurn, 1000);
        } else if (checkIsMyTurn()) {
            startTurnTimer();
        }
    }
    
    function broadcast(type, data) {
        if (conn && conn.open) { // 房主只有一个连接？不，房主有 connections
             // 如果是 PeerJS 的 connections
             // 我们需要遍历所有连接
             // 由于 conn 可能是单一连接（作为客户端时），或者我们需要维护 connections 列表（作为房主时）
             // 原有代码中，作为房主，我们没有维护 connections 列表。
             // 让我们检查 handleMessage 和 setupConnection
        }
        
        // 如果是房主，向所有客户端发送
        if (isHost && window.connections) {
            Object.values(window.connections).forEach(c => {
                if (c.open) c.send({ type, ...data });
            });
        }
    }

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function checkIsMyTurn() {
        if (!gamePlayers[currentTurnIndex]) return false;
        
        // 只有当前玩家 ID 与我的 ID 匹配时，才算是我的回合
        // 如果是机器人回合，即使我是房主，我也不应该通过 UI 操作（机器人有自己的自动逻辑）
        // 只有在调试或特殊“接管”模式下才允许
        // 为了防止房主在机器人回合误操作，我们返回 false
        
        if (gamePlayers[currentTurnIndex].isBot) {
            return false;
        }
        
        return gamePlayers[currentTurnIndex].id === myId;
    }

    // --- UI 渲染 ---

    function updateUI() {
        const isMyTurn = checkIsMyTurn();
        const currentPlayer = gamePlayers[currentTurnIndex];
        
        // 状态
        let turnText = '';
        if (!currentPlayer) {
             turnText = '游戏加载中...';
        } else if (currentPlayer.id === myId) {
            turnText = '👉 你的回合';
        } else if (currentPlayer.isBot) {
            turnText = `🤖 ${currentPlayer.name} 的回合`;
        } else {
            turnText = `⏳ ${currentPlayer.name} 的回合`;
        }
        
        $('#player-indicator')
            .text(turnText)
            .removeClass('bg-orange-100 text-orange-600 bg-slate-100 text-slate-600')
            .addClass((currentPlayer && currentPlayer.id === myId) ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-600');
        
        // 渲染对手区域（多个对手）
        const $opponentsContainer = $('#opponents-container').empty();
        
        // 从我的下家开始，顺时针显示对手
        const totalPlayers = gamePlayers.length;
        // 如果只有我一人，不显示对手
        if (totalPlayers > 1) {
            for (let i = 1; i < totalPlayers; i++) {
                const oppIndex = (myPlayerIndex + i) % totalPlayers;
                const opp = gamePlayers[oppIndex];
                
                // 确保对手存在
                if (!opp) continue;
                
                const isOppTurn = (oppIndex === currentTurnIndex);
                
                const $card = $(`
                    <div class="flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all min-w-[90px] ${isOppTurn ? 'border-orange-400 bg-orange-50 shadow-md scale-105 z-10' : 'border-slate-200 bg-white opacity-90'}">
                        <div class="flex items-center gap-1 mb-1 max-w-full">
                            <span class="text-xs font-bold truncate ${isOppTurn ? 'text-orange-700' : 'text-slate-700'}">${opp.name}</span>
                            ${opp.isBot ? '<span class="text-[10px]" title="Bot">🤖</span>' : ''}
                            ${!opp.isConnected && !opp.isBot ? '<span class="text-[10px] text-red-500" title="断线">🔌</span>' : ''}
                        </div>
                        
                        <div class="flex items-center gap-2">
                             <div class="relative w-8 h-10 bg-slate-700 rounded border border-slate-600 shadow-sm flex items-center justify-center">
                                <span class="text-white font-bold text-sm">${opp.hand ? opp.hand.length : 0}</span>
                             </div>
                             
                             ${gameState.icebreakerEnabled ? `
                                <div class="flex flex-col items-center">
                                    <span class="text-[10px] font-bold ${opp.hasBrokenIce ? 'text-green-600' : 'text-slate-400'}">
                                        ${opp.hasBrokenIce ? '✅' : '❄️'}
                                    </span>
                                    <span class="text-[8px] text-slate-400 scale-75 origin-top">破冰</span>
                                </div>
                             ` : ''}
                        </div>
                    </div>
                `);
                
                $opponentsContainer.append($card);
            }
        }
        
        // 渲染我的牌架
        const myHand = getMyHand();
        const $rack = $('#my-rack').empty();
        myHand.forEach((tile, index) => {
            const $el = createTileElement(tile);
            $el.attr('data-index', index);
            if (selectedTiles.has(index)) {
                $el.addClass('selected');
            }
            $el.on('click', () => toggleSelect(index));
            $rack.append($el);
        });

        // ... (桌面渲染逻辑不变)
        const $table = $('#table-sets').empty();
        gameState.tableSets.forEach((set, setIndex) => {
             // ...
             const $setDiv = $('<div class="meld-set border-2"></div>');
             $setDiv.attr('data-set-index', setIndex);
             
             if (isValidSet(set)) {
                 $setDiv.addClass('border-green-500 bg-green-500/10');
             } else {
                 $setDiv.addClass('border-red-500 bg-red-500/10');
             }
             
             set.forEach(tile => {
                 const $t = createTileElement(tile);
                 $t.css({ width: '34px', height: '46px', fontSize: '20px', minWidth: '34px' }); 
                 
                 // 高亮逻辑
                 if (gameState.lastMove && gameState.lastMove.includes(tile.id)) {
                    $t.append('<div class="absolute top-0.5 right-0.5 w-2 h-2 bg-red-500 rounded-full border border-white shadow-sm z-10 pointer-events-none"></div>');
                }
                 $setDiv.append($t);
             });
             $table.append($setDiv);
        });
        
        // 破冰状态显示
        // 需要显示所有玩家的破冰状态？
        // 简单起见，只显示我和当前回合玩家的状态
        if (gameState.icebreakerEnabled) {
            const me = gamePlayers[myPlayerIndex];
            const iAmBroken = me ? me.hasBrokenIce : false;
            
            $('#icebreaker-status')
                .removeClass('hidden bg-blue-100 text-blue-600 bg-green-100 text-green-600 border-blue-200 border-green-200')
                .addClass(iAmBroken ? 'bg-green-100 text-green-600 border-green-200' : 'bg-blue-100 text-blue-600 border-blue-200')
                .text(iAmBroken ? '✅ 已破冰' : '❄️ 未破冰');
        }

        // 按钮状态
        const canAct = isMyTurn && !currentPlayer.isBot && !currentPlayer.hasDrawn;
        // ... (其余逻辑)
        const isDrafting = !!gameState.backupState;

        if (isDrafting) {
            $('#btn-reset').removeClass('hidden').prop('disabled', false);
            const allSetsValid = gameState.tableSets.every(set => isValidSet(set));
            const hasChanged = hasStateChanged();
            $('#btn-commit').removeClass('hidden').prop('disabled', !(allSetsValid && hasChanged));
            $('#btn-draw').addClass('hidden');
        } else {
            $('#btn-reset').addClass('hidden');
            $('#btn-commit').addClass('hidden');
            // 如果是我的回合且不是机器人，显示摸牌
            // 如果是机器人回合，隐藏所有操作按钮
            if (isMyTurn && !currentPlayer.isBot) {
                $('#btn-draw').removeClass('hidden').prop('disabled', !canAct);
            } else {
                $('#btn-draw').addClass('hidden');
            }
        }
        
        $('#status-msg').text(`牌堆: ${gameState.pool.length}`);
    }

    function createTileElement(tile) {
        const colorClass = `tile-${tile.color}`;
        const isJoker = tile.value === 'J';
        const display = isJoker ? '☺' : tile.value;
        
        return $(`
            <div class="tile ${colorClass} ${isJoker ? 'tile-joker' : ''}">
                <div>${display}</div>
            </div>
        `);
    }

    // --- 拖拽逻辑 ---

    function getPointerPos(e) {
        const ev = e.originalEvent || e;
        if (ev.touches && ev.touches.length > 0) {
            return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
        }
        if (ev.changedTouches && ev.changedTouches.length > 0) {
            return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    $(document).on('mousedown touchstart', '.tile', function(e) {
        if (!checkIsMyTurn()) return;
        
        // 如果未开始，自动开启回合事务
        // 注意：如果在 startTurn 中更新 UI，可能会替换 DOM 元素，
        // 导致此事件监听器的 'this' 引用断开/失效。
        
        const isFirstAction = !gameState.backupState;
        if (isFirstAction) {
            startTurn(false); // 传入 false 跳过完整 UI 重建
            // 仅更新按钮，不要触碰桌面/牌架以保持 DOM 稳定
            updateButtonsOnly(); 
            
            // 手动添加牌架的视觉激活状态，因为我们跳过了 updateUI
            $('#my-rack').parent().addClass('my-turn-active'); 
            // 实际上类名在 body 上，startTurn 会添加它。
            // 但我们需要确保牌的样式在需要时更新？
            // .my-turn-active .rack-area 样式处理背景。
            // 因为 startTurn 给 body 添加了类，CSS 应该立即生效。
        }

        let $tile = $(this);
        const $parent = $tile.parent();
        
        // 确定来源
        let source = null;
        let sourceIndex = -1; // 手牌索引或牌组索引
        let tileIndex = -1;
        
        if ($parent.attr('id') === 'my-rack') {
            source = 'hand';
            tileIndex = parseInt($tile.attr('data-index'));
        } else if ($parent.hasClass('meld-set')) {
            source = 'table';
            sourceIndex = $parent.data('set-index');
            tileIndex = $parent.find('.tile').index($tile);
        } else {
            return; // 不可拖拽（对手牌或预览）
        }
        
        // 阻止默认文本选择
        if (e.cancelable) e.preventDefault();
        
        const pos = getPointerPos(e);
        
        // 初始化拖拽状态
        draggingTile = {
            source: source,
            sourceIndex: sourceIndex,
            tileIndex: tileIndex,
            data: source === 'hand' ? gameState.myHand[tileIndex] : gameState.tableSets[sourceIndex][tileIndex],
            $el: $tile,
            startX: pos.x,
            startY: pos.y
        };
        
        // 创建幽灵节点
        const $ghost = $tile.clone().addClass('dragging-ghost').appendTo('body');
        
        // 计算 offset 使得幽灵节点居中于鼠标
        const offsetX = $tile.outerWidth() / 2;
        const offsetY = $tile.outerHeight() / 2;

        $ghost.css({
            position: 'fixed', // 使用 fixed 定位以避免滚动问题并提高性能
            left: 0,
            top: 0,
            width: $tile.width(),
            height: $tile.height(),
            zIndex: 1000,
            pointerEvents: 'none',
            opacity: 1.0, 
            transform: `translate3d(${pos.x - offsetX}px, ${pos.y - offsetY}px, 0)`,
            boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
            willChange: 'transform', // 提示浏览器进行 GPU 分层
            transition: 'none' // 防止从左上角“飞入”的动画
        });
        
        // 在 draggingTile 中存储偏移量
        draggingTile.offsetX = offsetX;
        draggingTile.offsetY = offsetY;
        draggingTile.$ghost = $ghost; 
        draggingTile.ghostEl = $ghost[0]; // 缓存原始 DOM 元素以提高性能
        draggingTile.lastHighlighted = null; // 追踪上一个高亮元素
        
        $tile.addClass('opacity-50');
        
        // 绑定移动/松开事件
        $(document).on('mousemove.drag touchmove.drag', onDragMove);
        $(document).on('mouseup.drag touchend.drag', onDragEnd);
    });

    function onDragMove(e) {
        if (!draggingTile) return;
        
        // 1. 通过直接 DOM 访问立即更新位置（零延迟）
        // 绕过 jQuery 开销以获得最大响应速度
        if (e.cancelable) e.preventDefault();
        const pos = getPointerPos(e);

        const x = pos.x - draggingTile.offsetX;
        const y = pos.y - draggingTile.offsetY;
        draggingTile.ghostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        
        // 2. 节流命中测试（仅用于视觉反馈）
        if (!draggingTile.ticking) {
            requestAnimationFrame(() => {
                if (!draggingTile) return;
                
                // 高效命中测试
                const targetEl = document.elementFromPoint(pos.x, pos.y);
                const $target = $(targetEl);
                
                // 查找潜在放置目标
                const $set = $target.closest('.meld-set');
                const $rack = $target.closest('#my-rack');
                
                let currentHighlight = null;
                if ($set.length) currentHighlight = $set[0];
                else if ($rack.length) currentHighlight = $rack[0];
                
                // 仅当高亮目标改变时更新 DOM
                if (currentHighlight !== draggingTile.lastHighlighted) {
                    // 移除旧高亮
                    if (draggingTile.lastHighlighted) {
                        $(draggingTile.lastHighlighted).removeClass('ring-2 ring-yellow-400');
                    }
                    
                    // 添加新高亮
                    if (currentHighlight) {
                        $(currentHighlight).addClass('ring-2 ring-yellow-400');
                    }
                    
                    draggingTile.lastHighlighted = currentHighlight;
                }
                
                draggingTile.ticking = false;
            });
            draggingTile.ticking = true;
        }
    }

    function onDragEnd(e) {
        $(document).off('mousemove.drag mouseup.drag touchmove.drag touchend.drag');
        $('.dragging-ghost').remove();
        if (draggingTile) draggingTile.$el.removeClass('opacity-50');
        
        // 清除高亮
        $('.meld-set, #my-rack').removeClass('ring-2 ring-yellow-400');
        
        if (!draggingTile) return;

        // 双重检查：确保仍然是我的回合
        if (!checkIsMyTurn()) {
            draggingTile = null;
            return;
        }

        // 命中测试（逻辑保持不变，只需确保命中正确）
        // ... (剩余函数)
        // 修复“无法放入牌组”：确保即使悬停在内部牌上也能检测到 .meld-set
        
        const pos = getPointerPos(e);
        const targetEl = document.elementFromPoint(pos.x, pos.y);
        const $target = $(targetEl);
        
        const $rack = $target.closest('#my-rack');
        const $table = $target.closest('#table-area');
        const $set = $target.closest('.meld-set');
        
        let actionTaken = false;


        if ($rack.length) {
            // 放入手牌
            if (draggingTile.source === 'hand') {
                // 重新排序（目前简单追加，或查找索引）
                // 要实现精确重排，我们需要找到牌架中的具体牌索引
                // 对于 V1.5，如果放到牌架上就移到末尾，或者交换？
                // 简单处理：移除并追加（移到末尾）
                // TODO: 插入到特定索引
                const tile = gameState.myHand.splice(draggingTile.tileIndex, 1)[0];
                gameState.myHand.push(tile);
                actionTaken = true;
            } else if (draggingTile.source === 'table') {
                // 桌面 -> 手牌
                // 检查是否允许（仅限本回合出的牌）
                // 我们检查此牌 ID 是否在 backupState.tableSets 中
                const tileId = draggingTile.data.id;
                const wasOnTable = isTileInBackupTable(tileId);
                
                if (wasOnTable) {
                    showToast('不能收回上一回合的牌');
                } else {
                    // 从桌面移除
                    gameState.tableSets[draggingTile.sourceIndex].splice(draggingTile.tileIndex, 1);
                    if (gameState.tableSets[draggingTile.sourceIndex].length === 0) {
                        gameState.tableSets.splice(draggingTile.sourceIndex, 1);
                    }
                    // 添加到手牌
                    gameState.myHand.push(draggingTile.data);
                    actionTaken = true;
                }
            }
        } else if ($set.length) {
            // 放入现有牌组
            const targetSetIndex = $set.data('set-index');
            handleDropOnSet(draggingTile, targetSetIndex);
            actionTaken = true; 
        } else if ($table.length) {
            // 放入新牌组（桌面空白处）
            // 从来源移除
             let tile;
            if (draggingTile.source === 'hand') {
                tile = gameState.myHand.splice(draggingTile.tileIndex, 1)[0];
            } else {
                tile = gameState.tableSets[draggingTile.sourceIndex].splice(draggingTile.tileIndex, 1)[0];
                if (gameState.tableSets[draggingTile.sourceIndex].length === 0) {
                    gameState.tableSets.splice(draggingTile.sourceIndex, 1);
                }
            }
            
            // 创建新牌组
            gameState.tableSets.push([tile]);
            actionTaken = true;
        }

        if (actionTaken) {
            updateUI();
            // syncState(); // 可选：实时同步？可能流量太大。标准做法是回合结束同步。
            
            // 强制更新按钮状态，因为 updateUI 可能不总是彻底检查
            updateButtonsOnly(); 
        }
        
        draggingTile = null;
    }

    function handleDropOnSet(dragInfo, targetIndex) {
        // 特殊处理以避免索引偏移问题
        // 1. 获取牌数据
        const tile = dragInfo.data;
        
        // 2. 如果来源是桌面，且来源索引 == 目标索引 -> 重排（目前忽略或追加）
        if (dragInfo.source === 'table' && dragInfo.sourceIndex === targetIndex) {
            // 同一牌组：什么都不做还是移到末尾？
            // 目前直接返回（无操作）
            return;
        }
        
        // 3. 如果来源是桌面，且来源索引 != 目标索引
        // 或者来源是手牌（处理从手牌拖到现有牌组）
        if (dragInfo.source === 'table') {
            const sourceSet = gameState.tableSets[dragInfo.sourceIndex];
            const targetSet = gameState.tableSets[targetIndex]; // 捕获引用？不，是数组的数组。
            
            // 从来源移除
            sourceSet.splice(dragInfo.tileIndex, 1);
            
            // 添加到目标（正确的目标索引？）
            // 如果我们完全移除来源牌组，索引会偏移。
            if (sourceSet.length === 0) {
                gameState.tableSets.splice(dragInfo.sourceIndex, 1);
                // 如果来源在目标之前，目标索引减小
                if (dragInfo.sourceIndex < targetIndex) {
                    targetIndex--;
                }
            }
            
            gameState.tableSets[targetIndex].push(tile);
        } else if (dragInfo.source === 'hand') {
            // 来源是手牌 - 从手牌移除
            gameState.myHand.splice(dragInfo.tileIndex, 1);
            // 添加到现有牌组
            gameState.tableSets[targetIndex].push(tile);
        }
        
        // 排序目标牌组
        gameState.tableSets[targetIndex] = sortSet(gameState.tableSets[targetIndex]);
    }

    function isTileInBackupTable(id) {
        if (!gameState.backupState) return false;
        for (let set of gameState.backupState.tableSets) {
            for (let tile of set) {
                if (tile.id === id) return true;
            }
        }
        return false;
    }

    function showToast(msg) {
        // 使用非阻塞的 Toast 通知
        const $toast = $(`
            <div class="bg-slate-800/90 text-white px-6 py-3 rounded-full shadow-xl backdrop-blur-sm text-sm font-medium transform transition-all duration-300 translate-y-4 opacity-0">
                ${msg}
            </div>
        `);
        
        $('#toast-container').append($toast);
        
        // 触发进场动画
        requestAnimationFrame(() => {
            $toast.removeClass('translate-y-4 opacity-0');
        });
        
        // 自动消失
        setTimeout(() => {
            $toast.addClass('-translate-y-4 opacity-0');
            setTimeout(() => $toast.remove(), 300);
        }, 2000);
    }

    // --- 交互 ---

    function toggleSelect(index) {
        if (selectedTiles.has(index)) {
            selectedTiles.delete(index);
        } else {
            selectedTiles.add(index);
        }
        updateUI();
    }

    // 手牌排序
    $('#btn-sort-run').click(() => {
        // 按颜色然后数字排序
        gameState.myHand.sort((a, b) => {
            if (a.color !== b.color) return a.color.localeCompare(b.color);
            if (a.value === 'J') return 1;
            if (b.value === 'J') return -1;
            return a.value - b.value;
        });
        selectedTiles.clear();
        updateUI();
    });

    $('#btn-sort-group').click(() => {
        // 按数字然后颜色排序
        gameState.myHand.sort((a, b) => {
            const valA = a.value === 'J' ? 100 : a.value;
            const valB = b.value === 'J' ? 100 : b.value;
            if (valA !== valB) return valA - valB;
            return a.color.localeCompare(b.color);
        });
        selectedTiles.clear();
        updateUI();
    });

    // 动作
    // drawTile 稍后定义
    
    // 绑定事件
    // 注意：drawTile 函数定义在下面，但 JS 函数声明会提升。
    // 但是，如果在 document.ready 中，且 drawTile 是在下面定义的函数声明，则可以访问。
    // 如果是函数表达式（const drawTile = ...）则不行。
    // 当前是 function drawTile() {}，会提升到当前作用域顶部（document.ready 内部）。
    // 但是为了清晰和避免潜在问题，我们把绑定移到函数定义之后。
    
    $('#btn-reset').click(resetTurn);
    $('#btn-commit').click(commitTurn);

    // 保留 play-new 以兼容（如果按钮存在且隐藏），或直接移除
    // 移除旧处理程序

    function drawTile() {
        if (!checkIsMyTurn()) return;
        if (gameState.hasDrawn) return;
        
        if (gameState.pool.length === 0) {
            showToast('牌堆已空，无法摸牌！');
            endTurn(true); // 传入 true 表示 pass
            return;
        }
        
        const tile = gameState.pool.pop();
        gameState.myHand.push(tile);
        
        // 动画效果（可选）
        showToast('摸了一张牌');
        
        gameState.hasDrawn = true;
        endTurn();
    }
    
    // 绑定 draw 事件
    $('#btn-draw').off('click').on('click', drawTile);

    function endTurn(isPass = false) {
        stopTurnTimer();
        $('body').removeClass('my-turn-active');
        
        // 重置状态
        gameState.backupState = null;
        gameState.hasDrawn = false;
        gameState.hasPlayed = false;
        
        // 处理连续 Pass 逻辑
        if (isPass) {
            gameState.consecutivePasses = (gameState.consecutivePasses || 0) + 1;
        } else {
            gameState.consecutivePasses = 0;
        }
        
        // 检查平局（所有人都 Pass）
        if (gameState.consecutivePasses >= gamePlayers.length) {
            // 平局结束
            showEndGame(false, true); // isWin=false, isDraw=true
            if (isHost) broadcast('game-over', { draw: true });
            return;
        }

        // 切换到下一个玩家
        currentTurnIndex = (currentTurnIndex + 1) % gamePlayers.length;
        
        // 清除备份
        selectedTiles.clear();
        
        // 同步状态
        if (isHost) {
             // 广播新回合
             const state = {
                 pool: gameState.pool,
                 players: gamePlayers,
                 tableSets: gameState.tableSets,
                 currentTurnIndex: currentTurnIndex,
                 icebreakerEnabled: gameState.icebreakerEnabled,
                 lastMove: gameState.lastMove
             };
             broadcast('sync', state);
             updateUI();
             
             // 如果是 AI 回合，触发 AI
             if (gamePlayers[currentTurnIndex].isBot) {
                 setTimeout(aiTurn, 1000);
             } else if (checkIsMyTurn()) {
                 startTurnTimer();
             }
        } else {
             syncState();
        }
    }
    
    function syncState() {
        if (isHost) {
             const state = {
                 pool: gameState.pool,
                 players: gamePlayers,
                 tableSets: gameState.tableSets,
                 currentTurnIndex: currentTurnIndex,
                 icebreakerEnabled: gameState.icebreakerEnabled,
                 lastMove: gameState.lastMove
             };
             broadcast('sync', state);
        } else {
             // 客户端发送状态给房主
             // 注意：客户端只能修改自己的手牌和桌面
             // 房主接收后合并
             const state = {
                 pool: gameState.pool,
                 hand: getMyHand(), // 只发送我的手牌
                 tableSets: gameState.tableSets,
                 currentTurnIndex: currentTurnIndex, // 客户端切换了回合？
                 // 客户端应该请求结束回合，而不是直接切换
                 // 但为了兼容，我们发送这个，房主收到后处理
                 lastMove: gameState.lastMove
             };
             if (conn && conn.open) conn.send({ type: 'client-sync', state });
        }
    }

    // --- 计时器与自动操作 ---
    
    function startTurnTimer() {
        stopTurnTimer();
        timeLeft = TURN_TIME_LIMIT;
        $('#timer-count').text(timeLeft);
        $('#turn-timer').removeClass('hidden');
        
        turnTimer = setInterval(() => {
            timeLeft--;
            $('#timer-count').text(timeLeft);
            
            if (timeLeft <= 0) {
                handleTurnTimeout();
            }
        }, 1000);
    }
    
    function stopTurnTimer() {
        if (turnTimer) {
            clearInterval(turnTimer);
            turnTimer = null;
        }
        $('#turn-timer').addClass('hidden');
    }
    
    function handleTurnTimeout() {
        stopTurnTimer();
        showToast('时间到！系统自动托管');
        autoPlayTurn();
    }
    
    function autoPlayTurn() {
        // 取消任何正在进行的拖拽
        if (draggingTile) {
            $('.dragging-ghost').remove();
            draggingTile = null;
            $(document).off('mousemove.drag mouseup.drag');
        }

        // 如果已经有部分操作，先重置以确保从干净状态开始
        if (gameState.backupState) {
            resetTurn();
        }
        
        // 确保是我的回合
        if (!checkIsMyTurn()) return;

        // 时间到不自动出牌，直接摸牌
        if (gameState.pool.length > 0) {
             const tile = gameState.pool.pop();
            gameState.myHand.push(tile);
            gameState.hasDrawn = true;
            showToast('时间到，自动摸牌');
            endTurn();
        } else {
            showToast('时间到，牌堆已空，自动跳过');
            endTurn();
        }
    }

    function playTurnLogic(hand) {
        let madeMove = false;
        let loopLimit = 10;
        let affectedSets = new Set(); 
        let movedTileIds = new Set();

        while (loopLimit-- > 0) {
            let actionThisLoop = false;
            
            // 1. 尝试添加到现有牌组
            for (let i = hand.length - 1; i >= 0; i--) {
                let tile = hand[i];
                let usedTile = false;
                
                for (let s = 0; s < gameState.tableSets.length; s++) {
                    let testSet = [...gameState.tableSets[s], tile];
                    
                    if (isValidSet(testSet)) {
                        gameState.tableSets[s].push(tile);
                        gameState.tableSets[s] = sortSet(gameState.tableSets[s]);
                        
                        hand.splice(i, 1);
                        usedTile = true;
                        actionThisLoop = true;
                        madeMove = true;
                        affectedSets.add(s);
                        movedTileIds.add(tile.id);
                        break; 
                    }
                }
                if (usedTile) continue; 
            }
            
            // 2. 尝试从手牌组成新牌组
            const newSetIndex = tryPlayNewSets(hand, movedTileIds);
            if (newSetIndex !== -1) {
                actionThisLoop = true;
                madeMove = true;
                affectedSets.add(newSetIndex);
            }
            
            if (!actionThisLoop) break;
        }
        return { madeMove, affectedSets, movedTileIds };
    }

    function aiTurn() {
        const bot = gamePlayers[currentTurnIndex];
        if (!bot || !bot.isBot) return;
        
        let aiHand = bot.hand;
        let result;
        
        // AI 破冰逻辑：
        if (gameState.icebreakerEnabled && !bot.hasBrokenIce) {
             // 备份状态
             const backupAIState = {
                 tableSets: JSON.parse(JSON.stringify(gameState.tableSets)),
                 aiHand: JSON.parse(JSON.stringify(aiHand))
             };
             
             let tempMovedIds = new Set();
             let madeMove = false;
             let newPoints = 0;
             let keepTrying = true;
             
             while (keepTrying) {
                 const newIdx = tryPlayNewSets(aiHand, tempMovedIds);
                 if (newIdx !== -1) {
                     madeMove = true;
                     newPoints += calculateSetPoints(gameState.tableSets[newIdx]);
                 } else {
                     keepTrying = false;
                 }
             }
             
             if (madeMove && newPoints >= 30) {
                 // 成功破冰！
                 bot.hasBrokenIce = true;
                 showToast(`${bot.name} 破冰成功 (总分 ${newPoints})`);
                 result = { madeMove: true, movedTileIds: tempMovedIds };
             } else {
                 // 失败，回滚
                 if (madeMove) {
                     gameState.tableSets = backupAIState.tableSets;
                     bot.hand = backupAIState.aiHand; // 恢复手牌
                     aiHand = bot.hand; // 更新引用
                 }
                 result = { madeMove: false, movedTileIds: new Set(), reason: 'icebreaker_fail' };
             }
             
        } else {
            // 正常逻辑
            // playTurnLogic 内部会修改传入的 hand 数组，和 gameState.tableSets
            // 但它返回的是 result 对象
            // 注意：playTurnLogic 中的 hand.splice 会直接修改 aiHand (因为是引用传递)
            // 所以无需重新赋值 bot.hand，除非 playTurnLogic 创建了新数组
            // 检查 playTurnLogic: hand.splice... 是原地修改。
            
            // 为了安全，我们传递 aiHand，它引用 bot.hand
            result = playTurnLogic(aiHand);
        }

        const { madeMove, movedTileIds, reason } = result;

        if (!madeMove) {
            // 摸牌
            if (gameState.pool.length > 0) {
                const t = gameState.pool.pop();
                aiHand.push(t);
                // gameState.oppHandCount++; // 已废弃
                if (reason === 'icebreaker_fail') {
                    showToast(`${bot.name} 未能破冰，摸了一张牌`);
                } else {
                    showToast(`${bot.name} 摸了一张牌`);
                }
                gameState.lastMove = null; 
            } else {
                showToast(`牌堆空了，${bot.name} 跳过回合`);
                gameState.lastMove = null;
                // AI 跳过也算 pass
                // 我们需要在 endTurn 处理 pass 状态
                // 这里调用 endTurn 时传入 true
                endTurn(true);
                return;
            }
        } else {
            // gameState.oppHandCount = aiHand.length; // 已废弃
            gameState.lastMove = Array.from(movedTileIds); 
            showToast(`${bot.name} 打出了牌`);
            
            // 检查是否获胜
            if (aiHand.length === 0) {
                 // AI 赢了
                 // endTurn 会处理吗？endTurn 只是切换回合。
                 // 应该在 endTurn 前检查胜利条件，或者 endTurn 内部检查。
                 // 目前代码是在 handleMessage 'game-over' 处理，或者 checkWin()
                 // 让我们加上 checkWin
                 if (checkWin(bot.id)) return; // 游戏结束
            }
        }
        
        endTurn();
    }
    
    function checkWin(winnerId) {
        // 检查当前玩家手牌是否为空
        // 这里传入 winnerId 只是为了方便
        const p = gamePlayers.find(p => p.id === winnerId);
        if (p && p.hand.length === 0) {
            showEndGame(winnerId === myId); // 如果赢家是我，显示胜利；否则失败
            // 广播
            if (isHost) {
                 broadcast('game-over', { winnerId });
            }
            return true;
        }
        return false;
    }
    
    function tryPlayNewSets(hand, movedTileIds) {
        // 1. 查找刻子 (3+ 张相同数值，不同颜色)
        // 按数值分组
        let valueMap = {};
        hand.forEach(t => {
            if (t.value === 'J') return; // V1 AI 暂不主动使用百搭牌组建新牌组
            if (!valueMap[t.value]) valueMap[t.value] = [];
            valueMap[t.value].push(t);
        });
        
        for (let val in valueMap) {
            let tiles = valueMap[val];
            // 去重颜色
            let uniqueColorTiles = [];
            let seenColors = new Set();
            tiles.forEach(t => {
                if (!seenColors.has(t.color)) {
                    seenColors.add(t.color);
                    uniqueColorTiles.push(t);
                }
            });
            
            if (uniqueColorTiles.length >= 3) {
                // 找到刻子！打出
                let newSet = uniqueColorTiles.slice(0, 4); // 最多4张
                const newIndex = gameState.tableSets.push(newSet) - 1;
                
                // 从手牌移除
                newSet.forEach(playedTile => {
                    const idx = hand.findIndex(t => t.id === playedTile.id);
                    if (idx > -1) hand.splice(idx, 1);
                    if (movedTileIds) movedTileIds.add(playedTile.id);
                });
                
                return newIndex; // 返回新牌组索引
            }
        }
        
        // 2. 查找顺子 (3+ 张同色，连续数值)
        // 按颜色分组
        let colorMap = {};
        hand.forEach(t => {
            if (t.value === 'J') return;
            if (!colorMap[t.color]) colorMap[t.color] = [];
            colorMap[t.color].push(t);
        });
        
        for (let col in colorMap) {
            let tiles = colorMap[col];
            tiles.sort((a, b) => a.value - b.value);
            
            // 寻找连续序列
            if (tiles.length < 3) continue;
            
            let currentRun = [tiles[0]];
            for (let i = 1; i < tiles.length; i++) {
                let diff = tiles[i].value - tiles[i-1].value;
                if (diff === 0) continue; // 重复，忽略
                if (diff === 1) {
                    currentRun.push(tiles[i]);
                } else {
                    // 序列中断
                    if (currentRun.length >= 3) {
                        // 找到顺子，打出
                        const newIndex = gameState.tableSets.push(currentRun) - 1;
                        currentRun.forEach(playedTile => {
                            const idx = hand.findIndex(t => t.id === playedTile.id);
                            if (idx > -1) hand.splice(idx, 1);
                            if (movedTileIds) movedTileIds.add(playedTile.id);
                        });
                        return newIndex;
                    }
                    currentRun = [tiles[i]];
                }
            }
            // 检查最后一个序列
            if (currentRun.length >= 3) {
                const newIndex = gameState.tableSets.push(currentRun) - 1;
                currentRun.forEach(playedTile => {
                    const idx = hand.findIndex(t => t.id === playedTile.id);
                    if (idx > -1) hand.splice(idx, 1);
                    if (movedTileIds) movedTileIds.add(playedTile.id);
                });
                return newIndex;
            }
        }
        
        return -1;
    }

    function syncState() {
        if (!isHost) {
            // 客户端发送同步消息给房主
            send('client-sync', {
                state: {
                    pool: gameState.pool,
                    hand: gameState.myHand,
                    tableSets: gameState.tableSets,
                    lastMove: gameState.lastMove,
                    hasBrokenIce: gameState.hasBrokenIce
                }
            });
        } else {
            // 房主广播同步消息
            // 房主应该在 endTurn 中广播
        }
    }

    // --- 验证逻辑 ---
    function isValidSet(tiles) {
        if (tiles.length < 3) return false;
        
        // 检查刻子（相同数值，不同颜色）
        const isGroup = checkGroup(tiles);
        if (isGroup) return true;
        
        // 检查顺子（相同颜色，连续数值）
        const isRun = checkRun(tiles);
        if (isRun) return true;
        
        return false;
    }

    function getSetInvalidReason(tiles) {
        if (tiles.length < 3) return "牌组至少需要3张牌";
        
        if (isValidSet(tiles)) return null;
        
        const nonJokers = tiles.filter(t => t.value !== 'J');
        if (nonJokers.length === 0) return null; // 纯百搭牌(3+)是合法的
        
        // 统计特征以推断用户意图
        const valCounts = {};
        let maxValCount = 0;
        let dominantVal = null;
        nonJokers.forEach(t => {
            valCounts[t.value] = (valCounts[t.value] || 0) + 1;
            if (valCounts[t.value] > maxValCount) {
                maxValCount = valCounts[t.value];
                dominantVal = t.value;
            }
        });
        
        const colCounts = {};
        let maxColCount = 0;
        let dominantColor = null;
        nonJokers.forEach(t => {
            colCounts[t.color] = (colCounts[t.color] || 0) + 1;
            if (colCounts[t.color] > maxColCount) {
                maxColCount = colCounts[t.color];
                dominantColor = t.color;
            }
        });
        
        // 判定意图：如果大部分是同色，倾向于顺子；如果大部分是同值，倾向于刻子
        const isRunIntent = maxColCount >= nonJokers.length * 0.6; 
        const isGroupIntent = maxValCount >= nonJokers.length * 0.6;
        
        if (isRunIntent) {
             const sameColTiles = nonJokers.filter(t => t.color === dominantColor);
             // 检查重复数字
             const values = sameColTiles.map(t => t.value).sort((a,b)=>a-b);
             for(let i=0; i<values.length-1; i++) {
                 if (values[i] === values[i+1]) return "顺子(相同颜色)不能包含重复数字";
             }
             
             if (nonJokers.some(t => t.color !== dominantColor)) {
                 return "顺子必须是相同颜色";
             }
             
             // 检查跨度
             let jokers = tiles.length - nonJokers.length;
             let needed = 0;
             for(let i=0; i<values.length-1; i++) {
                 needed += (values[i+1] - values[i] - 1);
             }
             if (needed > jokers) return "顺子缺少牌或跨度太大";
             
             return "顺子不符合规则";
        }
        
        if (isGroupIntent) {
              const sameValTiles = nonJokers.filter(t => t.value === dominantVal);
              const colors = new Set(sameValTiles.map(t => t.color));
              
              if (colors.size < sameValTiles.length) {
                  return "刻子(相同数字)不能包含重复颜色";
              }
              if (nonJokers.some(t => t.value !== dominantVal)) {
                  return "刻子必须是相同数字";
              }
              return "刻子不符合规则";
        }
        
        return "不符合规则";
    }

    function calculateSetPoints(tiles) {
        let sum = 0;
        // 简单求和。百搭牌的分数取决于它代表的牌。
        // 在破冰规则中，百搭牌按它所代表的牌的分数计算。
        // 这需要推断百搭牌的值。
        
        // 1. 如果是刻子
        if (checkGroup(tiles)) {
            // 找到非百搭牌的值
            const nonJoker = tiles.find(t => t.value !== 'J');
            const val = nonJoker ? nonJoker.value : 0; // 如果全是百搭牌... 假设30? 规则通常说百搭牌代表的牌。3个百搭牌 = 30+30+30? 还是按上下文？
            // Rummikub 规则：百搭牌按它代表的牌计分。
            // 3个百搭牌组成的刻子：这是不可能的吗？不，可以。可以假设最大化？
            // 简单处理：如果全是百搭牌，每张30分？或者按规则是不允许纯百搭牌刻子的？
            // 假设至少有一张普通牌。
            sum = val * tiles.length;
        } 
        // 2. 如果是顺子
        else if (checkRun(tiles)) {
             // 排序（处理百搭牌比较麻烦，因为 checkRun 已经验证了合法性）
             // 我们需要确定序列的起始值。
             // 找到第一个非百搭牌及其索引
             // tiles 此时可能未排序（虽然 isValidSet 内部排序了，但这里传入的 tiles 是原始顺序吗？
             // 不，tableSets 中的牌组应该是已排序的（我们在操作时调用了 sortSet）
             // 但为了保险，重新排序（注意 sortSet 把 J 放最后，这对计算顺子值不利）
             
             // 让我们尝试推断：
             const nonJokers = tiles.filter(t => t.value !== 'J').sort((a,b) => a.value - b.value);
             if (nonJokers.length === 0) {
                 // 全是百搭牌...
                 sum = 30 * tiles.length; // 这种情况极少
             } else {
                 // 推断序列
                 // 比如 J, 5, 6. J是4.
                 // 比如 5, J, 7. J是6.
                 // 我们需要知道每个位置的值。
                 // 最简单的方法：找到最小的非百搭牌，减去它前面的牌数，得到起始值。
                 // 但这假设 nonJokers[0] 是整个序列（包括前面的百搭牌）中的第几张。
                 // 问题是 sortSet 把 J 放最后了。所以 tiles 的顺序可能是 [5, 6, J]。
                 // 此时 J 是 7.
                 // 或者 [J, 5, 6] -> sortSet -> [5, 6, J].
                 // 我们需要恢复逻辑顺序。
                 
                 // 重新构建逻辑序列
                 // 1. 确定颜色
                 // 2. 填充空缺
                 const minVal = nonJokers[0].value;
                 // 统计 minVal 之前有多少个空缺需要百搭牌填充
                 // 实际上，只要知道序列中有多少张牌，以及已有的数值，就可以算出总和。
                 // 顺子是连续整数。 Sum(start, start+n-1) = n*start + n*(n-1)/2
                 // 我们只需要确定 start。
                 // 假设 minVal 是第 k 张牌（从0开始）。那么 start = minVal - k.
                 // 但是我们不知道 k。因为 minVal 之前可能有 x 张百搭牌。
                 // 我们知道的是：nonJokers 中的牌确定了骨架。
                 // 比如 5, 7. 中间缺 6 (需要1张百搭).
                 // 剩余的百搭牌必须在两头。
                 // 为了分数最大化（破冰有利），通常百搭牌放在大的那边？
                 // 不，规则通常是确定的。但在破冰检查中，为了通过，用户希望分数高。
                 // 但系统必须客观。
                 // 通常百搭牌代表特定牌。
                 // 让我们简化：只计算非百搭牌的分数 + 百搭牌面值(0? 30? 规则是它代表的牌).
                 // 既然我们难以精确推断百搭牌代表什么（因为可能多解），
                 // 我们可以采用 Rummikub 的通用计分规则：
                 // 在游戏结束计分时，百搭牌算30分。
                 // 在破冰（Initial Meld）时，百搭牌算它代表的牌的分数。
                 
                 // 算法：
                 // 1. 确定已知牌的范围。
                 // 2. 剩余百搭牌填补空缺，剩下的放后面（或者前面）。
                 // 实际上，为了通过破冰，用户通常把百搭牌当大牌用。
                 // 我们假设：百搭牌优先填补中间空缺，剩余的加在最大值后面（如果未超13），否则加在前面。
                 
                 let currentVal = nonJokers[0].value;
                 let calculatedSum = 0;
                 let jokers = tiles.length - nonJokers.length;
                 
                 // 计算非百搭牌的和
                 // 同时扣除中间的 gap 所需的 jokers
                 calculatedSum += currentVal;
                 
                 for (let i = 1; i < nonJokers.length; i++) {
                     const nextVal = nonJokers[i].value;
                     calculatedSum += nextVal;
                     const gap = nextVal - currentVal - 1;
                     if (gap > 0) {
                         // 中间缺了 gap 张牌，这些必须由百搭牌填充
                         // 这些牌的值是 currentVal+1, ..., nextVal-1
                         // 等差数列求和
                         const gapSum = (currentVal + 1 + nextVal - 1) * gap / 2;
                         calculatedSum += gapSum;
                         jokers -= gap;
                     }
                     currentVal = nextVal;
                 }
                 
                 // 剩余 jokers
                 // 优先往后加
                 let max = nonJokers[nonJokers.length-1].value;
                 while (jokers > 0 && max < 13) {
                     max++;
                     calculatedSum += max;
                     jokers--;
                 }
                 // 如果还有（说明到了13），往前加
                 let min = nonJokers[0].value;
                 while (jokers > 0 && min > 1) {
                     min--;
                     calculatedSum += min;
                     jokers--;
                 }
                 
                 sum = calculatedSum;
             }
        }
        return sum;
    }

    function checkGroup(tiles) {
        if (tiles.length > 4) return false;
        
        // 提取数值，处理百搭牌
        let values = [];
        let colors = new Set();
        let jokerCount = 0;
        
        tiles.forEach(t => {
            if (t.value === 'J') {
                jokerCount++;
            } else {
                values.push(t.value);
                colors.add(t.color);
            }
        });
        
        // 所有非百搭牌必须有相同数值
        const allSameValue = values.every(v => v === values[0]);
        if (!allSameValue && values.length > 0) return false;
        
        // 颜色必须唯一
        if (colors.size !== values.length) return false;
        
        return true;
    }

    function checkRun(tiles) {
        // 必须是相同颜色
        // 百搭牌可以是任何颜色，但现有的有色牌必须匹配
        const nonJokers = tiles.filter(t => t.value !== 'J');
        if (nonJokers.length === 0) return true; // 全是百搭牌是有效顺子吗（例如3个百搭）？理论上是的
        
        const firstColor = nonJokers[0].color;
        if (!nonJokers.every(t => t.color === firstColor)) return false;
        
        // 排序以检查序列
        // 我们需要插入百搭牌来填充空缺。
        // 策略：排序非百搭牌。检查空缺。使用百搭牌填充。
        nonJokers.sort((a, b) => a.value - b.value);
        
        let jokersAvailable = tiles.length - nonJokers.length;
        
        for (let i = 0; i < nonJokers.length - 1; i++) {
            const diff = nonJokers[i+1].value - nonJokers[i].value;
            if (diff === 0) return false; // 顺子中有重复数字
            if (diff > 1) {
                const gaps = diff - 1;
                if (jokersAvailable >= gaps) {
                    jokersAvailable -= gaps;
                } else {
                    return false;
                }
            }
        }
        
        return true;
    }
    
    function sortSet(tiles) {
        // 辅助函数：为了显示美观而排序牌组
        if (checkGroup(tiles)) {
            // 刻子：按颜色顺序排序？还是保持选择顺序？
            // 为了一致性，按颜色索引排序
            return tiles.sort((a, b) => a.color.localeCompare(b.color));
        } else {
            // 顺子：按数值排序。百搭牌比较棘手。
            // 简单排序：把百搭牌放两头还是尝试适配？
            // 对于 V1，只按数值排序，把 'J' 放最后。
            return tiles.sort((a, b) => {
                if (a.value === 'J') return 1;
                if (b.value === 'J') return 1;
                return a.value - b.value;
            });
        }
    }

    function showEndGame(isWin, isDraw = false) {
        if (isDraw) {
            $('#end-title').text('平局');
            $('#end-msg').text('牌堆已空且无人能出牌，游戏平局。');
            $('#end-icon').text('🤝');
        } else {
            $('#end-title').text(isWin ? '胜利！' : '惜败');
            $('#end-msg').text(isWin ? '恭喜你最先出完手牌！' : '对手先出完了手牌。');
            $('#end-icon').text(isWin ? '🏆' : '🐢');
        }
        $('#end-modal').removeClass('hidden').addClass('flex');
        
        if (isHost) {
            $('#btn-play-again').removeClass('hidden').on('click', () => {
                location.reload(); // 目前简单重载
            });
        }
    }

    // --- 入口点 ---
    $('#btn-ai').on('click', () => { 
        isAIMode = true; 
        isHost = true; // AI 模式下，本地玩家充当房主
        $('#create-room-section').addClass('hidden'); 
        // 显示本地大厅，而不是直接开始
        initPeer(); 
    });
    
    $('#btn-create').on('click', () => { 
        isHost = true; 
        isAIMode = false; // 默认为非AI模式
        $('#create-room-section').addClass('hidden'); 
        $('#room-link-container').removeClass('hidden'); // 联机模式显示链接
        initPeer(); 
    });
    
    $('#btn-add-bot').on('click', () => {
        if (lobbyPlayers.length >= 4) {
            showToast('房间已满');
            return;
        }
        
        isAIMode = true; // 添加了机器人，切换到 AI 模式
        lobbyPlayers.push({ id: 'ai-player-' + Date.now(), name: 'Bot ' + lobbyPlayers.length, isBot: true });
        updateLobbyUI();
        
        // 广播更新
        if (isHost) {
            broadcast('lobby-update', { players: lobbyPlayers });
        }
    });

    $('#btn-start-game').on('click', () => {
        if (lobbyPlayers.length < 2) return;
        $('#lobby').addClass('hidden');
        $('#game-board').removeClass('hidden');
        initGame();
    });

    $('#btn-join').on('click', () => { 
        const id = $('#room-id-input').val().trim();
        if(id) joinRoom(id); 
    });

    function joinRoom(id) {
        isHost = false;
        
        // 界面更新：进入等待状态
        $('#create-room-section').addClass('hidden');
        $('#waiting-section').removeClass('hidden');
        $('#waiting-msg').text('已加入房间，等待房主开始...');
        $('#room-link-container').addClass('hidden'); // 客户端不显示邀请链接
        $('#btn-add-bot').addClass('hidden'); // 客户端不能添加机器人
        $('#btn-start-game').addClass('hidden'); // 客户端不能开始游戏
        
        const savedId = localStorage.getItem('rummi_peer_id');
        peer = new Peer(savedId, PEER_CONFIG);
        
        peer.on('open', (myPeerId) => {
            myId = myPeerId; // 保存自己的 ID
            localStorage.setItem('rummi_peer_id', myPeerId);
            conn = peer.connect(id);
            setupConnection();
        });
        
        peer.on('error', (err) => {
             alert('连接错误: ' + err.type);
             // 恢复大厅
             $('#create-room-section').removeClass('hidden');
             $('#waiting-section').addClass('hidden');
        });
    }
    
    // 复制辅助函数 (兼容非HTTPS环境)
    function copyToClipboard(text, onSuccess, onError) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(onSuccess).catch(onError);
        } else {
            // Fallback
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) onSuccess();
                else onError();
            } catch (err) {
                onError();
            }
        }
    }

    // 复制按钮
    $('#btn-copy').on('click', function() {
        const text = $('#share-url').val();
        const $btn = $(this);
        
        copyToClipboard(text, () => {
            const original = $btn.text();
            $btn.text('已复制').addClass('text-green-500');
            setTimeout(() => $btn.text(original).removeClass('text-green-500'), 2000);
            showToast('链接复制成功');
        }, () => {
            showToast('复制失败，请手动复制');
        });
    });
    
    // 退出
    $('#btn-quit').click(() => {
        if(confirm('确定退出吗？')) {
            // 如果是房主，通知客人
            if (isHost) {
                // 房主需要向所有连接广播，而不是单一的 conn.send
                // 因为 conn 可能只是最近的一个连接，或者是 null（如果没有连接）
                // 房主应该使用 broadcast 函数
                broadcast('host-left', {});
            } else if (conn && conn.open) {
                // 如果是访客，向房主发送退出消息
                // 这里 conn 应该是连接到房主的连接
                conn.send({ type: 'player-left' });
            }
            
            // 重置房间参数并刷新
            const url = new URL(window.location.href);
            url.searchParams.delete('room');
            window.history.replaceState({}, '', url.toString());
            location.reload();
        }
    });
    
    // 如果有房间参数则自动初始化
    const roomParam = new URLSearchParams(window.location.search).get('room');
    if (roomParam) {
        const savedId = localStorage.getItem('rummi_peer_id');
        
        // 1. 如果我是房主（本地ID与房间ID一致），恢复房间状态
        if (savedId && roomParam === savedId) {
            isHost = true;
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden');
            initPeer();
        } 
        // 2. 如果我是访客（无ID或ID不匹配），自动加入
        else {
            $('#room-id-input').val(roomParam);
            joinRoom(roomParam);
        }
    }
});
