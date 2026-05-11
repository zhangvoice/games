$(document).ready(function() {
    // --- 调试配置 ---
    const DEBUG = false; // 调试开关
    function debugLog(...args) {
        if (DEBUG) {
            console.log(`[炸弹猫] [${new Date().toISOString().split('T')[1].split('.')[0]}]`, ...args);
        }
    }

    // --- 常量与配置 ---
    const CARD_TYPES = {
        BOMB: { id: 'bomb', name: '炸弹猫', emoji: '💣🐱', desc: '抽到即爆炸，除非你有拆除卡', color: 'bg-red-500 text-white' },
        DEFUSE: { id: 'defuse', name: '拆除', emoji: '🔧', desc: '抵消炸弹猫，并将炸弹放回牌堆', color: 'bg-green-500 text-white' },
        ATTACK: { id: 'attack', name: '攻击', emoji: '⚔️', desc: '结束回合(不抽牌)，下家需进行2回合', color: 'bg-yellow-500 text-white' },
        SKIP: { id: 'skip', name: '跳过', emoji: '⏭️', desc: '结束回合(不抽牌)', color: 'bg-blue-500 text-white' },
        SHUFFLE: { id: 'shuffle', name: '洗牌', emoji: '🔀', desc: '打乱牌堆', color: 'bg-slate-500 text-white' },
        FUTURE: { id: 'future', name: '预言', emoji: '👁️', desc: '查看牌堆顶3张牌', color: 'bg-purple-500 text-white' },
        FAVOR: { id: 'favor', name: '索要', emoji: '🤲', desc: '指定玩家给你一张牌', color: 'bg-pink-500 text-white' },
        CAT1: { id: 'cat1', name: '塔可猫', emoji: '🌮🐱', desc: '无效果，凑对抽牌', color: 'bg-slate-200 text-slate-800' },
        CAT2: { id: 'cat2', name: '西瓜猫', emoji: '🍉🐱', desc: '无效果，凑对抽牌', color: 'bg-slate-200 text-slate-800' },
        CAT3: { id: 'cat3', name: '土豆猫', emoji: '🥔🐱', desc: '无效果，凑对抽牌', color: 'bg-slate-200 text-slate-800' },
        CAT4: { id: 'cat4', name: '彩虹猫', emoji: '🌈🐱', desc: '无效果，凑对抽牌', color: 'bg-slate-200 text-slate-800' },
        CAT5: { id: 'cat5', name: '胡须猫', emoji: '🧔🐱', desc: '无效果，凑对抽牌', color: 'bg-slate-200 text-slate-800' }
    };

    // --- 状态 ---
    let myId = null;
    let myName = "Player" + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    let myUUID = localStorage.getItem('bombcat_player_uuid');
    if (!myUUID) {
        myUUID = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('bombcat_player_uuid', myUUID);
    }
    let isHost = false;
    let roomId = null;
    let peer = null;
    let connections = {}; // 房主：id -> 连接
    let hostConn = null;  // 客户端：连接
    
    // 游戏状态（同步）
    let gameState = {
        players: [], // { id, name, handCount, isDead, isTurn, turnsLeft }
        deckCount: 0,
        discardPile: [], // 上一张打出的牌
        currentPlayerIdx: 0,
        gameStarted: false,
        winner: null,
        log: []
    };
    
    // 本地状态（保密）
    let myHand = []; // 手牌ID数组
    let futureCards = []; // 用于“预言”功能

    // --- 音频 ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = new AudioContext();

    function playSound(type) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'draw') {
            osc.frequency.setValueAtTime(600, t);
            osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.1);
            osc.start(t);
            osc.stop(t + 0.1);
        } else if (type === 'explode') {
            // 爆炸噪音缓冲区
            const bufferSize = audioCtx.sampleRate * 1; 
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            const noiseFilter = audioCtx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.value = 1000;
            noise.connect(noiseFilter);
            noiseFilter.connect(gain);
            gain.gain.setValueAtTime(0.5, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 1);
            noise.start(t);
        } else if (type === 'win') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, t); // C5
            osc.frequency.setValueAtTime(659.25, t + 0.2); // E5
            osc.frequency.setValueAtTime(783.99, t + 0.4); // G5
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.linearRampToValueAtTime(0, t + 1);
            osc.start(t);
            osc.stop(t + 1);
        }
    }

    // --- 网络 (PeerJS) ---
    function initPeer(callback) {
        // 防止多次初始化
        if (peer) {
            if (peer.destroyed) {
                peer = null; // 已销毁，重新创建
            } else {
                if (peer.disconnected) {
                    debugLog('Peer 已断开，正在重连...');
                    peer.reconnect();
                }

                if (peer.open) {
                    if (callback) callback(peer.id);
                } else {
                    // 仅监听一次 open 事件，避免多次回调
                    const onOpen = (id) => {
                        if (callback) callback(id);
                    };
                    peer.once('open', onOpen);
                }
                return;
            }
        }

        debugLog('正在初始化 PeerJS...');
        // 尝试从 localStorage 获取保存的 ID
        const savedId = localStorage.getItem('bombcat_peer_id');
        // 确保使用全局配置
        const config = window.PEER_CONFIG || PEER_CONFIG;
        peer = new Peer(savedId, config);

        peer.on('open', (id) => {
            myId = id;
            roomId = id; // 如果是房主，roomId 就是 myId
            localStorage.setItem('bombcat_peer_id', id);
            debugLog('我的 Peer ID:', id);
            
            // 如果输入框是空的，预填我的ID（方便测试）
            if ($('#room-id-input').length && !$('#room-id-input').val()) {
                 // $('#room-id-input').val(id); 
            }
            
            if (callback) callback(id);
        });

        peer.on('connection', (conn) => {
            debugLog('收到来自以下节点的连接:', conn.peer);
            
            // 房主端连接管理
            if (isHost) {
                // 如果我们已经与该节点建立了连接，需要小心处理。
                // 我们不会立即关闭它。我们等待新的连接打开。
                // 这可以防止关闭旧连接可能破坏新握手的竞争条件
                // 如果 PeerJS 或浏览器将两者混淆。
                
                if (connections[conn.peer]) {
                    debugLog('来自现有节点的连接请求:', conn.peer);
                    const oldConn = connections[conn.peer];
                    
                    // 移除旧的监听器以防止触发清理
                    oldConn.removeAllListeners('close');
                    
                    // 将旧连接标记为已替换，以便不再使用它
                    oldConn.isReplaced = true; 
                    
                    // 延迟强制关闭旧连接，以便新连接建立
                    setTimeout(() => {
                        if (oldConn.open) {
                            debugLog('关闭过期的连接:', conn.peer);
                            oldConn.close();
                        }
                    }, 5000);
                }
                connections[conn.peer] = conn;
            }

            conn.on('data', (data) => handleData(data, conn));
            conn.on('open', () => {
                debugLog('连接已打开:', conn.peer);
                
                if (isHost) {
                    // 新玩家加入
                    const playerUUID = conn.metadata && conn.metadata.uuid;

                    if (gameState.gameStarted) {
                        // 检查是否通过 UUID 或 ID 重连
                        let existingPlayer = null;
                        
                        if (playerUUID) {
                             existingPlayer = gameState.players.find(p => p.uuid === playerUUID);
                        } 
                        
                        if (!existingPlayer) {
                             // 回退到 ID 检查
                             existingPlayer = gameState.players.find(p => p.id === conn.peer);
                        }

                        if (existingPlayer) {
                            debugLog('玩家重连:', existingPlayer.name, existingPlayer.id, '->', conn.peer);
                            // 连接已在外部作用域更新
                            
                            const oldId = existingPlayer.id;
                            
                            // 更新玩家 ID
                            existingPlayer.id = conn.peer;
                            
                            // 如果 ID 改变，更新手牌映射
                            if (oldId !== conn.peer) {
                                if (allHands[oldId]) {
                                    allHands[conn.peer] = allHands[oldId];
                                    delete allHands[oldId];
                                }
                                // 清理旧连接引用
                                if (connections[oldId]) delete connections[oldId];
                            }
                            
                            // 发送当前游戏状态
                            conn.send({ type: 'GAME_START', state: gameState });
                            
                            // 发送私有手牌
                            if (allHands[conn.peer]) {
                                conn.send({ type: 'PRIVATE_HAND', hand: allHands[conn.peer] });
                            }
                            
                            // 通知其他人
                            gameState.log.push(`玩家 ${existingPlayer.name} 重连成功`);
                            broadcastGameState();
                            return;
                        }

                        debugLog('拒绝连接 (游戏已开始):', conn.peer);
                        conn.send({ type: 'ERROR', msg: 'Game already started' });
                        return;
                    }
                    
                    // 连接已在外部作用域更新
                    // 等待 JOIN 消息以添加玩家并分配名字
                    debugLog('等待来自以下节点的 JOIN:', conn.peer);
                }
            });
            conn.on('close', () => {
                debugLog('连接已关闭:', conn.peer);
                // 处理断开连接
                if (isHost) {
                    // 仅当这是当前连接时才执行清理
                    if (connections[conn.peer] === conn) {
                        delete connections[conn.peer];
                        
                        if (!gameState.gameStarted) {
                             gameState.players = gameState.players.filter(p => p.id !== conn.peer);
                             broadcastLobby();
                        } else {
                            // 游戏已开始，保留玩家状态以便重连
                            debugLog(`玩家 ${conn.peer} 在游戏中途断开连接。`);
                            gameState.log.push(`玩家 ${conn.peer} 断开连接`);
                            broadcastGameState();
                        }
                    } else {
                        debugLog('忽略已废弃连接的关闭事件:', conn.peer);
                    }
                }
            });
        });

        peer.on('error', (err) => {
            console.error(err);
            debugLog('Peer 错误:', err.type, err);
            
            if (err.type === 'unavailable-id') {
                // ID 被占用，清除 storage 并重试
                localStorage.removeItem('bombcat_peer_id');
                peer.destroy();
                peer = null;
                initPeer(callback);
                return;
            }
            
            // 抑制 peer-unavailable 错误提示，因为它已在 connectToHost 重试逻辑中处理
            if (err.type === 'peer-unavailable') {
                return; 
            }
            
            alert('连接错误: ' + err.type);
        });
    }

    function connectToHost(hostId, retryCount = 0) {
        debugLog('正在连接房主:', hostId, '尝试次数:', retryCount + 1);
        roomId = hostId;
        
        // 确保在创建新连接之前正确关闭任何先前的连接
        if (hostConn) {
             debugLog('在重连之前关闭现有的房主连接...');
             hostConn.close();
             hostConn = null;
        }

        // 使用唯一的 connection label 避免重连时的 Negotiation failed
        hostConn = peer.connect(hostId, {
            metadata: { name: myName, uuid: myUUID },
            label: 'conn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            reliable: true
        });
        
        hostConn.on('open', () => {
            debugLog('已连接到房主！正在发送 JOIN 请求...');
            $('#create-room-section').hide();
            $('#waiting-section').removeClass('hidden').show();
            $('#waiting-msg').text('已连接，等待房主开始...');
            
            // 既然连接了，就发送 JOIN 请求
            hostConn.send({ type: 'JOIN', name: myName, uuid: myUUID });
        });
        
        hostConn.on('data', (data) => handleData(data, hostConn));
        
        hostConn.on('close', () => {
            console.log('与房主连接关闭');
            debugLog('与房主的连接已关闭。');
            // 不立即刷新，可能是网络抖动，或者等待重连
            // alert('与房主断开连接');
            location.reload();
        });
        
        hostConn.on('error', (err) => {
             console.error('连接错误:', err);
             // 如果协商失败，尝试延迟重连
             if (String(err).includes('Negotiation of connection') || err.type === 'peer-unavailable' || err.type === 'network') {
                 if (retryCount < 5) {
                     debugLog('协商/连接失败，2秒后重试...');
                     setTimeout(() => {
                         connectToHost(hostId, retryCount + 1);
                     }, 2000);
                 } else {
                     alert("房间不存在或已关闭");
                     // 清除房间参数并刷新以返回大厅
                     const url = new URL(window.location.href);
                     url.searchParams.delete('room');
                     window.history.replaceState({}, document.title, url.toString());
                     location.reload();
                 }
             }
        });
    }

    // 页面关闭/刷新时主动断开连接
    window.addEventListener('beforeunload', () => {
        if (isHost) {
            // 房主离开会销毁房间 ID 以防止僵尸大厅
            localStorage.removeItem('bombcat_peer_id');
        }
        if (peer) {
            peer.destroy();
        }
    });

    function handleData(data, conn) {
        debugLog('收到数据:', data.type, data);
        switch (data.type) {
            case 'JOIN':
                if (isHost) {
                    let displayName = data.name;
                    const playerUUID = data.uuid || (connections[conn.peer].metadata && connections[conn.peer].metadata.uuid);

                    // 检查玩家是否存在 (通过 UUID 或 ID)
                    let existing = null;
                    if (playerUUID) existing = gameState.players.find(p => p.uuid === playerUUID);
                    if (!existing) existing = gameState.players.find(p => p.id === conn.peer);

                    if (!existing) {
                        // 1. 收集当前所有已使用的 "Player XXX" 格式的名字中的数字
                        const usedNumbers = new Set();
                        gameState.players.forEach(p => {
                            const match = p.name.match(/^Player\s+(\d+)$/);
                            if (match) {
                                usedNumbers.add(parseInt(match[1], 10));
                            }
                        });

                        // 2. 找到第一个可用的最小正整数 (从1开始)
                        let newNumber = 1;
                        while (usedNumbers.has(newNumber)) {
                            newNumber++;
                        }

                        // 3. 生成新名字
                        displayName = "Player " + String(newNumber).padStart(3, '0');
                    } else {
                         // 重新加入保持原名
                         displayName = existing.name;
                    }

                    if (connections[conn.peer]) {
                        connections[conn.peer].metadata = { name: displayName, uuid: playerUUID }; 
                    }
                    addPlayerToLobby(conn.peer, displayName, playerUUID);
                    broadcastLobby();
                }
                break;
            case 'LOBBY_UPDATE':
                updateLobbyUI(data.players);
                break;
            case 'GAME_START':
                startGameClient(data);
                break;
            case 'STATE_UPDATE':
                updateGameState(data.state);
                break;
            case 'PRIVATE_HAND':
                updateMyHand(data.hand);
                break;
            case 'SHOW_DRAWN_CARD':
                showDrawAnimation(data.card);
                break;
            case 'SHOW_FUTURE':
                showFutureCards(data.cards);
                break;
            case 'ASK_INSERT_BOMB':
                $('#insert-bomb-modal').removeClass('hidden');
                break;
            case 'GAME_OVER':
                showGameOver(data.winner);
                break;
            case 'GAME_RESET':
                $('#game-over-modal').addClass('hidden');
                // 等待 GAME_START
                break;
            // 房主处理客户端动作
            case 'ACTION_PLAY':
                if (isHost) handlePlayCard(conn.peer, data.cards, data.targetId); // cards 是手牌索引数组
                break;
            case 'ACTION_DRAW':
                if (isHost) handleDrawCard(conn.peer);
                break;
            case 'ACTION_INSERT_BOMB':
                if (isHost) handleInsertBomb(conn.peer, data.position);
                break;
            case 'ACTION_SORT_HAND':
                if (isHost) handleSortHand(conn.peer);
                break;
        }
    }

    // --- 房主逻辑 ---
    let serverDeck = [];

    function addPlayerToLobby(id, name, uuid = null) {
        // 通过 ID 或 UUID 检查以防止重复
        const existing = gameState.players.find(p => p.id === id || (uuid && p.uuid === uuid));
        
        if (!existing) {
            gameState.players.push({ 
                id, 
                name,
                uuid,
                handCount: 0, 
                isDead: false, 
                turnsLeft: 0 
            });
        } else {
            // 如果需要，更新现有玩家 (例如 ID 改变但 UUID 匹配)
            if (existing.id !== id) existing.id = id;
            if (uuid && !existing.uuid) existing.uuid = uuid;
        }
    }

    function broadcastLobby() {
        const lobbyData = { type: 'LOBBY_UPDATE', players: gameState.players };
        Object.values(connections).forEach(c => {
            if (c && c.open) {
                c.send(lobbyData);
            }
        });
        // 更新本地大厅
        updateLobbyUI(gameState.players);
    }

    function broadcastGameState() {
        const stateMsg = { type: 'STATE_UPDATE', state: gameState };
        Object.values(connections).forEach(c => {
            if (c && c.open) {
                c.send(stateMsg);
            }
        });
        updateGameState(gameState);
        
        // 如果有机器人，也更新机器人 (稍后)
        processBotTurn();
    }

    function sendHand(playerId, hand, stolenCard = null) {
        if (playerId === myId) {
            updateMyHand(hand);
            if (stolenCard) {
                showDrawAnimation(stolenCard);
            }
        } else if (connections[playerId] && connections[playerId].open) {
            connections[playerId].send({ type: 'PRIVATE_HAND', hand: hand });
            if (stolenCard) {
                connections[playerId].send({ type: 'SHOW_DRAWN_CARD', card: stolenCard });
            }
        } else if (playerId.startsWith('bot_')) {
            // 机器人手牌存储在 serverDeck/state 中？不，需要单独存储。
            // 为简单起见，我们将所有手牌存储在房主内存中。
        }
    }

    // 房主端的所有手牌存储
    let allHands = {}; // playerId -> [cardId, ...]

    function initGame() {
        debugLog('正在初始化游戏...');
        if (gameState.players.length < 2) {
            alert("至少需要2名玩家!");
            return;
        }

        gameState.gameStarted = true;
        gameState.log = ["游戏开始!"];
        gameState.discardPile = [];
        
        // 根据玩家人数确定牌组数量
        // 2-5: 1 副, 6-9: 2 副, 10-13: 3 副, 14-17: 4 副
        let numDecks = 1;
        const pCount = gameState.players.length;
        if (pCount >= 6) numDecks = 2;
        if (pCount >= 10) numDecks = 3;
        if (pCount >= 14) numDecks = 4;

        debugLog(`开始游戏，玩家人数: ${pCount}，使用 ${numDecks} 副牌。`);

        // 1. 设置牌堆
        let deck = [];
        
        // 添加基础卡牌 (根据牌组数量扩展)
        // 标准牌组 (原版): 56 张牌
        // - 4 张炸弹猫 (单独处理)
        // - 6 张拆除卡 (单独处理)
        // - 5 张 Nope (反转/否定)
        // - 4 张攻击
        // - 4 张跳过
        // - 4 张索要
        // - 4 张洗牌
        // - 5 张预言
        // - 每种猫 4 张 (5 种 * 4 = 20)
        // 基础总数 (非炸弹/拆除) = 46 张。
        
        const basicCards = [
            { type: 'ATTACK', count: 4 },
            { type: 'SKIP', count: 4 },
            { type: 'SHUFFLE', count: 4 },
            { type: 'FUTURE', count: 5 },
            { type: 'FAVOR', count: 4 },
            { type: 'CAT1', count: 4 },
            { type: 'CAT2', count: 4 },
            { type: 'CAT3', count: 4 },
            { type: 'CAT4', count: 4 },
            { type: 'CAT5', count: 4 },
        ];
        
        let totalDefusesInDeck = 6 * numDecks;

        basicCards.forEach(c => {
            const totalCount = c.count * numDecks;
            for(let i=0; i<totalCount; i++) deck.push(CARD_TYPES[c.type].id);
        });
        
        shuffle(deck);

        // 2. 给每个玩家发4张牌
        allHands = {};
        gameState.players.forEach(p => {
            p.isDead = false;
            p.turnsLeft = 0;
            let hand = [];
            for(let i=0; i<4; i++) {
                if(deck.length > 0) hand.push(deck.pop());
            }
            // 给每个玩家加1张拆除卡
            hand.push(CARD_TYPES.DEFUSE.id);
            totalDefusesInDeck--;
            
            shuffle(hand); // 以防万一，洗一下手牌
            allHands[p.id] = hand;
            p.handCount = hand.length;
            sendHand(p.id, allHands[p.id]);
        });

        // 3. 插入炸弹
        const bombCount = gameState.players.length - 1;
        for(let i=0; i<bombCount; i++) {
            deck.push(CARD_TYPES.BOMB.id);
        }

        // 4. 插入剩余的拆除卡
        for(let i=0; i<totalDefusesInDeck; i++) {
            deck.push(CARD_TYPES.DEFUSE.id);
        }

        shuffle(deck);
        serverDeck = deck;
        gameState.deckCount = serverDeck.length;

        // 4. 开始第一回合
        // 房主先手
        gameState.currentPlayerIdx = gameState.players.findIndex(p => p.id === myId);
        if (gameState.currentPlayerIdx === -1) gameState.currentPlayerIdx = 0;
        
        gameState.players[gameState.currentPlayerIdx].turnsLeft = 1;

        // 广播
        Object.values(connections).forEach(c => {
            if (c && c.open) c.send({ type: 'GAME_START', state: gameState });
        });
        startGameClient({ state: gameState }); // 用于房主
        broadcastGameState();
    }

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    // --- 游戏逻辑（房主端） ---
    
    function handlePlayCard(playerId, cardIndices, targetId = null) {
        debugLog(`玩家 ${playerId} 尝试打出索引处的牌:`, cardIndices, `目标: ${targetId}`);
        // 验证回合
        const pIdx = gameState.players.findIndex(p => p.id === playerId);
        if (pIdx !== gameState.currentPlayerIdx) {
            debugLog(`回合验证失败: 当前 ${gameState.currentPlayerIdx}, 请求者 ${pIdx}`);
            return;
        }
        
        const hand = allHands[playerId];
        // 验证卡牌存在
        // 注意：cardIndices 应降序排列以正确移除
        cardIndices.sort((a,b) => b-a);
        
        let playedCards = [];
        cardIndices.forEach(idx => {
            if(idx >= 0 && idx < hand.length) {
                playedCards.push(hand[idx]);
                hand.splice(idx, 1);
            }
        });
        
        if (playedCards.length === 0) {
            debugLog('未打出有效卡牌');
            return;
        }

        debugLog('打出的牌:', playedCards);

        // 检查组合
        // 1. 单张牌（动作）
        // 2. 两张相同的牌（随机窃取）
        // 3. 三张相同的牌（指定牌名窃取 - 目前简化为随机窃取或通用窃取）
        // 5. 五张不同的牌（从弃牌堆取 - 为简单起见未实现）

        let actionType = null;
        
        if (playedCards.length === 1) {
            actionType = playedCards[0];
            // 检查是否是猫卡（单张无效）
            if (actionType.startsWith('cat')) actionType = null;
        } else if (playedCards.length === 2 && playedCards[0] === playedCards[1]) {
            actionType = 'PAIR'; // 随机窃取
        } else if (playedCards.length === 3 && playedCards[0] === playedCards[1] && playedCards[1] === playedCards[2]) {
            actionType = 'TRIPLE'; // 指定窃取（UI中暂简化为随机窃取）
        } // ...

        if (!actionType) {
            // 无效移动，退回卡牌？目前仅忽略或返回。
            // 撤销手牌更改
            // 简化：假设客户端仅发送有效移动。
            // 但我们需要保护。
            // 如果无效，放回。
            allHands[playerId].push(...playedCards);
            sendHand(playerId, allHands[playerId]);
            return; 
        }

        // 应用效果
        gameState.discardPile.push(...playedCards); // 视觉上通常只显示顶部
        gameState.players[pIdx].handCount = hand.length;
        
        let logMsg = `${gameState.players[pIdx].name} 打出了 ${playedCards.map(c => CARD_TYPES[c.toUpperCase()]?.name || c).join(', ')}`;
        gameState.log.push(logMsg);

        switch(actionType) {
            case 'attack':
                // 立即结束回合（不抽牌）
                // 下一位玩家回合数 += 2（如果有1，现在2。如果有更多？通常叠加或覆盖。规则说：“不抽牌。立即结束回合。下一位玩家必须进行2回合。”）
                // 如果受害者打出攻击，他们结束回合，下一位玩家承担 2 + 剩余？通常攻击叠加到 4, 6...
                // 简化：下一位玩家回合数 = 当前剩余回合 + 2 - 1？
                // 标准规则：结束回合。下一位玩家有2回合。
                // 如果我有2回合（被攻击），我打出攻击：结束我的回合。下一位玩家有 2 + （我的剩余 - 1）？
                // 最简单的攻击：将我所有剩余回合 + 2 传递给下一位玩家。
                let remaining = gameState.players[pIdx].turnsLeft - 1; // 消耗1次动作
                gameState.players[pIdx].turnsLeft = 0;
                
                let nextIdx = (pIdx + 1) % gameState.players.length;
                while(gameState.players[nextIdx].isDead) nextIdx = (nextIdx + 1) % gameState.players.length;
                
                gameState.players[nextIdx].turnsLeft = (gameState.players[nextIdx].turnsLeft || 0) + 2 + remaining; 
                gameState.currentPlayerIdx = nextIdx;
                gameState.log.push(`-> ${gameState.players[nextIdx].name} 被攻击! 需要进行 ${gameState.players[nextIdx].turnsLeft} 回合!`);
                break;
                
            case 'skip':
                gameState.players[pIdx].turnsLeft--;
                if (gameState.players[pIdx].turnsLeft <= 0) {
                     advanceTurn();
                }
                break;
                
            case 'shuffle':
                shuffle(serverDeck);
                gameState.log.push("牌堆已洗乱!");
                break;
                
            case 'future':
                let top3 = serverDeck.slice(-3).reverse();
                if (playerId === myId) {
                    showFutureCards(top3);
                } else if (connections[playerId] && connections[playerId].open) {
                    connections[playerId].send({ type: 'SHOW_FUTURE', cards: top3 });
                }
                break;
                
            case 'favor':
                // 如果提供了目标ID且有效，则使用目标ID。否则默认选择下一位存活玩家。
                let targetIdx = -1;
                
                if (targetId) {
                    targetIdx = gameState.players.findIndex(p => p.id === targetId && !p.isDead && p.id !== playerId);
                }
                
                if (targetIdx === -1) {
                     // 默认逻辑：下一位存活玩家
                     targetIdx = (pIdx + 1) % gameState.players.length;
                     while(gameState.players[targetIdx].isDead || gameState.players[targetIdx].id === playerId) {
                         targetIdx = (targetIdx + 1) % gameState.players.length;
                     }
                }
                
                let targetIdActual = gameState.players[targetIdx].id;
                let targetHand = allHands[targetIdActual];
                
                if (targetHand.length > 0) {
                    let stolenIdx = Math.floor(Math.random() * targetHand.length);
                    let stolenCard = targetHand.splice(stolenIdx, 1)[0];
                    allHands[playerId].push(stolenCard);
                    
                    // 发送手牌更新和被抢卡牌通知
                    sendHand(playerId, allHands[playerId], stolenCard);
                    
                    sendHand(targetIdActual, targetHand);
                    gameState.players[targetIdx].handCount = targetHand.length;
                    gameState.players[pIdx].handCount = allHands[playerId].length;
                    gameState.log.push(`${gameState.players[pIdx].name} 从 ${gameState.players[targetIdx].name} 那里抢了一张牌!`);
                }
                break;
            
            case 'PAIR':
            case 'TRIPLE':
                // 从随机其他人那里随机窃取？还是下一位？
                // 简化：从下一位存活玩家那里随机窃取。
                let tIdx = (pIdx + 1) % gameState.players.length;
                while(gameState.players[tIdx].isDead) tIdx = (tIdx + 1) % gameState.players.length;
                let tId = gameState.players[tIdx].id;
                let tHand = allHands[tId];
                if (tHand.length > 0) {
                    let sIdx = Math.floor(Math.random() * tHand.length);
                    let sCard = tHand.splice(sIdx, 1)[0];
                    allHands[playerId].push(sCard);
                    
                    // 发送手牌更新和被抢卡牌通知
                    sendHand(playerId, allHands[playerId], sCard);
                    
                    sendHand(tId, tHand);
                    gameState.players[tIdx].handCount = tHand.length;
                    gameState.players[pIdx].handCount = allHands[playerId].length;
                    gameState.log.push(`${gameState.players[pIdx].name} 使用对子抢了 ${gameState.players[tIdx].name} 一张牌!`);
                }
                break;

            default: // 猫等。
                // 通常应成对处理。如果打出单张猫，无事发生。
                break;
        }

        sendHand(playerId, allHands[playerId]); // 更新发送者
        broadcastGameState();
    }

    function handleDrawCard(playerId) {
        debugLog(`玩家 ${playerId} 正在抽牌...`);
        const pIdx = gameState.players.findIndex(p => p.id === playerId);
        if (pIdx !== gameState.currentPlayerIdx) {
             debugLog('抽牌失败: 不是你的回合');
             return;
        }

        // 必须抽1张牌。
        // 如果牌堆空了（标准游戏中不应发生），结束游戏或重洗弃牌堆？
        if (serverDeck.length === 0) {
            gameState.log.push("牌堆空了! (这种情况不应该发生)");
            debugLog('严重错误: 牌堆为空！');
            return;
        }

        let card = serverDeck.pop();
        gameState.deckCount = serverDeck.length;
        debugLog(`抽到的牌: ${card}`);

        if (card === 'bomb') {
            // 向抽牌的玩家展示动画
            if (playerId === myId) {
                showDrawAnimation('bomb');
            } else if (connections[playerId] && connections[playerId].open) {
                connections[playerId].send({ type: 'SHOW_DRAWN_CARD', card: 'bomb' });
            }

            gameState.log.push(`💣 ${gameState.players[pIdx].name} 抽到了炸弹猫!`);
            // 检查拆除卡
            let hand = allHands[playerId];
            let defuseIdx = hand.indexOf('defuse');
            
            if (defuseIdx !== -1) {
                // 自动使用拆除卡
                hand.splice(defuseIdx, 1);
                gameState.discardPile.push('defuse');
                gameState.players[pIdx].handCount = hand.length;
                sendHand(playerId, hand);
                
                gameState.log.push(`${gameState.players[pIdx].name} 使用了拆除!`);
                playSound('defuse'); // 假设声音存在，否则回退
                
                // 询问玩家将炸弹放在哪里
                if (playerId === myId) {
                    $('#insert-bomb-modal').removeClass('hidden');
                } else if (connections[playerId] && connections[playerId].open) {
                    connections[playerId].send({ type: 'ASK_INSERT_BOMB' });
                } else if (playerId.startsWith('bot_')) {
                    // 机器人插入炸弹逻辑
                    // 智能机器人如果下一位是敌人则放在顶部？
                    // 或者随机以制造混乱。
                    // 让机器人坏一点：50%顶部，50%随机。
                    let choice = Math.random() < 0.5 ? 'top' : 'random';
                    setTimeout(() => handleInsertBomb(playerId, choice), 1000);
                }
                
                // 暂停回合逻辑直到炸弹插入
                return; 
            } else {
                // 死亡
                gameState.players[pIdx].isDead = true;
                gameState.players[pIdx].turnsLeft = 0;
                gameState.log.push(`☠️ ${gameState.players[pIdx].name} 爆炸了!`);
                playSound('explode');

                // 炸弹猫随机放回牌堆
                const insertIndex = Math.floor(Math.random() * (serverDeck.length + 1));
                serverDeck.splice(insertIndex, 0, 'bomb');
                gameState.deckCount = serverDeck.length;
                // gameState.log.push("⚠️ 炸弹猫已随机回到了牌堆中..."); // 也许不用太明显提示？或者提示一下增加紧张感

                checkWinCondition();
                
                // 如果死亡，回合立即结束。
                advanceTurn();
                broadcastGameState();
                return;
            }
        } else {
            allHands[playerId].push(card);
            gameState.players[pIdx].handCount = allHands[playerId].length;
            sendHand(playerId, allHands[playerId]);
            gameState.log.push(`${gameState.players[pIdx].name} 抽了一张牌。`);
            playSound('draw');
        }

        // 减少剩余回合（成功抽牌无炸弹，或在插入中处理了存活）
        // 等等，如果不是炸弹，我们在这里减少。
        if (!gameState.players[pIdx].isDead) {
             gameState.players[pIdx].turnsLeft--;
        }
        
        if (gameState.players[pIdx].turnsLeft <= 0) {
             advanceTurn();
        } else {
            gameState.log.push(`${gameState.players[pIdx].name} 还需要进行 ${gameState.players[pIdx].turnsLeft} 回合。`);
        }

        broadcastGameState();
    }

    function handleSortHand(playerId) {
        if (!allHands[playerId]) return;
        
        allHands[playerId].sort((a, b) => {
            // 将 'defuse' 放在最左边 (或最重要)
            if (a === 'defuse') return -1;
            if (b === 'defuse') return 1;
            // 其它按字母顺序
            return a.localeCompare(b);
        });
        
        sendHand(playerId, allHands[playerId]);
    }

    function handleInsertBomb(playerId, position) {
        debugLog(`玩家 ${playerId} 将炸弹插入在 ${position}`);
        // position: 'top', 'bottom', 'random'
        if (position === 'top') {
            serverDeck.push('bomb');
            gameState.log.push(`${gameState.players.find(p=>p.id===playerId).name} 将炸弹放在了牌堆顶端！`);
        } else if (position === 'bottom') {
            serverDeck.unshift('bomb');
            gameState.log.push(`${gameState.players.find(p=>p.id===playerId).name} 将炸弹放在了牌堆底部。`);
        } else {
            let idx = Math.floor(Math.random() * (serverDeck.length + 1));
            serverDeck.splice(idx, 0, 'bomb');
            gameState.log.push(`${gameState.players.find(p=>p.id===playerId).name} 将炸弹藏进了牌堆随机位置。`);
        }
        
        // 恢复回合逻辑：使用了拆除卡的玩家完成了他们的回合动作（抽牌就是动作）。
        // 所以回合结束。
        let pIdx = gameState.players.findIndex(p => p.id === playerId);
        // 抽一张牌通常消耗1回合。如果他们从炸弹中幸存，回合仍然被消耗？
        // 是的。抽牌即回合结束。
        // 但等等，在我们的逻辑中，handleDrawCard 减少 turnsLeft。
        // 但如果是炸弹，我们提前返回了。
        // 所以我们需要在这里手动减少回合。
        
        gameState.players[pIdx].turnsLeft--;
        
        if (gameState.players[pIdx].turnsLeft <= 0) {
             advanceTurn();
        } else {
            // 如果他们有更多回合（例如被攻击），他们必须继续玩。
             gameState.log.push(`${gameState.players[pIdx].name} 还需要进行 ${gameState.players[pIdx].turnsLeft} 回合。`);
        }
        
        broadcastGameState();
    }

    function advanceTurn() {
        // 查找下一位存活玩家
        let current = gameState.currentPlayerIdx;
        let next = (current + 1) % gameState.players.length;
        let loopCount = 0;
        while(gameState.players[next].isDead && loopCount < gameState.players.length) {
            next = (next + 1) % gameState.players.length;
            loopCount++;
        }
        
        gameState.currentPlayerIdx = next;
        // 如果下一位玩家有堆叠的回合（来自攻击），保留它。
        // 如果为0，重置为1（正常回合）。
        if (gameState.players[next].turnsLeft <= 0) {
            gameState.players[next].turnsLeft = 1;
        }
    }

    function checkWinCondition() {
        let alive = gameState.players.filter(p => !p.isDead);
        if (alive.length === 1) {
            gameState.winner = alive[0].name;
            broadcastGameState();
            // 显示游戏结束
            if (isHost) {
                setTimeout(() => {
                    const msg = { type: 'GAME_OVER', winner: alive[0].name };
                    Object.values(connections).forEach(c => {
                        if (c && c.open) c.send(msg);
                    });
                    showGameOver(alive[0].name);
                }, 1000);
            }
        }
    }

    function processBotTurn() {
        let pIdx = gameState.currentPlayerIdx;
        let p = gameState.players[pIdx];
        if (p.id.startsWith('bot_') && !p.isDead) {
            // 简单机器人逻辑
            setTimeout(() => {
                // 1. 检查是否能赢或自救？机器人不知道顺序。
                // 2. 随机打出动作卡（20%几率）
                let hand = allHands[p.id];
                let actionCards = hand.map((c, i) => ({c, i})).filter(item => ['attack', 'skip', 'future', 'shuffle'].includes(item.c));
                
                if (actionCards.length > 0 && Math.random() < 0.3) {
                    // 打出动作
                    let pick = actionCards[Math.floor(Math.random() * actionCards.length)];
                    handlePlayCard(p.id, [pick.i]);
                } else {
                    // 抽牌
                    handleDrawCard(p.id);
                }
            }, 1500);
        }
    }

    // --- 客户端逻辑 ---

    function startGameClient(data) {
        debugLog('正在启动游戏客户端...', data);
        updateGameState(data.state);
        $('#lobby').hide();
        $('#game-area').removeClass('hidden').addClass('flex');
        // 设置声音？
    }

    function updateGameState(newState) {
        debugLog('收到状态更新', newState);
        gameState = newState;
        
        // 更新日志
        let logHtml = gameState.log.slice(-10).map(l => `<div>${l}</div>`).join('');
        $('#game-log').html(logHtml);
        $('#game-log').scrollTop($('#game-log')[0].scrollHeight);

        // 更新房间信息
        $('#game-room-id').text(roomId);
        $('#deck-count').text(`牌堆: ${gameState.deckCount}`);
        
        // 更新玩家
        let currentP = gameState.players[gameState.currentPlayerIdx];
        if (currentP) {
             let turnMsg = currentP.id === myId ? "你的回合!" : `${currentP.name} 的回合`;
             if (currentP.turnsLeft > 1) turnMsg += ` (剩余 ${currentP.turnsLeft} 次)`;
             $('#current-turn-msg').text(turnMsg);
        }

        renderOpponents();
        renderHand();
    }

    function renderOpponents() {
        $('#opponents-container').empty();
        gameState.players.forEach((p, idx) => {
            if (p.id === myId) return;
            
            let isCurrent = idx === gameState.currentPlayerIdx;
            let statusEmoji = p.isDead ? '💀' : '🙂';
            let cardBack = '🎴'; // Or simple block
            
            // 手牌显示 (牌背)
            let handHtml = '';
            for(let i=0; i<p.handCount; i++) {
                handHtml += `<div class="w-4 h-6 bg-orange-200 border border-orange-400 rounded-sm inline-block -ml-2 first:ml-0"></div>`;
            }

            let html = `
                <div class="relative bg-white p-3 rounded-xl border-2 ${isCurrent ? 'border-orange-500 shadow-lg scale-105' : 'border-slate-200'} ${p.isDead ? 'opacity-50 grayscale' : ''} transition-all w-32 md:w-40">
                    <div class="flex justify-between items-center mb-2">
                        <div class="font-bold truncate text-sm">${p.name}</div>
                        <div>${statusEmoji}</div>
                    </div>
                    <div class="h-10 overflow-hidden whitespace-nowrap pl-2">
                        ${handHtml}
                    </div>
                    <div class="text-xs text-slate-400 mt-1">${p.handCount} 张牌</div>
                </div>
            `;
            $('#opponents-container').append(html);
        });
    }

    function updateMyHand(newHand) {
        // 仅更新手牌，普通牌无动画
        myHand = newHand;
        renderHand();
    }

    function showDrawAnimation(cardId) {
        const card = CARD_TYPES[cardId.toUpperCase()];
        if (!card) return;

        const animEl = $(`
            <div class="draw-anim-container flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-2xl border-4 border-orange-500 w-48 h-64">
                <div class="text-6xl mb-4">${card.emoji}</div>
                <div class="text-xl font-bold text-center text-slate-800">${card.name}</div>
                <div class="text-xs text-center text-slate-500 mt-2">${card.desc}</div>
            </div>
        `);

        $('body').append(animEl);

        // Remove after animation
        setTimeout(() => {
            animEl.remove();
        }, 1500);
    }

    function renderHand() {
        const handContainer = $('#my-hand');
        // 如果不需要保持选择，不要完全重新渲染？
        // 为简单起见，重新渲染但检查选中状态。
        let selectedIndices = [];
        handContainer.find('.card.selected').each(function() {
            selectedIndices.push($(this).data('index'));
        });

        handContainer.empty();
        
        // 为了更好的用户体验对手牌排序？也许以后。
        
        myHand.forEach((cardId, index) => {
            let card = CARD_TYPES[cardId.toUpperCase()];
            if (!card) card = { name: cardId, emoji: '❓', color: 'bg-gray-400' };
            
            let el = $(`
                <div class="card relative flex-shrink-0 w-20 h-28 md:w-32 md:h-48 rounded-lg shadow-md border border-slate-300 p-1 md:p-2 flex flex-col justify-between cursor-pointer ${card.color} group transition-transform duration-200" data-index="${index}" data-id="${cardId}">
                    <div class="flex justify-between items-start">
                        <span class="font-bold text-[10px] md:text-sm leading-none">${card.name}</span>
                        <span class="text-[10px] md:text-base leading-none">${card.emoji}</span>
                    </div>
                    <div class="text-3xl md:text-5xl text-center my-auto">${card.emoji}</div>
                    <div class="text-[8px] md:text-[10px] leading-tight text-center opacity-90 hidden md:block">${card.desc}</div>
                </div>
            `);
            
            el.click(function() {
                $(this).toggleClass('selected');
                updateButtons();
            });
            
            handContainer.append(el);
        });
        
        updateButtons();
        
        // 状态更新
        let me = gameState.players.find(p => p.id === myId);
        if (me) {
            $('#my-status').text(me.isDead ? "已淘汰" : "存活");
            if (me.isDead) $('#my-status').removeClass('bg-green-100 text-green-700').addClass('bg-red-100 text-red-700');
            
            let isMyTurn = (gameState.currentPlayerIdx !== -1 && gameState.players[gameState.currentPlayerIdx].id === myId && !me.isDead);
            $('#btn-play-card').prop('disabled', !isMyTurn);
            $('#btn-draw-card').prop('disabled', !isMyTurn);
            
            if (isMyTurn) {
                $('#my-area').addClass('player-active');
            } else {
                $('#my-area').removeClass('player-active');
            }
        }
    }

    function updateButtons() {
        let selected = $('#my-hand .card.selected');
        let count = selected.length;
        
        // 出牌按钮的基本验证
        let canPlay = false;
        if (count === 1) {
            // 动作卡可以单张打出（通常猫除外，但这里我们简化）
            // 实际上猫需要成对。
            let id = selected.data('id');
            if (!id.startsWith('cat')) canPlay = true; 
        } else if (count === 2) {
            // 对子
            let id1 = $(selected[0]).data('id');
            let id2 = $(selected[1]).data('id');
            if (id1 === id2) canPlay = true;
        } else if (count === 3) {
            // 三张
            let id1 = $(selected[0]).data('id');
            let id2 = $(selected[1]).data('id');
            let id3 = $(selected[2]).data('id');
            if (id1 === id2 && id2 === id3) canPlay = true;
        }
        
        // 覆盖：只有在你的回合才能出牌
        let me = gameState.players.find(p => p.id === myId);
        let isMyTurn = (me && gameState.currentPlayerIdx !== -1 && gameState.players[gameState.currentPlayerIdx].id === myId && !me.isDead);
        
        if (!isMyTurn) canPlay = false;

        if (count > 0 && canPlay) {
            $('#btn-play-card').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
        } else {
            $('#btn-play-card').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
        }
    }

    // --- 交互 ---
    $('#btn-leave').click(() => {
        if (confirm("确定要离开房间吗？")) {
            // 如果是房主，可能需要通知其他人解散房间？
            // 目前简单处理：刷新页面回到初始状态
            localStorage.removeItem('bombcat_peer_id');
            if (peer) {
                peer.destroy();
            }
            // 清除 URL 参数
            const url = new URL(window.location.href);
            url.searchParams.delete('room');
            window.history.replaceState({}, document.title, url.toString());
            
            location.reload();
        }
    });

    $('#btn-create').click(() => {
        debugLog('正在创建房间...');
        isHost = true;
        
        // 禁用按钮以防止多次点击
        const $btn = $('#btn-create');
        $btn.prop('disabled', true).text('创建中...');
        
        initPeer((id) => {
            $btn.prop('disabled', false).text('创建联机房间');
            roomId = id;
            debugLog('房间已创建:', roomId);
            $('#create-room-section').hide();
            $('#waiting-section').removeClass('hidden').show();
            
            // 生成完整分享链接
            const shareUrl = window.location.protocol + '//' + window.location.host + window.location.pathname + '?room=' + roomId;
            $('#share-url').val(shareUrl);
            
            // 启用复制按钮
            $('#btn-copy').prop('disabled', false)
                .removeClass('text-slate-300 cursor-not-allowed')
                .addClass('text-blue-500 hover:text-blue-600 cursor-pointer');
            
            $('#btn-start-game').removeClass('hidden');
            $('#btn-add-bot').removeClass('hidden');
            
            gameState.players = [];
            myName = "Player 001";
            addPlayerToLobby(myId, myName, myUUID);
            updateLobbyUI(gameState.players);
        });
    });

    $('#btn-join').click(() => {
        let inputId = $('#room-id-input').val().trim(); // ID 区分大小写，不要强制大写
        debugLog('正在加入房间:', inputId);
        
        if (!inputId) {
            alert("请输入房间ID");
            return;
        }
        
        isHost = false;
        
        // 禁用按钮防止重复点击
        $('#btn-join').prop('disabled', true).text('连接中...');
        
        initPeer((id) => {
            // 如果我是房主并且加入了自己（例如刷新后恢复），则恢复房主界面
            if (id === inputId) {
                isHost = true;
                $('#create-room-section').hide();
                $('#waiting-section').removeClass('hidden').show();
                $('#share-url').val(window.location.protocol + '//' + window.location.host + window.location.pathname + '?room=' + roomId);
                $('#btn-start-game').removeClass('hidden');
                $('#btn-add-bot').removeClass('hidden');
                myName = "Player 001";
                addPlayerToLobby(myId, myName, myUUID);
                updateLobbyUI(gameState.players);
                $('#btn-join').prop('disabled', false).text('加入房间');
                return;
            }
            
            connectToHost(inputId);
            
            // 简单的超时重置按钮
            setTimeout(() => {
                $('#btn-join').prop('disabled', false).text('加入房间');
            }, 5000);
        });
    });

    $('#btn-start-game').click(() => {
        initGame();
    });

    $('#btn-add-bot').click(() => {
        let botCount = gameState.players.filter(p => p.id.startsWith('bot_')).length;
        let botId = 'bot_' + Date.now();
        addPlayerToLobby(botId, "Bot " + String(botCount + 1).padStart(3, '0'), null);
        broadcastLobby();
    });

    $('#btn-copy').click(() => {
        const url = $('#share-url').val();
        
        // 尝试使用 Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                showCopySuccess();
            }).catch(err => {
                fallbackCopy(url);
            });
        } else {
            fallbackCopy(url);
        }
    });

    function showCopySuccess() {
        const originalText = $('#btn-copy').text();
        $('#btn-copy').text('已复制!');
        setTimeout(() => {
            $('#btn-copy').text('复制');
        }, 2000);
    }

    function fallbackCopy(text) {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            
            // 避免滚动到底部
            textArea.style.top = "0";
            textArea.style.left = "0";
            textArea.style.position = "fixed";
            textArea.style.opacity = "0";
            
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                showCopySuccess();
            } else {
                alert("复制失败，请手动复制");
            }
        } catch (err) {
            alert("复制失败，请手动复制");
        }
    }
    
    // UI 事件处理程序
    $('#btn-play-card').click(() => {
        let selected = [];
        $('#my-hand .card.selected').each(function() {
            selected.push($(this).data('index'));
        });
        
        // 检查是否需要选择目标
        let needTarget = false;
        if (selected.length === 1) {
            let cardId = myHand[selected[0]];
            if (cardId === 'favor') needTarget = true;
        }
        
        if (needTarget) {
            showPlayerSelection((targetId) => {
                sendPlayRequest(selected, targetId);
            });
        } else {
            sendPlayRequest(selected, null);
        }
    });

    function sendPlayRequest(cards, targetId) {
        if (isHost) {
            handlePlayCard(myId, cards, targetId);
        } else {
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'ACTION_PLAY', cards: cards, targetId: targetId });
            } else {
                console.warn('连接未开启');
            }
        }
    }
    
    function showPlayerSelection(callback) {
        $('#player-selection-list').empty();
        // 排除自己和已死亡玩家
        let opponents = gameState.players.filter(p => p.id !== myId && !p.isDead);
        
        if (opponents.length === 0) {
            callback(null);
            return;
        }
        
        opponents.forEach(p => {
            let btn = $(`<button class="w-full p-3 bg-slate-100 hover:bg-slate-200 text-left rounded-xl font-bold border border-slate-200 flex justify-between items-center transition-colors">
                <span>${p.name}</span>
                <span class="text-xs text-slate-500">${p.handCount} 张牌</span>
            </button>`);
            
            btn.click(() => {
                $('#select-player-modal').addClass('hidden');
                callback(p.id);
            });
            
            $('#player-selection-list').append(btn);
        });
        
        $('#select-player-modal').removeClass('hidden');
    }

    $('#btn-draw-card').click(() => {
        if (isHost) {
            handleDrawCard(myId);
        } else {
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'ACTION_DRAW' });
            }
        }
    });

    $('#btn-sort-hand').click(() => {
        if (isHost) {
            handleSortHand(myId);
        } else {
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'ACTION_SORT_HAND' });
            }
        }
    });

    $('#btn-ai').click(() => {
        // 显示本地设置界面
        $('#create-room-section').hide();
        $('#local-setup-section').removeClass('hidden');
        updateLocalSetupUI();
    });

    $('#btn-local-back').click(() => {
        $('#local-setup-section').addClass('hidden');
        $('#create-room-section').show();
    });

    $('#bot-count-slider').on('input', function() {
        requestAnimationFrame(updateLocalSetupUI);
    });

    function updateLocalSetupUI() {
        let bots = parseInt($('#bot-count-slider').val());
        $('#bot-count-display').text(bots);
        
        let total = bots + 1; // + 我自己
        $('#total-players-display').text(total);
        
        let decks = 1;
        if (total >= 6) decks = 2;
        if (total >= 10) decks = 3;
        if (total >= 14) decks = 4;
        
        $('#deck-count-display').text(decks + " 副");
        $('#bomb-count-display').text(total - 1);
    }

    $('#btn-local-start').click(() => {
        let bots = parseInt($('#bot-count-slider').val());
        
        // 初始化本地游戏
        isHost = true;
        myId = 'player_' + Math.floor(Math.random() * 10000);
        roomId = 'LOCAL';
        myName = "Player 001";
        
        $('#local-setup-section').addClass('hidden');
        
        // 直接开始，无需大厅等待
        gameState.players = [];
        addPlayerToLobby(myId, myName, myUUID);
        
        for(let i=0; i<bots; i++) {
             let botId = 'bot_' + Date.now() + '_' + i;
             addPlayerToLobby(botId, "Bot " + String(i+1).padStart(3, '0'), null);
        }
        
        $('#lobby').hide();
        
        // 开始游戏逻辑
        initGame();
    });

    // 辅助函数
    function updateLobbyUI(players) {
        $('#lobby-players').empty();
        players.forEach(p => {
            $('#lobby-players').append(`<li>${p.name}</li>`);
        });
        $('#waiting-msg').text(`当前人数: ${players.length}`);
    }

    function showFutureCards(cards) {
        $('#future-cards').empty();
        cards.forEach(c => {
             let card = CARD_TYPES[c.toUpperCase()];
             $('#future-cards').append(`
                <div class="w-20 h-28 bg-white border border-slate-300 rounded flex items-center justify-center text-2xl shadow-sm">
                    ${card.emoji}
                </div>
             `);
        });
        $('#future-modal').removeClass('hidden');
    }

    function showGameOver(winnerName) {
        $('#winner-name').text(winnerName + " 获胜!");
        $('#game-over-modal').removeClass('hidden');
        playSound('win');
        
        if (isHost) {
            $('#btn-restart').removeClass('hidden').off('click').click(() => {
                // 重置游戏
                initGame();
                $('#game-over-modal').addClass('hidden');
                // 广播重置消息
                Object.values(connections).forEach(c => {
                    if (c && c.open) c.send({ type: 'GAME_RESET' });
                });
            });
        } else {
            $('#btn-restart').addClass('hidden');
        }
    }

    window.playInsertBomb = function(pos) {
        if (isHost) {
            handleInsertBomb(myId, pos);
        } else {
            if (hostConn && hostConn.open) {
                hostConn.send({ type: 'ACTION_INSERT_BOMB', position: pos });
            }
        }
        $('#insert-bomb-modal').addClass('hidden');
    };

    // 自动填充随机名字
    // $('#room-id-input').val('TEST');
    
    // 检查 URL 参数是否有 room ID
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        $('#room-id-input').val(roomParam);
        
        // 自动加入
        $('#btn-join').prop('disabled', true).text('连接中...');
        
        // 需要等待 Peer 初始化完成
        initPeer((id) => {
             connectToHost(roomParam);
             
             setTimeout(() => {
                $('#btn-join').prop('disabled', false).text('加入房间');
            }, 5000);
        });
    } else {
        // 预先初始化 PeerJS 连接
        // initPeer();
    }
});
