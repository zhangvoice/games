
$(document).ready(function() {

    // --- 游戏配置 ---
    const TILES = [
        { id: 0, type: 'start', name: '起点', color: null, price: 0 },
        { id: 1, type: 'property', name: '埃及', color: 'brown', price: 60, rent: [2, 10, 30, 90, 160, 250], housePrice: 50 },
        { id: 2, type: 'property', name: '希腊', color: 'brown', price: 60, rent: [4, 20, 60, 180, 320, 450], housePrice: 50 },
        { id: 3, type: 'chance', name: '机会', color: null, price: 0 },
        { id: 4, type: 'property', name: '土耳其', color: 'cyan', price: 100, rent: [6, 30, 90, 270, 400, 550], housePrice: 50 },
        { id: 5, type: 'property', name: '泰国', color: 'cyan', price: 100, rent: [6, 30, 90, 270, 400, 550], housePrice: 50 },
        { id: 6, type: 'jail', name: '监狱', color: null, price: 0 }, // 只是路过/探监
        { id: 7, type: 'property', name: '阿根廷', color: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], housePrice: 100 },
        { id: 8, type: 'property', name: '墨西哥', color: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], housePrice: 100 },
        { id: 9, type: 'chance', name: '机会', color: null, price: 0 },
        { id: 10, type: 'property', name: '葡萄牙', color: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], housePrice: 100 },
        { id: 11, type: 'property', name: '西班牙', color: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], housePrice: 100 },
        { id: 12, type: 'parking', name: '免费停车', color: null, price: 0 },
        { id: 13, type: 'property', name: '意大利', color: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], housePrice: 150 },
        { id: 14, type: 'property', name: '德国', color: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], housePrice: 150 },
        { id: 15, type: 'wheel', name: '幸运轮盘', color: null, price: 0 },
        { id: 16, type: 'property', name: '法国', color: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], housePrice: 150 },
        { id: 17, type: 'property', name: '英国', color: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], housePrice: 150 },
        { id: 18, type: 'gotojail', name: '入狱', color: null, price: 0 },
        { id: 19, type: 'property', name: '加拿大', color: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], housePrice: 200 },
        { id: 20, type: 'property', name: '澳大利亚', color: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], housePrice: 200 },
        { id: 21, type: 'chance', name: '机会', color: null, price: 0 },
        { id: 22, type: 'property', name: '美国', color: 'blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], housePrice: 200 },
        { id: 23, type: 'property', name: '中国', color: 'blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], housePrice: 200 }
    ];

    const START_MONEY = 1500;
    const SALARY = 200;
    const JAIL_FINE = 50;

    // --- 游戏状态 ---
    let myId = null;
    let myName = "玩家" + Math.floor(Math.random() * 900 + 100);
    let isHost = false;
    let isLocalGame = false;
    let roomId = null;
    
    // 核心状态 (需要同步)
    let players = []; // { id, name, money, pos, color, isBot, isJail, jailTurns, properties: [], isBankrupt, consecutiveDoubles: 0 } 玩家结构
    let properties = {}; // tileId -> { ownerId, level } 地产状态: 地块ID -> { 拥有者ID, 房屋等级 }
    let currentPlayerIdx = 0;
    let gameState = 'LOBBY'; // LOBBY(大厅), PLAYING(进行中), ENDED(结束)
    let gameLog = [];
    let lastDice = null; // null or [d1, d2]

    // 本地状态
    let peer = null;
    let connections = {}; // 房主端: id -> conn
    let hostConn = null; // 客户端: conn
    let isMyTurn = false;
    let isAnimating = false;
    let currentTrade = null; // 当前交易: { fromId, toId, offer: {money, props}, request: {money, props} }
    let auctionState = null; // 拍卖状态: { tileId, currentBid, highestBidderId, timer: null, active: false }

    // --- 调试工具 ---
    const DEBUG = false; // 设置为 true 开启详细日志
    function log(message, ...args) {
        if (DEBUG) {
            console.log(`[Monopoly] ${message}`, ...args);
        }
    }
    function error(message, ...args) {
        console.error(`[Monopoly Error] ${message}`, ...args);
    }

    // --- 音效 ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = new AudioContext();

    function playSound(type) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'roll') {
            osc.frequency.setValueAtTime(400, t);
            osc.frequency.exponentialRampToValueAtTime(800, t + 0.1);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.2);
            osc.start(t);
            osc.stop(t + 0.2);
        } else if (type === 'money') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1000, t);
            osc.frequency.linearRampToValueAtTime(1500, t + 0.1);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
            osc.start(t);
            osc.stop(t + 0.3);
        } else if (type === 'buy') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, t);
            osc.frequency.linearRampToValueAtTime(600, t + 0.1);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.2);
            osc.start(t);
            osc.stop(t + 0.2);
        } else if (type === 'step') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(200, t);
            gain.gain.setValueAtTime(0.05, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
            osc.start(t);
            osc.stop(t + 0.05);
        } else if (type === 'jail') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(100, t);
            osc.frequency.linearRampToValueAtTime(50, t + 0.5);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.5);
            osc.start(t);
            osc.stop(t + 0.5);
        }
    }

    // --- Toast 提示 ---
    function showToast(message, type = 'info') {
        const $container = $('#toast-container');
        const $toast = $(`
            <div class="toast toast-${type}">
                <span>${message}</span>
            </div>
        `);
        
        $container.append($toast);
        
        // 触发重绘
        $toast[0].offsetHeight;
        
        $toast.addClass('show');
        
        setTimeout(() => {
            $toast.removeClass('show');
            setTimeout(() => {
                $toast.remove();
            }, 300);
        }, 3000);
    }

    // --- PeerJS 初始化 ---
    function initPeer(callback) {
        if (peer && !peer.destroyed) {
             if (myId) {
                 if (callback) callback(myId);
             } else {
                 // Peer 已创建但尚未连接，添加监听
                 peer.on('open', (id) => {
                     if (callback) callback(id);
                 });
             }
             return;
        }

        const config = (typeof PEER_CONFIG !== 'undefined') ? PEER_CONFIG : {};
        log('使用配置初始化 PeerJS:', config);
        
        // 尝试从 localStorage 恢复 myId
        let savedId = localStorage.getItem('monopoly_peer_id');
        let peerInstance;

        if (savedId) {
             log('尝试重用 ID:', savedId);
             peerInstance = new Peer(savedId, config);
        } else {
             peerInstance = new Peer(null, config);
        }

        peer = peerInstance;

        peer.on('open', (id) => {
            myId = id;
            localStorage.setItem('monopoly_peer_id', id);
            log('我的 Peer ID 是: ' + id);
            if (callback) callback(id);
        });

        setupPeerEvents(peer, callback);

        peer.on('error', (err) => {
            error('PeerJS 错误:', err);
            
            if (err.type === 'unavailable-id') {
                log('ID 不可用，正在创建新 ID...');
                localStorage.removeItem('monopoly_peer_id');
                // 创建新的 Peer 实例
                peer = new Peer(null, config);
                
                peer.on('open', (id) => {
                    myId = id;
                    localStorage.setItem('monopoly_peer_id', id);
                    if (callback) callback(id);
                });
                
                setupPeerEvents(peer, callback);
            } else {
                showToast("连接服务出错: " + err.type, "error");
            }
        });
    }

    function setupPeerEvents(peerInstance, callback) {
        peerInstance.on('connection', (conn) => {
            if (!isHost) {
                // 如果我们不是房主，拒绝连接。目前假设房主-客户端的星型拓扑。
                conn.close();
                return;
            }
            
            conn.on('open', () => {
                let newPlayerId = conn.peer;
                connections[newPlayerId] = conn;
                
                conn.on('data', (data) => {
                    handleHostData(newPlayerId, data);
                });
                
                conn.on('close', () => {
                    log(`与 ${newPlayerId} 的连接已关闭`);
                    delete connections[newPlayerId];
                });
            });
        });
    }

    // 自动检查 URL 参数 (加入链接)
    const urlParams = new URLSearchParams(window.location.search);
    const joinId = urlParams.get('room') || urlParams.get('join');
    if (joinId) {
        $('#room-id-input').val(joinId);
        // 如果有 joinId，说明是联机模式，自动初始化
        initPeer();
    }

    // 客户端连接房主
    function joinRoom(id) {
        // 确保 Peer 已初始化
        initPeer(() => {
            roomId = id;
            isHost = false;
            hostConn = peer.connect(id);
            
            hostConn.on('open', () => {
                log("已连接到房主");
                $('#lobby').hide();
                $('#waiting-section').show();
                $('#waiting-msg').text("已连接，等待房主开始...");
                
                // 发送名字
                hostConn.send({ type: 'JOIN', name: myName });
            });

            hostConn.on('data', (data) => {
                handleClientData(data);
            });

            hostConn.on('close', () => {
                showToast("与房主断开连接", "error");
                setTimeout(() => location.reload(), 2000);
            });
        });
    }

    // --- 数据处理 ---
    function handleHostData(playerId, data) {
        log(`收到来自 ${playerId} 的数据:`, data.type);
        if (data.type === 'JOIN') {
            // 检查是否已存在 (支持重连)
            const existingPlayer = players.find(p => p.id === playerId);
            if (existingPlayer) {
                 log(`玩家 ${playerId} 已重连。`);
                 // 如果玩家已存在，直接同步当前状态
                 const conn = connections[playerId];
                 if (conn && conn.open) {
                     const state = {
                        players,
                        properties,
                        currentPlayerIdx,
                        gameState,
                        gameLog,
                        lastDice,
                        auctionState
                    };
                    conn.send({ type: 'SYNC', state });
                 }
                 showToast(`${existingPlayer.name} 重新连接`, "success");
                 updateLobbyUI(); 
                 broadcastState(); 
                 return;
            }

            if (gameState !== 'LOBBY') {
                // 游戏已开始，拒绝新加入
                if (connections[playerId]) {
                    connections[playerId].send({ type: 'ERROR', message: '游戏已经开始' });
                    connections[playerId].close();
                }
                return;
            }
            
            // 如果对方没有传名字，使用 Player + 随机数
            const fallbackName = "Player" + Math.floor(Math.random() * 900 + 100);
            players.push({
                id: playerId,
                name: data.name || fallbackName,
                money: START_MONEY,
                pos: 0,
                color: getPlayerColor(players.length),
                isBot: false,
                isJail: false,
                jailTurns: 0,
                properties: [],
                isBankrupt: false,
                consecutiveDoubles: 0
            });
            updateLobbyUI();
            broadcastState();
            
        } else if (data.type === 'ACTION') {
            handleGameAction(playerId, data.action);
        } else if (data.type === 'TRADE_OFFER') {
            handleTradeOffer(playerId, data.offer);
        } else if (data.type === 'TRADE_RESPONSE') {
            handleTradeResponse(playerId, data.response);
        }
    }

    function handleClientData(data) {
        if (data.type === 'SYNC') {
            log('同步游戏状态');
            // 同步整个状态
            players = data.state.players;
            properties = data.state.properties;
            currentPlayerIdx = data.state.currentPlayerIdx;
            gameState = data.state.gameState;
            gameLog = data.state.gameLog;
            lastDice = data.state.lastDice;
            auctionState = data.state.auctionState;

            // 时间同步：使用服务器的剩余时间进行本地动画
            if (auctionState && auctionState.active && typeof auctionState.remaining === 'number') {
                auctionState.localEndTime = Date.now() + auctionState.remaining;
            }

            updateUI();
            
            if (gameState === 'LOBBY') {
                updateLobbyUI();
                $('#lobby').show();
                $('#waiting-section').show(); // 在大厅等待
                $('#create-room-section').hide();
                $('#game-area').addClass('hidden').removeClass('flex'); // 确保隐藏游戏区域
                $('#game-over-modal').addClass('hidden'); // 如果回到大厅，隐藏结束弹窗
            } else if (gameState === 'PLAYING') {
                $('#lobby').hide();
                $('#game-area').removeClass('hidden').addClass('flex');
                $('#game-over-modal').addClass('hidden');
                renderBoard();
            } else if (gameState === 'ENDED') {
                const activePlayers = players.filter(p => !p.isBankrupt);
                if (activePlayers.length > 0) {
                    showGameOver(activePlayers[0].name);
                }
            }
        } else if (data.type === 'TRADE_REQUEST') {
            showTradeRequest(data.trade);
        } else if (data.type === 'TRADE_RESULT') {
            showToast(data.message, data.message.includes('失败') || data.message.includes('拒绝') ? 'error' : 'success');
        }
    }

    function broadcastState() {
        const state = {
            players,
            properties,
            currentPlayerIdx,
            gameState,
            gameLog,
            lastDice,
            auctionState
        };
        
        // 用于时钟同步的房主时间
        const now = Date.now();
        state.serverTime = now;
        if (auctionState && auctionState.active) {
            // 发送剩余时间以避免时钟偏差问题
            state.auctionState.remaining = Math.max(0, auctionState.timer - now);
        }
        
        // 发送给所有连接的客户端
        Object.values(connections).forEach(conn => {
            if (conn.open) conn.send({ type: 'SYNC', state });
        });

        // 本地更新
        updateUI();
    }

    // --- 交易逻辑 ---
    function initTrade() {
        $('#trade-my-props').empty();
        $('#trade-target-props').empty();
        $('#trade-target-player').empty();

        const me = players.find(p => p.id === myId);
        if (!me) return;

        // 填充我的资产
        me.properties.forEach(tid => {
            const tile = TILES[tid];
            const prop = properties[tid];
            const stars = prop.level > 0 ? '★'.repeat(prop.level) : '';
            $('#trade-my-props').append(`
                <label class="flex items-center gap-2 text-xs border p-1 rounded hover:bg-slate-100">
                    <input type="checkbox" value="${tid}" class="trade-my-check">
                    <span class="w-3 h-3 rounded-full bg-${tile.color}"></span>
                    <span>${tile.name} ${stars}</span>
                </label>
            `);
        });

        // 填充可选玩家
        players.forEach(p => {
            if (p.id !== myId && !p.isBankrupt) {
                $('#trade-target-player').append(`<option value="${p.id}">${p.name}</option>`);
            }
        });

        updateTradeTargetProps();
        $('#trade-modal').removeClass('hidden');
    }

    function updateTradeTargetProps() {
        const targetId = $('#trade-target-player').val();
        $('#trade-target-props').empty();
        if (!targetId) return;

        const target = players.find(p => p.id === targetId);
        target.properties.forEach(tid => {
            const tile = TILES[tid];
            const prop = properties[tid];
            const stars = prop.level > 0 ? '★'.repeat(prop.level) : '';
            $('#trade-target-props').append(`
                <label class="flex items-center gap-2 text-xs border p-1 rounded hover:bg-slate-100">
                    <input type="checkbox" value="${tid}" class="trade-target-check">
                    <span class="w-3 h-3 rounded-full bg-${tile.color}"></span>
                    <span>${tile.name} ${stars}</span>
                </label>
            `);
        });
    }

    function sendTradeOffer() {
        const targetId = $('#trade-target-player').val();
        const offerMoney = parseInt($('#trade-offer-money').val()) || 0;
        const requestMoney = parseInt($('#trade-request-money').val()) || 0;
        
        const offerProps = [];
        $('.trade-my-check:checked').each(function() { offerProps.push(parseInt($(this).val())); });
        
        const requestProps = [];
        $('.trade-target-check:checked').each(function() { requestProps.push(parseInt($(this).val())); });

        const tradeData = {
            fromId: myId,
            toId: targetId,
            offer: { money: offerMoney, props: offerProps },
            request: { money: requestMoney, props: requestProps }
        };

        if (isHost) {
            handleTradeOffer(myId, tradeData);
        } else {
            hostConn.send({ type: 'TRADE_OFFER', offer: tradeData });
        }
        
        $('#trade-modal').addClass('hidden');
        showToast("交易请求已发送!", "success");
    }

    // 房主处理交易请求
    function handleTradeOffer(fromId, tradeData) {
        // 验证交易合法性 (钱够不够，地是不是还在)
        const fromPlayer = players.find(p => p.id === fromId);
        const toPlayer = players.find(p => p.id === tradeData.toId);
        
        if (!fromPlayer || !toPlayer) return;
        
        if (fromPlayer.money < tradeData.offer.money) {
             sendTradeResult(fromId, "你的现金不足以支付交易金额");
             return;
        }
        
        // 简单验证地皮归属
        const offerPropsValid = tradeData.offer.props.every(tid => properties[tid]?.ownerId === fromId);
        const requestPropsValid = tradeData.request.props.every(tid => properties[tid]?.ownerId === tradeData.toId);

        if (!offerPropsValid || !requestPropsValid) {
            sendTradeResult(fromId, "交易中的部分资产已不再属于原主");
            return;
        }

        // 如果是机器人，直接处理
        if (toPlayer.isBot) {
            // 智能评估逻辑
            const evaluateTrade = (player, trade) => {
                let gainValue = trade.offer.money;
                let lossValue = trade.request.money;
                
                // 评估获得的新地价值
                trade.offer.props.forEach(tid => {
                    const tile = TILES[tid];
                    let val = tile.price;
                    // 如果能凑成一套，价值提升
                    if (canCompleteSet(player, tile.color, trade.offer.props)) {
                        val *= 2.5; 
                    }
                    gainValue += val;
                });
                
                // 评估失去的地产价值
                trade.request.props.forEach(tid => {
                    const tile = TILES[tid];
                    let val = tile.price;
                    // 如果破坏了自己的一套，或者这块地对我很重要
                    if (checkColorSet(player, tile.color)) {
                        val *= 3; // 破坏套牌代价很高
                    }
                    // 如果失去这块地导致无法凑齐一套
                    if (canCompleteSet(player, tile.color)) {
                         val *= 2;
                    }
                    lossValue += val;
                });
                
                // 基础拒绝率 20%
                if (Math.random() < 0.2) return false;
                
                // 如果获得的价值 > 失去的价值 * 0.9 (稍微亏点也行)，则同意
                return gainValue >= lossValue * 0.9;
            };

            const isAccepted = evaluateTrade(toPlayer, tradeData);
            
            setTimeout(() => {
                const response = {
                    trade: tradeData,
                    accepted: isAccepted
                };
                handleTradeResponse(toPlayer.id, response);
            }, 1500); // 模拟思考时间
            
            return;
        }

        // 转发给目标玩家 (如果是房主自己，直接弹窗)
        if (tradeData.toId === myId) {
            showTradeRequest(tradeData);
        } else {
            const conn = connections[tradeData.toId];
            if (conn) conn.send({ type: 'TRADE_REQUEST', trade: tradeData });
        }
    }

    function sendTradeResult(playerId, message) {
        if (playerId === myId) {
            showToast(message, message.includes('失败') || message.includes('拒绝') ? 'error' : 'success');
        } else {
            const conn = connections[playerId];
            if (conn) conn.send({ type: 'TRADE_RESULT', message });
        }
    }

    // 客户端/房主显示交易请求
    function showTradeRequest(tradeData) {
        currentTrade = tradeData;
        const fromPlayer = players.find(p => p.id === tradeData.fromId);
        $('#trade-req-from').text(`来自 ${fromPlayer.name} 的交易请求`);
        
        // 获得
        let getHtml = '';
        if (tradeData.offer.money > 0) getHtml += `<div>💰 $${tradeData.offer.money}</div>`;
        tradeData.offer.props.forEach(tid => {
            const t = TILES[tid];
            getHtml += `<div>🏠 ${t.name} <span class="w-2 h-2 inline-block rounded-full bg-${t.color}"></span></div>`;
        });
        $('#trade-get-items').html(getHtml || '<span class="text-slate-400">无</span>');

        // 失去
        let giveHtml = '';
        if (tradeData.request.money > 0) giveHtml += `<div>💰 $${tradeData.request.money}</div>`;
        tradeData.request.props.forEach(tid => {
            const t = TILES[tid];
            giveHtml += `<div>🏠 ${t.name} <span class="w-2 h-2 inline-block rounded-full bg-${t.color}"></span></div>`;
        });
        $('#trade-give-items').html(giveHtml || '<span class="text-slate-400">无</span>');

        $('#trade-request-modal').removeClass('hidden');
    }

    function respondToTrade(accepted) {
        $('#trade-request-modal').addClass('hidden');
        if (!currentTrade) return;
        
        const response = {
            trade: currentTrade,
            accepted: accepted
        };

        if (isHost) {
            handleTradeResponse(myId, response);
        } else {
            hostConn.send({ type: 'TRADE_RESPONSE', response });
        }
        currentTrade = null;
    }

    // 房主处理交易响应
    function handleTradeResponse(responderId, response) {
        const trade = response.trade;
        const fromPlayer = players.find(p => p.id === trade.fromId);
        const toPlayer = players.find(p => p.id === trade.toId);
        
        if (!response.accepted) {
            sendTradeResult(trade.fromId, `${toPlayer.name} 拒绝了你的交易请求`);
            return;
        }

        // 执行交易
        executeTrade(trade);
    }

    function executeTrade(trade) {
        const p1 = players.find(p => p.id === trade.fromId);
        const p2 = players.find(p => p.id === trade.toId);
        
        if (!p1 || !p2) return;

        // 再次检查资金
        if (p1.money < trade.offer.money || p2.money < trade.request.money) {
            sendTradeResult(trade.fromId, "交易失败：资金不足");
            sendTradeResult(trade.toId, "交易失败：资金不足");
            return;
        }

        // 转移资金
        p1.money -= trade.offer.money;
        p2.money += trade.offer.money;
        
        p2.money -= trade.request.money;
        p1.money += trade.request.money;

        // 转移地产
        trade.offer.props.forEach(tid => {
            if (properties[tid].ownerId === p1.id) {
                properties[tid].ownerId = p2.id;
                // 更新 players 里的 properties 数组
                p1.properties = p1.properties.filter(id => id !== tid);
                p2.properties.push(tid);
            }
        });

        trade.request.props.forEach(tid => {
            if (properties[tid].ownerId === p2.id) {
                properties[tid].ownerId = p1.id;
                p2.properties = p2.properties.filter(id => id !== tid);
                p1.properties.push(tid);
            }
        });

        gameLog.push(`${p1.name} 与 ${p2.name} 完成了交易`);
        broadcastState();
        sendTradeResult(trade.fromId, "交易成功!");
        sendTradeResult(trade.toId, "交易成功!");
    }

    // --- 游戏逻辑 ---

    function initHostGame() {
        isHost = true;
        // 如果是本地游戏（未初始化 Peer），生成一个本地 ID
        if (!myId) {
            myId = 'host_' + Math.random().toString(36).substr(2, 9);
        }
        roomId = myId;
        players = [{
            id: myId,
            name: myName,
            money: START_MONEY,
            pos: 0,
            color: getPlayerColor(0),
            isBot: false,
            isJail: false,
            jailTurns: 0,
            properties: [],
            isBankrupt: false,
            consecutiveDoubles: 0
        }];
        properties = {};
        updateLobbyUI();
    }

    function addBot() {
        if (players.length >= 4) return showToast("人数已满", "warning");
        let botId = 'bot_' + Date.now();
        players.push({
            id: botId,
            name: "Bot " + players.length,
            money: START_MONEY,
            pos: 0,
            color: getPlayerColor(players.length),
            isBot: true,
            isJail: false,
            jailTurns: 0,
            properties: [],
            isBankrupt: false,
            consecutiveDoubles: 0
        });
        updateLobbyUI();
        broadcastState();
    }

    function startGame() {
        if (players.length < 2) return showToast("至少需要2人", "warning");
        gameState = 'PLAYING';
        currentPlayerIdx = 0;
        gameLog.push("游戏开始！");
        
        $('#lobby').hide();
        $('#game-area').removeClass('hidden').addClass('flex');
        
        renderBoard();
        broadcastState();
        checkBotTurn();
    }

    function handleGameAction(playerId, action) {
        log(`来自 ${playerId} 的游戏动作:`, action);
        
        // 验证拍卖动作 (拍卖动作单独处理)
        if (action.type === 'BID' || action.type === 'PASS_BID') {
            handleAuctionAction(playerId, action);
            return;
        }

        if (players[currentPlayerIdx].id !== playerId) return;
        if (isAnimating) return; // 动画中不接受动作

        const player = players[currentPlayerIdx];

        if (action.type === 'ROLL') {
            performRoll(player);
        } else if (action.type === 'BUY') {
            performBuy(player);
        } else if (action.type === 'UPGRADE') {
            performUpgrade(player, action.tileId);
        } else if (action.type === 'SELL_HOUSE') {
            performSellHouse(player, action.tileId);
        } else if (action.type === 'MORTGAGE') {
            performMortgage(player, action.tileId);
        } else if (action.type === 'UNMORTGAGE') {
            performUnmortgage(player, action.tileId);
        } else if (action.type === 'END') {
             // 检查是否停在无主地产且未购买
             const tile = TILES[player.pos];
             if (tile.type === 'property' && !properties[tile.id] && player.hasRolled) {
                 startAuction(tile.id);
             } else {
                 nextTurn();
             }
        }

        broadcastState();
    }

    // --- 拍卖逻辑 ---
    
    function startAuction(tileId) {
        if (!isHost) return;
        
        const tile = TILES[tileId];
        gameLog.push(`${tile.name} 进入拍卖！起拍价 $10`);
        
        auctionState = {
            tileId: tileId,
            currentBid: 0,
            highestBidderId: null,
            active: true,
            timer: Date.now() + 10000, // 10秒倒计时
            participants: players.filter(p => !p.isBankrupt).map(p => p.id)
        };
        
        broadcastState();
        startAuctionTimer();
    }

    let auctionInterval = null;
    function startAuctionTimer() {
        if (auctionInterval) clearInterval(auctionInterval);
        
        auctionInterval = setInterval(() => {
            if (!auctionState || !auctionState.active) {
                clearInterval(auctionInterval);
                return;
            }
            
            const timeLeft = auctionState.timer - Date.now();
            if (timeLeft <= 0) {
                endAuction();
            } else {
                updateBotAuction();
            }
        }, 500);
    }

    function updateBotAuction() {
        if (!isHost || !auctionState || !auctionState.active) return;
        
        const bots = players.filter(p => p.isBot && auctionState.participants.includes(p.id));
        const tile = TILES[auctionState.tileId];
        
        bots.forEach(bot => {
             // 简单的AI估值
             if (!bot.valuation) {
                 bot.valuation = tile.price * (0.8 + Math.random() * 0.5); // 80%-130%
                 if (checkColorSet(bot, tile.color)) bot.valuation *= 2; 
             }
             
             // 如果已经是最高出价者，跳过
             if (bot.id === auctionState.highestBidderId) return;

             // 30%概率行动
             if (Math.random() > 0.3) return;

             // 决策
             if (auctionState.currentBid + 10 <= bot.valuation && bot.money > auctionState.currentBid + 10) {
                 // 出价
                 handleAuctionAction(bot.id, { type: 'BID', amount: 10 });
             } else {
                 // 放弃
                 handleAuctionAction(bot.id, { type: 'PASS_BID' });
             }
        });
    }

    function handleAuctionAction(playerId, action) {
        if (!auctionState || !auctionState.active) return;
        
        if (action.type === 'BID') {
            const amount = action.amount;
            const player = players.find(p => p.id === playerId);
            
            if (!player || player.money < auctionState.currentBid + amount) {
                // 资金不足
                return; 
            }
            
            // 竞价必须高于当前
            const newBid = auctionState.currentBid + amount;
            
            auctionState.currentBid = newBid;
            auctionState.highestBidderId = playerId;
            auctionState.timer = Date.now() + 10000; // 重置计时器
            
            gameLog.push(`${player.name} 出价 $${newBid}`);
            broadcastState();
            
        } else if (action.type === 'PASS_BID') {
            // 放弃竞价
            auctionState.participants = auctionState.participants.filter(id => id !== playerId);
            gameLog.push(`${players.find(p => p.id === playerId).name} 放弃竞价`);
            
            broadcastState();
        }
    }

    function endAuction() {
        if (auctionInterval) clearInterval(auctionInterval);
        if (!auctionState || !auctionState.active) return;
        
        const winnerId = auctionState.highestBidderId;
        const tile = TILES[auctionState.tileId];
        
        if (winnerId) {
            const winner = players.find(p => p.id === winnerId);
            if (winner && winner.money >= auctionState.currentBid) {
                winner.money -= auctionState.currentBid;
                properties[tile.id] = { ownerId: winner.id, level: 0, isMortgaged: false };
                winner.properties.push(tile.id);
                gameLog.push(`拍卖结束！${winner.name} 以 $${auctionState.currentBid} 拍得了 ${tile.name}`);
                playSound('buy');
            }
        } else {
            gameLog.push(`拍卖流拍，${tile.name} 无人购买。`);
        }
        
        // 清理机器人的估值
        players.forEach(p => delete p.valuation);

        auctionState = null; // 清除拍卖状态
        broadcastState();
        
        // 继续下一回合
        nextTurn();
        broadcastState();
    }

    function performRoll(player) {
        if (player.hasRolled && !player.canRollAgain) return; // 已掷骰且不能重掷
        if (isAnimating) return; // 防止动画中操作

        isAnimating = true;
        playSound('roll');
        
        // 骰子动画效果
        let rollCount = 0;
        const rollAnim = setInterval(() => {
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            $('#dice-result').text(`🎲 ${d1} + ${d2} = ${d1+d2}`);
            rollCount++;
            if (rollCount > 10) {
                clearInterval(rollAnim);
                isAnimating = false;
                
                // 最终结果
                const d1 = Math.floor(Math.random() * 6) + 1;
                const d2 = Math.floor(Math.random() * 6) + 1;
                lastDice = [d1, d2];
                const total = d1 + d2;
                const isDouble = d1 === d2;
                
                gameLog.push(`${player.name} 掷出了 ${d1} + ${d2} = ${total}`);
                
                if (isDouble) {
                    player.consecutiveDoubles++;
                    gameLog.push(`${player.name} 掷出豹子！(连续 ${player.consecutiveDoubles} 次)`);
                } else {
                    player.consecutiveDoubles = 0;
                }

                // 3次豹子进监狱
                if (player.consecutiveDoubles >= 3) {
                    gameLog.push(`${player.name} 连续3次豹子，立即入狱！`);
                    player.consecutiveDoubles = 0;
                    player.isJail = true;
                    player.pos = 6; // 监狱位置
                    player.hasRolled = true;
                    player.canRollAgain = false;
                    broadcastState();
                    // 强制结束回合
                    setTimeout(() => {
                         nextTurn();
                         broadcastState();
                    }, 1500);
                    return;
                }

                // 处理移动逻辑
                finishRoll(player, total, isDouble);
            }
        }, 50);
    }

    function finishRoll(player, diceTotal, isDouble) {
        player.hasRolled = true;
        player.canRollAgain = isDouble && !player.isJail; // 如果是豹子且不在监狱，可以再掷

        if (player.isJail) {
            if (isDouble) {
                player.isJail = false;
                player.jailTurns = 0;
                player.consecutiveDoubles = 0; // 出狱后重置
                player.canRollAgain = false; // 出狱这回合不能再掷（通常规则）
                gameLog.push(`${player.name} 掷出豹子，成功出狱！`);
                startMoveAnimation(player, diceTotal);
            } else {
                player.jailTurns++;
                gameLog.push(`${player.name} 未能出狱 (${player.jailTurns}/3)`);
                if (player.jailTurns >= 3) {
                    player.money -= JAIL_FINE;
                    player.isJail = false;
                    player.jailTurns = 0;
                    gameLog.push(`${player.name} 被迫支付 $${JAIL_FINE} 保释金出狱`);
                    startMoveAnimation(player, diceTotal);
                }
                broadcastState(); // 如果不出狱，状态也要同步
                
                // 机器人未能出狱，直接结束回合
                if (player.isBot && isHost && player.isJail) {
                     setTimeout(() => {
                         nextTurn();
                         broadcastState();
                     }, 1000);
                }
            }
        } else {
            startMoveAnimation(player, diceTotal);
        }
    }
    
    function startMoveAnimation(player, steps) {
        if (steps <= 0) return;
        isAnimating = true;
        let stepCount = 0;
        
        const moveInterval = setInterval(() => {
            let oldPos = player.pos;
            player.pos = (player.pos + 1) % TILES.length;
            
            // 经过起点逻辑
             if (player.pos === 0 && oldPos === TILES.length - 1) {
                player.money += SALARY;
                gameLog.push(`${player.name} 经过起点，获得 $${SALARY}`);
                playSound('money');
            }
            
            playSound('step');
            broadcastState(); // 关键：每一步都广播，让客户端看到移动
            
            stepCount++;
            if (stepCount >= steps) {
                clearInterval(moveInterval);
                isAnimating = false;
                handleTileArrival(player);
                broadcastState();
            }
        }, 300); // 稍微慢一点，让移动看清楚
    }


    function handleTileArrival(player) {
        const tile = TILES[player.pos];
        gameLog.push(`${player.name} 到达了 ${tile.name}`);
        log(`${player.name} arrived at ${tile.name} (ID: ${tile.id}, Type: ${tile.type})`);
        
        // 如果是豹子，且不在监狱，通知玩家可以继续
        if (player.canRollAgain) {
             gameLog.push(`${player.name} 掷出豹子，获得额外回合！`);
             showToast("豹子！请再掷一次骰子", "success");
        }

        if (tile.type === 'property') {
            const prop = properties[tile.id];
            log(`Property info for ${tile.name}:`, prop);
            
            const ownerId = prop?.ownerId;
            if (ownerId) {
                if (ownerId !== player.id) {
                    // 付租金
                    const owner = players.find(p => p.id === ownerId);
                    log(`Property owned by ${ownerId} (${owner ? owner.name : 'Unknown'}). Rent check...`);
                    
                    if (owner && !owner.isBankrupt) {
                        // if (owner.isJail) {
                        //    const msg = `${owner.name} 在监狱中，无法收取租金`;
                        //    gameLog.push(msg);
                        //    showToast(msg, "info");
                        // } else {
                            const rent = getRent(tile, prop.level);
                            log(`Calculating rent: Level ${prop.level}, Amount ${rent}`);
                            
                            player.money -= rent;
                            owner.money += rent;
                            const msg = `${player.name} 向 ${owner.name} 支付租金 $${rent}`;
                            gameLog.push(msg);
                            showToast(msg, "info"); // 弹窗提示
                            checkBankruptcy(player, owner);
                        // }
                    }
                } else {
                    log("玩家拥有此地产。");
                }
            } else {
                // 可购买
                log("此地产无主。");
            }
        } else if (tile.type === 'chance') {
            handleChance(player);
        } else if (tile.type === 'wheel') {
            performWheel(player);
        } else if (tile.type === 'gotojail') {
            player.pos = 6; // 监狱位置
            player.isJail = true;
            gameLog.push(`${player.name} 入狱！`);
        } else if (tile.type === 'jail') {
            gameLog.push(`${player.name} 只是路过监狱`);
        } else if (tile.type === 'parking') {
            gameLog.push(`${player.name} 享受免费停车`);
        } else if (tile.type === 'start') {
            // 已处理
        }

        // 机器人决策触发 (修复竞态条件)
        if (player.isBot && isHost && gameState === 'PLAYING') {
             if (player.isBankrupt) {
                 setTimeout(() => {
                     nextTurn();
                     broadcastState();
                 }, 1000);
                 return;
             }

             // 如果是轮盘导致移动，会在递归调用中处理，这里跳过
             if (tile.type === 'wheel' && player.pos !== tile.id) {
                 return;
             }
             
             setTimeout(() => {
                 handleBotDecision(player);
             }, 1000);
        }
    }

    function getRent(tile, level) {
        if (!tile.rent) return 0;
        
        // 抵押状态无租金
        if (properties[tile.id] && properties[tile.id].isMortgaged) return 0;

        if (Array.isArray(tile.rent)) {
            let r = tile.rent[level];
            // 拥有同色全部地皮且未升级时，租金翻倍
            if (level === 0) {
                const ownerId = properties[tile.id].ownerId;
                const owner = players.find(p => p.id === ownerId);
                if (owner && checkColorSet(owner, tile.color)) {
                    r *= 2;
                }
            }
            return r;
        }
        return tile.rent;
    }

    function checkColorSet(player, color) {
        if (!color) return false;
        const colorTiles = TILES.filter(t => t.color === color);
        return colorTiles.every(t => {
            const prop = properties[t.id];
            return prop && prop.ownerId === player.id;
        });
    }

    function canCompleteSet(player, color, newProps = []) {
        if (!color) return false;
        const colorTiles = TILES.filter(t => t.color === color);
        // 拥有的地 + 交易获得的地
        const owned = player.properties.concat(newProps).map(id => parseInt(id));
        return colorTiles.every(t => owned.includes(t.id));
    }

    function performBuy(player) {
        const tile = TILES[player.pos];
        if (tile.type !== 'property') return;
        if (properties[tile.id]) return; // 已被拥有
        if (player.money < tile.price) return;

        player.money -= tile.price;
        properties[tile.id] = { ownerId: player.id, level: 0, isMortgaged: false };
        player.properties.push(tile.id);
        gameLog.push(`${player.name} 购买了 ${tile.name}`);
        playSound('buy');
    }

    function performUpgrade(player, targetTileId = null) {
        const tileId = targetTileId !== null ? targetTileId : player.pos;
        const tile = TILES[tileId];

        if (tile.type !== 'property') return;
        const prop = properties[tile.id];
        if (!prop || prop.ownerId !== player.id) return;
        
        if (!checkColorSet(player, tile.color)) return;
        if (prop.level >= 5) return;
        if (player.money < tile.housePrice) return;
        if (prop.isMortgaged) {
             showToast("抵押地块无法升级！");
             return;
        }

        // 检查是否有同色地块被抵押
        const colorTiles = TILES.filter(t => t.color === tile.color);
        if (colorTiles.some(t => properties[t.id] && properties[t.id].isMortgaged)) {
            showToast("同色组中有地块被抵押，无法升级！");
            return;
        }

        // 检查均匀建造规则
        // const colorTiles = TILES.filter(t => t.color === tile.color); // 上方已声明
        const colorProps = colorTiles.map(t => properties[t.id]);
        const minLevel = Math.min(...colorProps.map(p => p.level));
        
        if (prop.level > minLevel) {
            showToast("必须均匀建造房屋！请先升级其他同色地皮。");
            return;
        }

        player.money -= tile.housePrice;
        prop.level++;
        gameLog.push(`${player.name} 升级了 ${tile.name} (等级 ${prop.level})`);
        playSound('buy');
    }

    function performSellHouse(player, tileId) {
        const tile = TILES.find(t => t.id === tileId); // 使用 find 以防万一
        if (!tile) return;
        const prop = properties[tileId];
        
        if (!prop || prop.ownerId !== player.id) return;
        if (prop.level <= 0) return;

        // 检查均匀出售规则
        const colorTiles = TILES.filter(t => t.color === tile.color);
        const colorProps = colorTiles.map(t => properties[t.id]);
        const maxLevel = Math.max(...colorProps.map(p => p.level));
        
        if (prop.level < maxLevel) {
            showToast("必须均匀出售房屋！请先出售其他同色地块的房屋。");
            return;
        }

        const sellPrice = Math.floor(tile.housePrice / 2);
        player.money += sellPrice;
        prop.level--;
        
        gameLog.push(`${player.name} 出售了 ${tile.name} 的房屋 (等级 ${prop.level})，获得 $${sellPrice}`);
        playSound('money');
    }

    function performMortgage(player, tileId) {
        const tile = TILES.find(t => t.id === tileId);
        if (!tile) return;
        const prop = properties[tileId];
        
        if (!prop || prop.ownerId !== player.id) return;
        if (prop.isMortgaged) return;
        
        // 检查是否有房屋
        const colorTiles = TILES.filter(t => t.color === tile.color);
        const hasHouses = colorTiles.some(t => properties[t.id] && properties[t.id].level > 0);
        
        if (hasHouses) {
             showToast("同色组中有房屋，无法抵押！请先出售所有房屋。");
             return;
        }

        const mortgageValue = Math.floor(tile.price / 2);
        player.money += mortgageValue;
        prop.isMortgaged = true;
        
        gameLog.push(`${player.name} 抵押了 ${tile.name}，获得 $${mortgageValue}`);
        playSound('money');
    }

    function performUnmortgage(player, tileId) {
        const tile = TILES.find(t => t.id === tileId);
        if (!tile) return;
        const prop = properties[tileId];
        
        if (!prop || prop.ownerId !== player.id) return;
        if (!prop.isMortgaged) return;

        const cost = Math.ceil(tile.price / 2 * 1.1);
        if (player.money < cost) {
            showToast("资金不足，无法赎回！");
            return;
        }

        player.money -= cost;
        prop.isMortgaged = false;
        
        gameLog.push(`${player.name} 赎回了 ${tile.name}，花费 $${cost}`);
        playSound('buy');
    }

    function performWheel(player) {
         const prizes = [
             { text: "获得 $500", val: 500 },
             { text: "失去 $200", val: -200 },
             { text: "获得 $100", val: 100 },
             { text: "前进 3 步", val: 0, move: 3 },
             { text: "后退 3 步", val: 0, move: -3 }
         ];
         const p = prizes[Math.floor(Math.random() * prizes.length)];
         
         gameLog.push(`${player.name} 转动轮盘: ${p.text}`);
         if (p.val !== 0) {
             player.money += p.val;
             if (p.val > 0) playSound('money');
             else playSound('jail');
         }
         if (p.move) {
             let newPos = player.pos + p.move;
             if (newPos < 0) newPos += TILES.length;
             newPos %= TILES.length;
             player.pos = newPos;
             gameLog.push(`${player.name} 移动到了 ${TILES[player.pos].name}`);
             handleTileArrival(player); // 触发新格子的事件
         }
         checkBankruptcy(player);
    }

    function handleChance(player) {
        const events = [
            { text: "捡到钱", val: 50 },
            { text: "缴纳罚款", val: -50 },
            { text: "中彩票", val: 100 },
            { text: "请客吃饭", val: -30 },
            { text: "股市大跌", val: -80 },
            { text: "收到分红", val: 80 }
        ];
        const evt = events[Math.floor(Math.random() * events.length)];
        player.money += evt.val;
        gameLog.push(`${player.name} ${evt.text} ($${evt.val})`);
        
        if (evt.val > 0) playSound('money');
        else playSound('jail'); // 这里的 jail 音效作为负面音效
        
        checkBankruptcy(player);
    }

    function nextTurn() {
        // 如果能再掷，且没破产，且不在监狱(或出狱了但不再掷)，则不切换
        const player = players[currentPlayerIdx];
        
        if (player.canRollAgain && !player.isBankrupt && !player.isJail) {
             // 保持当前玩家，重置 hasRolled
             player.hasRolled = false;
             // 注意：不要重置 consecutiveDoubles
             gameLog.push(`${player.name} 继续回合`);
             checkBotTurn();
             return;
        }
        
        // 正常结束回合，重置状态
        player.hasRolled = false; 
        player.canRollAgain = false;
        player.consecutiveDoubles = 0; // 换人时重置连击
        
        let loopCount = 0;
        do {
            currentPlayerIdx = (currentPlayerIdx + 1) % players.length;
            loopCount++;
        } while (players[currentPlayerIdx].isBankrupt && loopCount < players.length);

        checkBotTurn();
    }

    function checkBankruptcy(player, creditor) {
        if (player.money < 0) {
            player.isBankrupt = true;
            gameLog.push(`${player.name} 破产了！`);
            
            // 资产转交给债权人或银行
            if (creditor) {
                player.properties.forEach(tid => {
                    properties[tid].ownerId = creditor.id;
                    creditor.properties.push(tid);
                });
                creditor.money += (player.money); // 负债转移? 不，通常只能拿到剩余资产。简化：债权人只拿地。
            } else {
                player.properties.forEach(tid => {
                    delete properties[tid]; // 回归银行
                });
            }
            player.properties = [];
        }
        
        checkWinCondition();
    }

    function checkWinCondition() {
        const activePlayers = players.filter(p => !p.isBankrupt);
        if (activePlayers.length === 1) {
            gameState = 'ENDED';
            broadcastState(); // 向所有客户端广播结束状态
            showGameOver(activePlayers[0].name);
        }
    }

    function showGameOver(winnerName) {
        $('#winner-name').text(`${winnerName} 获胜!`);
        $('#game-over-modal').removeClass('hidden');
        if (isHost) {
            $('#btn-restart-game').removeClass('hidden');
        } else {
            $('#btn-restart-game').addClass('hidden');
        }
    }

    function checkBotTurn() {
        if (gameState !== 'PLAYING') return;
        const player = players[currentPlayerIdx];
        if (player.isBot && !player.isBankrupt && isHost) {
            setTimeout(() => {
                // 机器人逻辑
                // 1. Roll (移动完成后触发 handleBotDecision)
                performRoll(player);
                broadcastState();
            }, 1000);
        }
    }

    function handleBotDecision(player) {
        if (gameState !== 'PLAYING' || player.isBankrupt) return;

        // 2. 如果可能则购买/升级
        const tile = TILES[player.pos];
        
        if (tile.type === 'property') {
            const prop = properties[tile.id];
            if (!prop) {
                    // 购买
                    if (player.money >= tile.price + 200) {
                    performBuy(player);
                    broadcastState();
                }
            } else if (prop.ownerId === player.id) {
                // 升级
                if (checkColorSet(player, tile.color) && prop.level < 5 && player.money >= tile.housePrice + 300) {
                    performUpgrade(player);
                    broadcastState();
                }
            }
        }
        
        setTimeout(() => {
            // 3. 结束
            nextTurn();
            broadcastState();
        }, 1000);
    }

    // --- UI 渲染 ---
    function updateLobbyUI() {
        $('#lobby-players').empty();
        players.forEach(p => {
            $('#lobby-players').append(`<li>${p.name} ${p.isHost ? '(房主)' : ''} ${p.isBot ? '🤖' : ''}</li>`);
        });

        if (isHost) {
            if (isLocalGame) {
                $('#waiting-spinner').addClass('hidden');
                $('#waiting-msg').addClass('hidden');
                $('#room-link-container').addClass('hidden');
            } else {
                $('#waiting-spinner').removeClass('hidden');
                $('#waiting-msg').removeClass('hidden').text("等待玩家加入...");
                $('#room-link-container').removeClass('hidden');
                
                const shareUrl = new URL(window.location.href);
                shareUrl.searchParams.set('room', myId);
                $('#share-url').val(shareUrl.toString());
            }
            
            $('#btn-copy').prop('disabled', false);
            $('#btn-start-game').removeClass('hidden');
            $('#btn-add-bot').removeClass('hidden');
            $('#room-id-input').val(myId); // 方便测试
        } else {
            $('#btn-start-game').addClass('hidden');
            $('#btn-add-bot').addClass('hidden');
        }
    }

    let auctionUIInterval = null;

    function updateUI() {
        if (gameState !== 'PLAYING') return;

        // 拍卖 UI 处理
        if (auctionState && auctionState.active) {
            $('#auction-modal').removeClass('hidden');
            const tile = TILES[auctionState.tileId];
            $('#auction-tile-name').text(tile.name);
            $('#auction-tile-price').text(`原价: $${tile.price}`);
            $('#auction-current-bid').text(`$${auctionState.currentBid}`);
            
            let bidderName = '暂无出价';
            if (auctionState.highestBidderId) {
                const bidder = players.find(p => p.id === auctionState.highestBidderId);
                bidderName = bidder ? `最高出价者: ${bidder.name}` : '未知玩家';
            }
            $('#auction-highest-bidder').text(bidderName);
            
            // 如果本地动画循环未运行则启动
            if (!auctionUIInterval) {
                // 立即重置为 100% (如果需要)
                const endTime = auctionState.localEndTime || auctionState.timer;
                const timeLeft = Math.max(0, endTime - Date.now());
                const percent = Math.min(100, (timeLeft / 10000) * 100);
                $('#auction-timer-bar > div').css('width', `${percent}%`);

                auctionUIInterval = setInterval(() => {
                    if (auctionState && auctionState.active) {
                        const endTime = auctionState.localEndTime || auctionState.timer;
                        const timeLeft = Math.max(0, endTime - Date.now());
                        const percent = Math.min(100, (timeLeft / 10000) * 100);
                        $('#auction-timer-bar > div').css('width', `${percent}%`);
                    } else {
                        clearInterval(auctionUIInterval);
                        auctionUIInterval = null;
                    }
                }, 50); // 20fps 保证平滑
            } else {
                // 即使 interval 在运行，当接收到新状态时也强制更新一次 UI 以防止视觉延迟
                const endTime = auctionState.localEndTime || auctionState.timer;
                const timeLeft = Math.max(0, endTime - Date.now());
                const percent = Math.min(100, (timeLeft / 10000) * 100);
                $('#auction-timer-bar > div').css('width', `${percent}%`);
            }
            
            // 更新按钮状态
            const me = players.find(p => p.id === myId);
            
            $('.btn-bid').each(function() {
                const amount = parseInt($(this).data('amount'));
                if (!me || me.money < auctionState.currentBid + amount) {
                    $(this).prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
                } else {
                    $(this).prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
                }
            });

            // 如果我不在 participants 中，全部 disable
            if (!me || !auctionState.participants.includes(me.id)) {
                 $('.btn-bid').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
                 $('#btn-auction-pass').prop('disabled', true).text('已放弃');
            } else {
                 $('#btn-auction-pass').prop('disabled', false).text('放弃竞价');
            }

            // 不返回，让背景更新
        } else {
            $('#auction-modal').addClass('hidden');
            if (auctionUIInterval) {
                clearInterval(auctionUIInterval);
                auctionUIInterval = null;
            }
        }

        // 更新玩家列表
        const $container = $('#players-container');
        $container.empty();
        players.forEach((p, idx) => {
            const isCurrent = idx === currentPlayerIdx;
            const statusClass = p.isBankrupt ? 'opacity-50 grayscale' : '';
            const activeClass = isCurrent ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-white';
            
            $container.append(`
                <div class="p-1 md:p-2 rounded border ${activeClass} ${statusClass} flex justify-between items-center">
                    <div class="flex flex-row md:flex-col items-center md:items-start gap-2 md:gap-0">
                        <div class="text-sm md:text-base font-bold flex items-center gap-1">
                            <span class="w-2 h-2 md:w-3 md:h-3 rounded-full inline-block" style="background:${p.color}"></span>
                            ${p.name}
                        </div>
                        <div class="text-xs md:text-sm text-green-600 font-mono">$${p.money}</div>
                    </div>
                    ${p.isJail ? '<span class="text-sm md:text-xl leading-none ml-1">👮</span>' : ''}
                </div>
            `);
        });

        // 更新控制按钮
        const me = players.find(p => p.id === myId);
        const isMyTurnNow = me && players[currentPlayerIdx].id === myId;
        const currentPos = players[currentPlayerIdx].pos;
        const currentTile = TILES[currentPos];
        
        $('#turn-indicator').html(
            (isMyTurnNow ? "<span class='text-blue-600'>你的回合</span>" : `<span class='text-slate-600'>${players[currentPlayerIdx].name} 的回合</span>`) +
            `<div class="text-sm font-normal text-slate-500 mt-1">📍 当前位置: ${currentTile.name}</div>`
        );
        
        if (isAnimating) {
            $('#btn-roll, #btn-buy, #btn-end, #btn-trade').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
        } else if (isMyTurnNow && !players[currentPlayerIdx].hasRolled) {
            $('#btn-roll').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
            // 如果是再掷状态，更改按钮文字
            if (players[currentPlayerIdx].canRollAgain) {
                $('#btn-roll').html('🎲 再掷一次');
            } else {
                $('#btn-roll').html('🎲 掷骰子');
            }
            $('#btn-buy').prop('disabled', true).addClass('opacity-50 cursor-not-allowed').text('💰 购买');
            $('#btn-end').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
            $('#btn-trade').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
        } else if (isMyTurnNow && players[currentPlayerIdx].hasRolled) {
            $('#btn-roll').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
            
            // 检查购买/升级按钮
            const tile = TILES[players[currentPlayerIdx].pos];
            const prop = properties[tile.id];
            const me = players[currentPlayerIdx];
            
            const canBuy = tile.type === 'property' && !prop && me.money >= tile.price;
            let canUpgrade = false;
            
            if (tile.type === 'property' && prop && prop.ownerId === myId) {
                 if (checkColorSet(me, tile.color) && prop.level < 5 && me.money >= tile.housePrice) {
                     canUpgrade = true;
                 }
            }
            
            const $btnBuy = $('#btn-buy');
            if (canBuy) {
                $btnBuy.html(`💰 购买 ($${tile.price})`).data('action', 'BUY').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
            } else if (canUpgrade) {
                $btnBuy.html(`🏠 升级 ($${tile.housePrice})`).data('action', 'UPGRADE').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
            } else {
                $btnBuy.html(`💰 购买`).data('action', 'BUY').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
            }
            
            // 如果可以再掷，结束按钮应该变为“不可用”或者提示必须再掷？
            // 不，逻辑上只有掷完骰子且不能再掷时才能结束。
            // 但如果处于 canRollAgain 状态，hasRolled 会被重置为 false，所以会进入上面的分支。
            // 这里是 hasRolled = true 的情况，意味着这次掷骰子的移动/事件已处理完毕。
            // 如果 canRollAgain 为 true，我们需要让用户点击“结束回合”来触发 nextTurn 里的逻辑（不切换人，重置 hasRolled）？
            // 或者自动进入下一轮掷骰？通常大富翁是必须掷骰，不能跳过。
            // 修正逻辑：如果 canRollAgain，用户必须再次掷骰子，不能结束回合。
            // 但这里有个问题：performRoll 是动作。finishRoll 设置 hasRolled=true。
            // handleTileArrival 处理事件。
            // UI 更新时，hasRolled=true。
            // 如果 canRollAgain=true，我们需要让用户点击“再掷”。
            // 实际上，如果 canRollAgain，我们应该立即允许再次掷骰子，而不是结束回合。
            // 修改 finishRoll/nextTurn 逻辑：
            // 在 finishRoll 后，如果 canRollAgain，我们应该把 hasRolled 设回 false？
            // 不，那样会立即触发“掷骰子”状态，但是玩家可能想先买地/升级。
            // 所以保持 hasRolled=true，但是 End Turn 按钮点击后，如果 canRollAgain，则不切人，而是重置 hasRolled。
            
            if (players[currentPlayerIdx].canRollAgain) {
                 $('#btn-end').html('🎲 继续回合 (再掷)').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
            } else {
                 $('#btn-end').html('🛑 结束回合').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
            }
            
            $('#btn-trade').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
        } else {
            // 不是我的回合
            $('#btn-roll, #btn-buy, #btn-end, #btn-trade').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
        }

        if (lastDice && Array.isArray(lastDice)) {
            $('#dice-result').text(`🎲 ${lastDice[0]} + ${lastDice[1]} = ${lastDice[0]+lastDice[1]}`);
        } else if (lastDice) {
             $('#dice-result').text(`🎲 ${lastDice}`);
        } else {
            $('#dice-result').text('');
        }

        // 更新日志 (只显示最近5条)
        const recentLogs = gameLog.slice(-5);
        $('#center-message').html(recentLogs.join('<br>'));
        
        // 更新地图上的 Token 和 归属权
        updateBoardTokens();
    }

    function renderBoard() {
        const $board = $('#board');
        // 清除除了 center-area 以外的所有格子
        $board.children().not('.center-area').remove();

        // 生成格子
        TILES.forEach(tile => {
            const pos = getGridPos(tile.id);
            const colorBar = tile.color ? `<div class="color-bar bg-${tile.color}"></div>` : '';
            const ownerMarker = `<div id="owner-${tile.id}" class="owner-marker hidden"></div>`;
            const levelMarker = `<div id="level-${tile.id}" class="level-marker text-xs font-bold text-red-600 absolute top-1 right-1 z-20"></div>`;
            
            // 为每个 tile 添加 id，方便后续操作
            const html = `
                <div id="tile-${tile.id}" class="tile" style="grid-area: ${pos.row} / ${pos.col} / span 1 / span 1" data-id="${tile.id}">
                    <div class="tile-header">${colorBar}</div>
                    <div class="tile-name">${tile.name}</div>
                    ${tile.price ? `<div class="tile-price">$${tile.price}</div>` : ''}
                    ${ownerMarker}
                    ${levelMarker}
                </div>
            `;
            $board.append(html);
        });

        // 绑定点击事件
        $('.tile').on('click', function() {
            const id = $(this).data('id');
            showTileDetails(id);
        });

        // 初始化 Token
        players.forEach((p, idx) => {
            $board.append(`<div id="token-${p.id}" class="player-token token-p${idx}" style="background-color: ${p.color}"></div>`);
        });

        updateBoardTokens();
    }

    function updateBoardTokens() {
        // 移除所有格子的 active 状态
        $('.tile').removeClass('ring-4 ring-yellow-400 z-30 transform scale-105');

        players.forEach(p => {
            if (p.isBankrupt) {
                $(`#token-${p.id}`).hide();
                return;
            }
            const pos = getGridPos(p.pos);
            const $token = $(`#token-${p.id}`);
            
            // 使用 CSS Grid 定位，并设置 pointer-events 避免阻挡鼠标
            $token.css({
                'grid-area': `${pos.row} / ${pos.col} / span 1 / span 1`,
                'pointer-events': 'none'
            });
        });

        // 更新归属权标记
        Object.keys(properties).forEach(tileId => {
            const prop = properties[tileId];
            const owner = players.find(p => p.id === prop.ownerId);
            if (owner) {
                const $marker = $(`#owner-${tileId}`);
                $marker.css('background-color', owner.color).removeClass('hidden');
                
                // 显示等级
                const $level = $(`#level-${tileId}`);
                
                if (prop.isMortgaged) {
                    $level.text('💸'); // 抵押标志
                    $marker.css('opacity', '0.5'); // 变暗
                } else if (prop.level > 0) {
                    let stars = '★'.repeat(prop.level);
                    if (prop.level === 5) stars = '🏨';
                    $level.text(stars);
                    $marker.css('opacity', '1');
                } else {
                    $level.text('');
                    $marker.css('opacity', '1');
                }
            }
        });
    }

    // 将 0-23 映射到 7x7 Grid 坐标
    function getGridPos(index) {
        // 0: 右下 (7, 7)
        if (index === 0) return { row: 7, col: 7 };
        // 1-5: 底部 (7, 6 -> 7, 2)
        if (index >= 1 && index <= 5) return { row: 7, col: 7 - index };
        // 6: 左下 (7, 1)
        if (index === 6) return { row: 7, col: 1 };
        // 7-11: 左侧 (6, 1 -> 2, 1)
        if (index >= 7 && index <= 11) return { row: 7 - (index - 6), col: 1 };
        // 12: 左上 (1, 1)
        if (index === 12) return { row: 1, col: 1 };
        // 13-17: 顶部 (1, 2 -> 1, 6)
        if (index >= 13 && index <= 17) return { row: 1, col: 1 + (index - 12) };
        // 18: 右上 (1, 7)
        if (index === 18) return { row: 1, col: 7 };
        // 19-23: 右侧 (2, 7 -> 6, 7)
        if (index >= 19 && index <= 23) return { row: 1 + (index - 18), col: 7 };
        
        return { row: 1, col: 1 };
    }

    function getPlayerColor(idx) {
        const colors = ['red', 'blue', 'green', '#eab308']; // 黄色-500
        return colors[idx % colors.length];
    }

    // --- 事件绑定 ---
    $('#btn-create').click(() => {
        isLocalGame = false;
        // 创建联机房间才初始化 Peer
        initPeer((id) => {
            initHostGame();
            $('#create-room-section').hide();
            $('#waiting-section').show();
        });
    });

    $('#btn-ai').click(() => {
        isLocalGame = true;
        // 本地人机，不需要 Peer
        initHostGame();
        addBot(); // 加一个机器人
        $('#create-room-section').hide();
        $('#waiting-section').show();
        updateLobbyUI(); // 强制更新 UI 以隐藏元素
    });

    $('#btn-join').click(() => {
        const id = $('#room-id-input').val();
        if (id) joinRoom(id);
    });

    $('#btn-copy').click(() => {
        // 非安全上下文的回退方案
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(window.location.href + '?room=' + myId)
                .then(() => showToast("房间链接已复制!", "success"))
                .catch(err => {
                    console.error('复制失败', err);
                    fallbackCopy();
                });
        } else {
            fallbackCopy();
        }
    });

    function fallbackCopy() {
        const shareUrl = window.location.href + '?room=' + myId;
        const $tempInput = $('<input>');
        $('body').append($tempInput);
        $tempInput.val(shareUrl).select();
        document.execCommand('copy');
        $tempInput.remove();
        showToast("房间链接已复制!", "success");
    }

    $('#btn-add-bot').click(() => {
        addBot();
    });

    $('#btn-start-game').click(() => {
        startGame();
    });

    $('#btn-restart-game').click(() => {
        // 重置游戏状态但保留玩家
        gameState = 'LOBBY';
        currentPlayerIdx = 0;
        gameLog = [];
        lastDice = null;
        properties = {};
        
        // 重置玩家状态
        players.forEach(p => {
            p.money = START_MONEY;
            p.pos = 0;
            p.isJail = false;
            p.jailTurns = 0;
            p.properties = [];
            p.isBankrupt = false;
            p.hasRolled = false;
        });

        $('#game-over-modal').addClass('hidden');
        $('#game-area').addClass('hidden').removeClass('flex');
        updateLobbyUI();
        $('#lobby').show();
        $('#waiting-section').show();
        
        broadcastState();
        showToast("房主已重置游戏，回到大厅", "success");
    });

    $('#btn-roll').click(() => {
        if (isHost) {
            handleGameAction(myId, { type: 'ROLL' });
        } else {
            hostConn.send({ type: 'ACTION', action: { type: 'ROLL' } });
        }
    });

    $('#btn-buy').click(() => {
        const actionType = $('#btn-buy').data('action') || 'BUY';
        if (isHost) {
            handleGameAction(myId, { type: actionType });
        } else {
            hostConn.send({ type: 'ACTION', action: { type: actionType } });
        }
    });

    $('#btn-end').click(() => {
        if (isHost) {
            handleGameAction(myId, { type: 'END' });
        } else {
            hostConn.send({ type: 'ACTION', action: { type: 'END' } });
        }
    });

    $('#btn-trade').click(() => {
        initTrade();
    });

    $('#trade-target-player').change(() => {
        updateTradeTargetProps();
    });

    $('#btn-cancel-trade').click(() => {
        $('#trade-modal').addClass('hidden');
    });

    $('#btn-confirm-trade').click(() => {
        sendTradeOffer();
    });

    $('#btn-accept-trade').click(() => {
        respondToTrade(true);
    });

    $('#btn-reject-trade').click(() => {
        respondToTrade(false);
    });

    // 拍卖处理程序
    $('.btn-bid').click(function() {
        if (!auctionState || !auctionState.active) return;
        const amount = parseInt($(this).data('amount'));
        const action = { type: 'BID', amount: amount };
        
        if (isHost) {
            handleAuctionAction(myId, action);
        } else {
            hostConn.send({ type: 'ACTION', action: action });
        }
    });

    $('#btn-auction-pass').click(function() {
        if (!auctionState || !auctionState.active) return;
        const action = { type: 'PASS_BID' };
        
        if (isHost) {
            handleAuctionAction(myId, action);
        } else {
            hostConn.send({ type: 'ACTION', action: action });
        }
    });

    $(document).on('click', '#btn-modal-upgrade', function() {
        const tileId = parseInt($(this).data('id'));
        if (isNaN(tileId)) return;
        
        const action = { type: 'UPGRADE', tileId: tileId };
        
        if (isHost) {
            handleGameAction(myId, action);
        } else {
            hostConn.send({ type: 'ACTION', action: action });
        }
        $('#tile-modal').addClass('hidden');
    });

    $(document).on('click', '#btn-modal-sell-house', function() {
        const tileId = parseInt($(this).data('id'));
        if (isNaN(tileId)) return;
        const action = { type: 'SELL_HOUSE', tileId: tileId };
        if (isHost) handleGameAction(myId, action);
        else hostConn.send({ type: 'ACTION', action: action });
        $('#tile-modal').addClass('hidden');
    });

    $(document).on('click', '#btn-modal-mortgage', function() {
        const tileId = parseInt($(this).data('id'));
        if (isNaN(tileId)) return;
        const action = { type: 'MORTGAGE', tileId: tileId };
        if (isHost) handleGameAction(myId, action);
        else hostConn.send({ type: 'ACTION', action: action });
        $('#tile-modal').addClass('hidden');
    });

    $(document).on('click', '#btn-modal-unmortgage', function() {
        const tileId = parseInt($(this).data('id'));
        if (isNaN(tileId)) return;
        const action = { type: 'UNMORTGAGE', tileId: tileId };
        if (isHost) handleGameAction(myId, action);
        else hostConn.send({ type: 'ACTION', action: action });
        $('#tile-modal').addClass('hidden');
    });

    // 详情弹窗关闭
    $('#btn-close-tile').click(() => {
        $('#tile-modal').addClass('hidden');
    });

    // 点击背景关闭
    $('#tile-modal').click(function(e) {
        if (e.target === this) {
            $(this).addClass('hidden');
        }
    });

    // --- UI 助手: 显示地块详情 ---
    function showTileDetails(id) {
        const tile = TILES.find(t => t.id === id);
        if (!tile) return;

        const $content = $('#tile-detail-content');
        let html = '';
        
        // 头部
        html += `<div class="text-center mb-4">`;
        if (tile.color) {
            html += `<div class="w-full h-4 bg-${tile.color} rounded-t mb-2"></div>`;
        }
        html += `<h3 class="text-xl font-bold text-slate-800">${tile.name}</h3>`;
        if (tile.type === 'property') {
            html += `<p class="text-slate-500 text-sm">地皮价格: $${tile.price}</p>`;
        }
        html += `</div>`;

        // 内容
        if (tile.type === 'property') {
            const prop = properties[tile.id];
            const owner = prop ? players.find(p => p.id === prop.ownerId) : null;
            
            html += `<div class="space-y-2 text-sm text-slate-700">`;
            html += `<div class="flex justify-between border-b pb-1"><span>拥有者:</span> <span class="font-bold">${owner ? owner.name : '无'}</span></div>`;
            html += `<div class="flex justify-between border-b pb-1"><span>房屋等级:</span> <span class="font-bold">${prop ? prop.level : 0} / 5</span></div>`;
            html += `<div class="flex justify-between border-b pb-1"><span>房屋升级价格:</span> <span>$${tile.housePrice}</span></div>`;
            
            html += `<div class="mt-4">`;
            html += `<h4 class="font-bold mb-2">租金表:</h4>`;
            html += `<table class="w-full text-left text-xs">`;
            const rents = Array.isArray(tile.rent) ? tile.rent : [tile.rent];
            rents.forEach((r, lvl) => {
                 const isCurrent = prop && prop.level === lvl;
                 html += `<tr class="${isCurrent ? 'bg-yellow-100 font-bold' : ''}"><td class="py-1">等级 ${lvl}:</td><td class="text-right">$${r}</td></tr>`;
            });
            html += `</table>`;
            html += `</div>`;

            // 升级/出售/抵押/赎回 按钮逻辑
            const me = players.find(p => p.id === myId);
            const isMyTurnNow = players[currentPlayerIdx].id === myId;
            const isOwner = prop && prop.ownerId === myId;
            
            if (isMyTurnNow && isOwner) {
                html += `<div class="mt-4 pt-2 border-t space-y-2">`;
                
                // 1. 升级 (需要凑齐颜色 + 未抵押 + 均匀建造)
                if (prop.level < 5 && checkColorSet(me, tile.color) && !prop.isMortgaged) {
                     const canAfford = me.money >= tile.housePrice;
                     
                     // 检查均匀建造
                     const colorTiles = TILES.filter(t => t.color === tile.color);
                     const colorProps = colorTiles.map(t => properties[t.id]);
                     const minLevel = Math.min(...colorProps.map(p => p.level));
                     const isEven = prop.level <= minLevel;
                     
                     let btnText = "升级房屋";
                     let disabled = false;
                     let btnClass = "bg-green-500 hover:bg-green-600 text-white";

                     if (!isEven) {
                         btnText = "需均匀建造";
                         disabled = true;
                         btnClass = "bg-slate-300 cursor-not-allowed text-slate-500";
                     } else if (!canAfford) {
                         btnText = "资金不足";
                         disabled = true;
                         btnClass = "bg-slate-300 cursor-not-allowed text-slate-500";
                     }

                     html += `
                        <button id="btn-modal-upgrade" class="w-full py-2 rounded font-bold ${btnClass}" ${disabled ? 'disabled' : ''} data-id="${tile.id}">
                            ${btnText} ($${tile.housePrice})
                        </button>
                     `;
                }

                // 2. 出售房屋 (需要有房 + 未抵押)
                if (prop.level > 0 && !prop.isMortgaged) {
                     // 检查均匀出售
                     const colorTiles = TILES.filter(t => t.color === tile.color);
                     const colorProps = colorTiles.map(t => properties[t.id]);
                     const maxLevel = Math.max(...colorProps.map(p => p.level));
                     const isEven = prop.level >= maxLevel;

                     let btnText = `出售房屋 (获 $${Math.floor(tile.housePrice / 2)})`;
                     let disabled = false;
                     let btnClass = "bg-orange-500 hover:bg-orange-600 text-white";
                     
                     if (!isEven) {
                         btnText = "需均匀出售";
                         disabled = true;
                         btnClass = "bg-slate-300 cursor-not-allowed text-slate-500";
                     }

                     html += `
                        <button id="btn-modal-sell-house" class="w-full py-2 rounded font-bold ${btnClass}" ${disabled ? 'disabled' : ''} data-id="${tile.id}">
                            ${btnText}
                        </button>
                     `;
                }
                
                // 3. 抵押 (无房 + 未抵押)
                if (prop.level === 0 && !prop.isMortgaged) {
                     const mortgageVal = Math.floor(tile.price / 2);
                     // 检查同色组是否有房
                     const colorTiles = TILES.filter(t => t.color === tile.color);
                     const hasHouses = colorTiles.some(t => properties[t.id] && properties[t.id].level > 0);
                     
                     let btnText = `抵押 (获 $${mortgageVal})`;
                     let disabled = false;
                     let btnClass = "bg-red-500 hover:bg-red-600 text-white";

                     if (hasHouses) {
                         btnText = "同色组有房，无法抵押";
                         disabled = true;
                         btnClass = "bg-slate-300 cursor-not-allowed text-slate-500";
                     }

                     html += `
                        <button id="btn-modal-mortgage" class="w-full py-2 rounded font-bold ${btnClass}" ${disabled ? 'disabled' : ''} data-id="${tile.id}">
                            ${btnText}
                        </button>
                     `;
                }

                // 4. 赎回 (已抵押)
                if (prop.isMortgaged) {
                    const cost = Math.ceil(tile.price / 2 * 1.1);
                    const canAfford = me.money >= cost;
                    
                    let btnText = `赎回 (付 $${cost})`;
                    let disabled = !canAfford;
                    let btnClass = canAfford ? "bg-green-500 hover:bg-green-600 text-white" : "bg-slate-300 cursor-not-allowed text-slate-500";
                    
                    if (!canAfford) {
                        btnText = `资金不足 (需 $${cost})`;
                    }

                    html += `
                        <button id="btn-modal-unmortgage" class="w-full py-2 rounded font-bold ${btnClass}" ${disabled ? 'disabled' : ''} data-id="${tile.id}">
                            ${btnText}
                        </button>
                    `;
                }

                html += `</div>`;
            }

            html += `</div>`;

        } else if (tile.type === 'chance') {
            html += `<p class="text-center text-slate-600">停下试试手气，可能会有好事发生，也可能有坏事！</p>`;
        } else if (tile.type === 'jail') {
            html += `<p class="text-center text-slate-600">只是路过探监，或者不幸入狱暂停回合。</p>`;
        } else if (tile.type === 'start') {
            html += `<p class="text-center text-slate-600">起点。每次经过或到达此处，可获得 $${SALARY} 工资。</p>`;
        } else if (tile.type === 'parking') {
            html += `<p class="text-center text-slate-600">免费停车。什么都不做，休息一回合。</p>`;
        } else if (tile.type === 'gotojail') {
            html += `<p class="text-center text-slate-600">直接入狱！不经过起点，不领工资。</p>`;
        } else if (tile.type === 'wheel') {
             html += `<p class="text-center text-slate-600">命运轮盘！转动轮盘决定命运。</p>`;
        }

        $content.html(html);
        $('#tile-modal').removeClass('hidden');
    }

    // 调试用：URL 参数自动加入
    if (urlParams.get('join') || urlParams.get('room')) {
        const roomIdToJoin = urlParams.get('join') || urlParams.get('room');
        // 等待一小段时间确保 DOM 加载完毕
        setTimeout(() => {
            if (roomIdToJoin) {
                $('#room-id-input').val(roomIdToJoin);
                $('#btn-join').click();
            }
        }, 500);
    }
});
