$(document).ready(function() {
    // --- 配置 ---
    const DEBUG = false; // 调试开关
    function log(...args) {
        if (DEBUG) console.log(...args);
    }

    const HEX_SIZE = 80;
    const RESOURCE_IMAGES = {
        'desert': 'img/desert.png',
        'brick': 'img/brick.png',
        'wood': 'img/wood.png',
        'wool': 'img/sheep.png',
        'grain': 'img/wheat.png',
        'ore': 'img/ore.png'
    };
    // 资源中文名称映射
    const RESOURCE_NAMES = {
        'brick': '砖块',
        'wood': '木材',
        'wool': '羊毛',
        'grain': '粮食',
        'ore': '矿石',
        'desert': '沙漠'
    };

    const RESOURCE_EMOJIS = {
        'brick': '🧱',
        'wood': '🌲',
        'wool': '🐑',
        'grain': '🌾',
        'ore': '⛰️',
        'desert': '🌵'
    };

    const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f97316']; // 红, 蓝, 绿, 橙
    const COSTS = {
        road: { brick: 1, wood: 1 },
        settlement: { brick: 1, wood: 1, wool: 1, grain: 1 },
        city: { grain: 2, ore: 3 },
        dev: { wool: 1, grain: 1, ore: 1 }
    };

    const ICON_PATHS = {
        settlement: "M -10 0 L -10 -10 L 0 -18 L 10 -10 L 10 0 Z",
        city: "M -14 0 L -14 -10 L -10 -10 L -10 -18 L -4 -12 L 0 -16 L 4 -12 L 10 -18 L 10 -10 L 14 -10 L 14 0 Z",
        road: "M -35 -5 L 35 -5 L 35 5 L -35 5 Z" // 矩形棒 70x10 (更长更宽)
    };
    
    // --- 全局状态 ---
    let camera = { x: 0, y: 0, scale: 1 };
    let isDragging = false, lastMouse = { x: 0, y: 0 };
    
    // 游戏数据
    let board = { hexes: [], vertices: {}, edges: {}, robber: null };
    let players = [];
    let currentPlayer = 0;
    let turnPhase = 'roll'; // 'roll', 'trade', 'build', 'robber_discard', 'robber_move', 'robber_steal'
    let setupPhase = true; // 前两轮
    let setupTurn = 0; // 计数直到 players.length * 2
    let setupState = 'settlement'; // 'settlement' 或 'road'
    let lastBuiltSettlement = null; // 用于追踪初始建设的村庄以连接道路
    let diceVal = 7;
    let dice1 = 3;
    let dice2 = 4;
    let robberHex = null; // 盗贼所在的六边形索引
    let stealingFrom = null; // 潜在受害者数组
    
    // 商业版规则：持久化特殊卡持有者
    let longestRoadOwnerId = null;
    let largestArmyOwnerId = null;
    
    // 网络
    let peer = null;
    let connections = {}; // 房主: id -> conn
    let hostConn = null; // 客户端: conn
    let myId = null;
    let isHost = false;
    let roomId = null;
    let isGameStarted = false;

    let gameMode = 'ai'; // 'ai', 'online'
    let myPlayerIndex = 0;
    let isTradePending = false; // 是否正在等待交易响应

    // --- 音效 ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    
    function playSound(type) {
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        
        if (type === 'click') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
        }
        else if (type === 'dice') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.linearRampToValueAtTime(400, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        }
        else if (type === 'build') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.linearRampToValueAtTime(500, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        }
        else if (type === 'turn') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.setValueAtTime(600, now + 0.2);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        }
    }

    // --- 视觉效果 ---
    let lastProcessedActionId = null;

    function playActionEffect(action) {
        // 防止重复播放 (如果广播包重发)
        // 使用时间戳或 ID (如果是 trade_offer)
        // 但 build 动作通常没有 ID。
        // 简单去重：如果 action 类型和 target 完全一样，且时间很近?
        // 更好的方法：broadcastState 时带上 timestamp，如果 timestamp 没变就不重播?
        // 目前 broadcastState 的 timestamp 每次都变。
        // 我们假设每次 broadcastState 都是一次新的更新。
        
        // 简单防止短时间内完全相同的动作重复播放 (除了 roll，roll 总是新的)
        const actionKey = action.type + '_' + (action.id || action.hexIndex || '') + '_' + Date.now();
        // 这里暂时不严格去重，依靠 action.type

        if (['build_road', 'build_settlement', 'build_city', 'buy_dev_card'].includes(action.type)) {
             playSound('build');
             // 额外的视觉效果，比如粒子？(暂略)
        }
        else if (action.type === 'roll') {
             // 只有当不是我自己（Host）时才播放，因为 Host 已经播过了
             // 但 Host 的 updateUI 也会被调用（如果它是本地的话）。
             // 然而，Host 的 showDiceAnimation 是阻塞的，broadcastState 在之后。
             // 此时 Host 已经播完了。
             
             if (!isHost) {
                 // 客户端播放骰子动画
                 // 注意：这里我们立即显示动画，不使用 await，以免阻塞 UI 更新
                 showDiceAnimation(dice1, dice2, () => {}); 
             }
        }
        else if (action.type === 'end_turn') {
             playSound('turn');
        }
        else if (action.type === 'move_robber') {
             // 强盗音效?
        }
        else if (action.type === 'trade_response') {
            // Resolve sender index robustly
            let senderIdx = -1;
            if (typeof action.from === 'number') senderIdx = action.from;
            else if (typeof action.from === 'string') senderIdx = players.findIndex(p => p.id === action.from);
            
            if (action.accept) {
                const isMyTrade = (senderIdx === myPlayerIndex) || (action.responder === myPlayerIndex);
                if (isMyTrade) {
                    showToast('交易达成！');
                    playSound('build'); 
                }
                // Sender logic: Reset UI
                if (senderIdx === myPlayerIndex) {
                    isTradePending = false;
                    updateTradeUI();
                }
            } else {
                if (senderIdx === myPlayerIndex) {
                    showToast('对方拒绝了你的交易请求。');
                    isTradePending = false;
                    updateTradeUI(); 
                }
            }
        } else if (action.type === 'trade_cancel') {
             // 如果我是目标，关闭交易弹窗
             if (action.target === myPlayerIndex) {
                 $('#trade-offer-modal').addClass('hidden');
                 showToast('对方取消了交易请求。');
                 currentOffer = null;
             }
        } else if (action.type === 'trade_offer') {
            if (myPlayerIndex === action.target) {
                // 我是被请求的玩家
                const senderId = action.from !== undefined ? action.from : currentPlayer;
                const sender = players[senderId];
                
                // 设置全局 currentOffer 用于响应处理
                currentOffer = {
                    id: action.offerId || (Date.now() + Math.random()),
                    from: senderId,
                    give: action.give,
                    get: action.get
                };
                
                // 构建 UI 文本
                $('#offer-sender').text(sender ? sender.name : 'Unknown');
                
                let gainText = '';
                for(let k in action.give) {
                    if (action.give[k] > 0) gainText += `${RESOURCE_NAMES[k]} x${action.give[k]} `;
                }
                $('#offer-get').text(gainText || '无');

                let loseText = '';
                for(let k in action.get) {
                    if (action.get[k] > 0) loseText += `${RESOURCE_NAMES[k]} x${action.get[k]} `;
                }
                $('#offer-give').text(loseText || '无');
                
                // 检查是否有足够的资源接受交易
                let canAccept = true;
                const me = players[myPlayerIndex];
                for(let k in action.get) {
                    if (me.resources[k] < action.get[k]) canAccept = false;
                }
                
                $('#btn-accept-offer').prop('disabled', !canAccept).text(canAccept ? '接受交易' : '资源不足');
                $('#trade-offer-modal').removeClass('hidden');
                playSound('turn'); // Notification sound
            }
        }
    }

    // --- 辅助函数 ---
    function getPlayerColor(pid) {
        if (pid === null || pid === undefined) return 'none';
        const index = players.findIndex(p => p.id === pid);
        if (index === -1) return '#94a3b8'; // Fallback slate-400
        return PLAYER_COLORS[index % PLAYER_COLORS.length];
    }

    // --- 页面生命周期 ---
    window.addEventListener('beforeunload', () => {
        if (gameMode === 'online') {
            if (isHost) {
                // 房主退出：通知所有客户端
                for (let id in connections) {
                    try { connections[id].send({ type: 'host_left' }); } catch(e) { }
                }
                // 清除保存的游戏状态，防止自动恢复
                if (roomId) {
                    localStorage.removeItem(`catan_game_${roomId}`);
                }
                // 尝试清除 URL 参数 (这样刷新后不会带上 room ID)
                try {
                    history.replaceState(null, '', location.pathname);
                } catch (e) { }
            } else {
                // 客户端退出：通知房主 (可选，PeerJS close 事件也会触发)
                if (hostConn && hostConn.open) {
                    try { hostConn.send({ type: 'client_left', id: myId }); } catch(e) { }
                }
            }
        }
    });

    // --- 初始化 ---
    function init() {
        initSVG();
        initInputs();
        
        // PeerJS 设置
        let savedId = localStorage.getItem('catan_peer_id');
        
        // 检查 ID 长度，如果太短则重新生成 (用户反馈 ID 太短)
        // 新目标: 使用更长的随机字符串 (约 20+ chars)
        if (!savedId || (savedId.startsWith('catan_') && savedId.length < 16)) {
             const randomPart = Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2);
             savedId = 'catan_' + randomPart;
             localStorage.setItem('catan_peer_id', savedId);
        }
        
        initPeer();
        
        // 确保状态指示器初始隐藏
        $('#game-status-indicator').addClass('hidden').removeClass('flex md:flex');
    }

    function initSVG() {
        const svg = document.getElementById('game-svg');
        const defs = document.getElementById('svg-defs');
        
        // 定义六边形剪切路径
        // 以 0,0 为中心的平顶六边形点集，大小为 HEX_SIZE
        let points = "";
        for(let i=0; i<6; i++) {
            const angle = Math.PI/3 * (i - 0.5);
            const x = HEX_SIZE * Math.cos(angle);
            const y = HEX_SIZE * Math.sin(angle);
            points += `${x},${y} `;
        }
        
        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', 'hex-clip');
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', points);
        clipPath.appendChild(polygon);
        defs.appendChild(clipPath);
        
        // 初始相机中心
        camera.x = window.innerWidth / 2;
        camera.y = window.innerHeight / 2;
        updateCamera();
    }

    function initInputs() {
        const svg = document.getElementById('game-svg');
        
        // 拖拽逻辑
        $(svg).on('mousedown touchstart', e => {
            if (e.target.closest('.interactive')) return; // 如果点击交互元素则不拖拽
            e.preventDefault();
            isDragging = true;
            lastMouse = getEventPoint(e);
        });
        
        $(window).on('mouseup touchend', () => isDragging = false);
        $(window).on('mousemove touchmove', e => {
            if (isDragging) {
                const pt = getEventPoint(e);
                const dx = pt.x - lastMouse.x;
                const dy = pt.y - lastMouse.y;
                
                camera.x += dx;
                camera.y += dy;
                
                // 限制拖动范围
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                // 允许偏离中心的最大距离 (适配不同屏幕)
                const rangeX = Math.max(600, window.innerWidth * 0.8);
                const rangeY = Math.max(600, window.innerHeight * 0.8);

                camera.x = Math.max(cx - rangeX, Math.min(cx + rangeX, camera.x));
                camera.y = Math.max(cy - rangeY, Math.min(cy + rangeY, camera.y));
                
                lastMouse = pt;
                updateCamera();
            }
        });

        // UI 处理器
    $('#btn-create').on('click touchend', function(e) {
        e.preventDefault();
        createRoom();
    });
    $('#btn-join').on('click touchend', function(e) {
        e.preventDefault();
        joinRoom($('#room-id-input').val());
    });
    $('#btn-ai').on('click touchend', function(e) {
        e.preventDefault();
        startPvAI();
    });
    $('#btn-pvp').on('click touchend', function(e) {
        e.preventDefault();
        startPvAI(); // 暂时也用本地AI逻辑，实际上这应该是本地热座模式，但为了简单，现在还是AI
    });
    $('#btn-add-bot').on('click touchend', function(e) {
        e.preventDefault();
        addBot();
    });
    $('#btn-start-game').on('click touchend', function(e) {
        e.preventDefault();
        hostStartGame();
    });
    $('#btn-copy').on('click touchend', function(e) {
        e.preventDefault();
        copyLink();
    });
    
    $('#btn-roll').on('click touchend', function(e) {
        e.preventDefault();
        // 立即禁用按钮并显示加载状态
        const btn = $(this);
        if (btn.prop('disabled')) return;
        
        btn.prop('disabled', true).addClass('opacity-75 cursor-wait');
        btn.find('span').last().text('掷骰中...');
        
        doAction({ type: 'roll' });
    });
    $('#btn-end-turn').on('click touchend', function(e) {
        e.preventDefault();
        if (isTradePending) {
            showToast('请先完成或取消当前交易！');
            return;
        }
        doAction({ type: 'end_turn' });
    });
    
    // 建设按钮设置 "建设模式"
    $('#btn-build-road').on('click touchend', function(e) {
        e.preventDefault();
        setBuildMode('road');
    });
    $('#btn-build-settlement').on('click touchend', function(e) {
        e.preventDefault();
        setBuildMode('settlement');
    });
    $('#btn-build-city').on('click touchend', function(e) {
        e.preventDefault();
        setBuildMode('city');
    });

    // 交易 UI
    $('#btn-trade').on('click touchend', function(e) {
        e.preventDefault();
        openTradeModal();
    });
    $('#btn-close-trade').on('click touchend', function(e) {
        e.preventDefault();
        closeTradeModal();
    });
    $('#btn-confirm-trade').on('click touchend', function(e) {
        e.preventDefault();
        confirmTrade();
    });
    $('#tab-bank').on('click touchend', function(e) {
        e.preventDefault();
        switchTradeTab('bank');
    });
    $('#tab-player').on('click touchend', function(e) {
        e.preventDefault();
        switchTradeTab('player');
    });
        
    $('#btn-reject-offer').on('click touchend', function(e) {
        e.preventDefault();
        respondToOffer(false);
    });
    $('#btn-accept-offer').on('click touchend', function(e) {
        e.preventDefault();
        respondToOffer(true);
    });
    
    // 发展卡 UI
    $('#btn-buy-dev').on('click touchend', function(e) {
        e.preventDefault();
        const btn = $(this);
        if (btn.prop('disabled')) return; // 检查禁用状态
        openDevModal();
    });
    $('#btn-close-dev').on('click touchend', function(e) {
        e.preventDefault();
        $('#dev-card-modal').addClass('hidden');
    });
    $('#btn-buy-dev-confirm').on('click touchend', function(e) {
        e.preventDefault();
        doAction({ type: 'buy_dev_card' });
    });
    $('#btn-cancel-res-select').on('click touchend', function(e) {
        e.preventDefault();
        $('#resource-select-modal').addClass('hidden');
    });

        // 移动端信息面板折叠
    $('#toggle-info-btn').on('click touchend', function(e) {
        e.preventDefault();
        const container = $('#player-list-container');
        const btn = $(this);
        
        if (container.hasClass('h-0')) {
            container.removeClass('h-0').addClass('h-auto');
            btn.text('收起');
        } else {
            container.addClass('h-0').removeClass('h-auto');
            btn.text('展开');
        }
    });

    // 帮助按钮逻辑
    $('#btn-help').on('click touchend', function(e) {
        e.preventDefault();
        $('#help-modal').removeClass('hidden');
    });

    // 关闭帮助按钮
    $('#btn-close-help-header, #btn-close-help-footer').on('click touchend', function(e) {
        e.preventDefault();
        $('#help-modal').addClass('hidden');
    });

    // 模态框背景点击关闭
    $('#help-modal').on('click touchend', function(e) {
        if (e.target === this) {
            e.preventDefault();
            $(this).addClass('hidden');
        }
    });
    }
    
    // --- 交易 UI 逻辑 ---
    let tradeState = {
        type: 'bank', // 'bank' | 'player'
        give: null, // 资源类型（银行模式）
        get: null, // 资源类型（银行模式）
        // 玩家交易专用
        target: null, // 玩家 ID
        pGive: { brick:0, wood:0, wool:0, grain:0, ore:0 }, // 我给出的
        pGet: { brick:0, wood:0, wool:0, grain:0, ore:0 } // 我得到的
    };

    let currentOffer = null; // 用于存储收到的交易请求 { from, give, get } (注意: 这里的 give/get 是相对于发送者的)

    function openTradeModal() {
        if (currentPlayer !== myPlayerIndex) {
            showToast('不是你的回合！');
            return;
        }
        if (turnPhase !== 'build') {
             if (turnPhase === 'roll') {
                 showToast('请先掷骰子！');
                 return;
             }
        }
        
        // 重置玩家交易状态
        isTradePending = false;
        tradeState.target = null;
        tradeState.pGive = { brick:0, wood:0, wool:0, grain:0, ore:0 };
        tradeState.pGet = { brick:0, wood:0, wool:0, grain:0, ore:0 };
        
        // 如果未设置，默认为银行标签页
        if (!tradeState.type) tradeState.type = 'bank';
        switchTradeTab(tradeState.type);
        
        $('#trade-modal').removeClass('hidden');
    }

    function closeTradeModal() {
        if (isTradePending) {
             doAction({
                type: 'trade_cancel',
                from: myPlayerIndex,
                target: tradeState.target
             });
             isTradePending = false;
        }
        $('#trade-modal').addClass('hidden');
        // 不重置类型以保持上次的标签页偏好
        tradeState.give = null;
        tradeState.get = null;
    }

    function switchTradeTab(tab) {
        tradeState.type = tab;
        
        // 更新标签页 UI
        if (tab === 'bank') {
            $('#tab-bank').addClass('text-blue-600 border-b-2 border-blue-600 bg-blue-50').removeClass('text-slate-500 hover:text-slate-700 hover:bg-slate-50');
            $('#tab-player').removeClass('text-blue-600 border-b-2 border-blue-600 bg-blue-50').addClass('text-slate-500 hover:text-slate-700 hover:bg-slate-50');
            $('#panel-bank').removeClass('hidden');
            $('#panel-player').addClass('hidden');
        } else {
            $('#tab-player').addClass('text-blue-600 border-b-2 border-blue-600 bg-blue-50').removeClass('text-slate-500 hover:text-slate-700 hover:bg-slate-50');
            $('#tab-bank').removeClass('text-blue-600 border-b-2 border-blue-600 bg-blue-50').addClass('text-slate-500 hover:text-slate-700 hover:bg-slate-50');
            $('#panel-player').removeClass('hidden');
            $('#panel-bank').addClass('hidden');
        }
        
        updateTradeUI();
    }

    function updateTradeUI() {
        const p = players[myPlayerIndex];
        
        if (tradeState.type === 'bank') {
            const ratios = getTradeRatios(myPlayerIndex);
            
            // 填充支付列表
            const payList = $('#trade-pay-list');
            payList.empty();
            
            ['brick', 'wood', 'wool', 'grain', 'ore'].forEach(res => {
                const ratio = ratios[res];
                const count = p.resources[res];
                const canAfford = count >= ratio;
                const isSelected = tradeState.give === res;
                
                const div = $(`
                    <div class="flex items-center justify-between p-2 rounded cursor-pointer border ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'} ${!canAfford ? 'opacity-50 cursor-not-allowed' : ''}">
                        <div class="flex items-center gap-2">
                            <span class="font-bold">${RESOURCE_NAMES[res]}</span>
                            <span class="text-xs text-slate-500">(拥有: ${count})</span>
                        </div>
                        <span class="text-xs font-bold px-2 py-1 bg-slate-100 rounded text-slate-600">${ratio}:1</span>
                    </div>
                `);
                
                if (canAfford) {
                    div.on('click touchend', function(e) {
                        e.preventDefault();
                        tradeState.give = res;
                        updateTradeUI();
                    });
                }
                
                payList.append(div);
            });
            
            // 填充获得列表
            const getList = $('#trade-get-list');
            getList.empty();
            
            ['brick', 'wood', 'wool', 'grain', 'ore'].forEach(res => {
                if (res === tradeState.give) return; // 不能交换相同的
                
                const isSelected = tradeState.get === res;
                const div = $(`
                    <div class="flex items-center justify-between p-2 rounded cursor-pointer border ${isSelected ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:bg-slate-50'}">
                        <span class="font-bold">${RESOURCE_NAMES[res]}</span>
                    </div>
                `);
                
                div.on('click touchend', function(e) {
                    e.preventDefault();
                    tradeState.get = res;
                    updateTradeUI();
                });
                
                getList.append(div);
            });
            
            // 更新确认按钮
            const btn = $('#btn-confirm-trade');
            if (tradeState.give && tradeState.get) {
                btn.prop('disabled', false).text(`确认: ${ratios[tradeState.give]} ${RESOURCE_NAMES[tradeState.give]} 换 1 ${RESOURCE_NAMES[tradeState.get]}`);
            } else {
                btn.prop('disabled', true).text('确认交易');
            }
        } else {
            // 玩家交易 UI
            
            // 1. 目标玩家选择
            const targetList = $('#trade-target-list');
            targetList.empty();
            players.forEach((pl, i) => {
                if (i === myPlayerIndex) return;
                const isSelected = tradeState.target === i;
                const totalRes = Object.values(pl.resources).reduce((a,b)=>a+b,0);
                
                const div = $(`
                    <div class="flex-shrink-0 px-4 py-2 rounded-lg border cursor-pointer flex flex-col items-center ${isSelected ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-slate-200 hover:bg-slate-50 text-slate-600'} transition-all">
                        <span class="font-bold whitespace-nowrap">${pl.name}</span>
                        <span class="text-xs opacity-70">手牌: ${totalRes}</span>
                    </div>
                `);
                div.on('click touchend', function(e) {
                    e.preventDefault();
                    tradeState.target = i;
                    updateTradeUI();
                });
                targetList.append(div);
            });

            // 创建资源计数器的辅助函数
            const createCounter = (res, type) => { // type: 'give' | 'get'
                const stateObj = type === 'give' ? tradeState.pGive : tradeState.pGet;
                const count = stateObj[res];
                
                // 最大值逻辑与显示信息
                let max = 99;
                let infoText = '';
                
                if (type === 'give') {
                    // 我给出：上限是我拥有的
                    max = p.resources[res];
                    infoText = `(拥有: ${max})`;
                } else {
                    // 我想要：显示对方拥有的 (如果已选目标)
                    if (tradeState.target !== null) {
                        const targetP = players[tradeState.target];
                        const targetHas = targetP.resources[res];
                        max = targetHas; // 严格限制上限为对方拥有的
                        infoText = `(对方: ${targetHas})`;
                    } else {
                        infoText = `(对方: ?)`;
                        max = 0; // 没选人不能加
                    }
                }
                
                const el = $(`
                    <div class="flex items-center justify-between p-2 border border-slate-100 rounded bg-white">
                        <div class="flex flex-col">
                            <span class="font-bold text-sm text-slate-700">${RESOURCE_NAMES[res]}</span>
                            <span class="text-[10px] text-slate-400 font-mono">${infoText}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button class="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center disabled:opacity-30 transition-colors" ${count <= 0 ? 'disabled' : ''}>-</button>
                            <span class="w-4 text-center font-bold text-sm">${count}</span>
                            <button class="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center disabled:opacity-30 transition-colors" ${count >= max ? 'disabled' : ''}>+</button>
                        </div>
                    </div>
                `);
                
                // 减少
                el.find('button').first().on('click touchend', function(e) {
                    e.preventDefault();
                    if (count > 0) {
                        stateObj[res]--;
                        updateTradeUI();
                    }
                });
                // 增加
                el.find('button').last().on('click touchend', function(e) {
                    e.preventDefault();
                    if (count < max) {
                        stateObj[res]++;
                        updateTradeUI();
                    } else {
                        if (type === 'get') showToast('对方资源不足');
                        else showToast('你的资源不足');
                    }
                });
                
                return el;
            };

            // 2. 给出列表
            const giveList = $('#p-trade-give-list');
            giveList.empty();
            ['brick', 'wood', 'wool', 'grain', 'ore'].forEach(res => {
                giveList.append(createCounter(res, 'give'));
            });

            // 3. 获得列表
            const getList = $('#p-trade-get-list');
            getList.empty();
            ['brick', 'wood', 'wool', 'grain', 'ore'].forEach(res => {
                getList.append(createCounter(res, 'get'));
            });

            // 更新确认按钮
            const btn = $('#btn-confirm-trade');
            const totalGive = Object.values(tradeState.pGive).reduce((a,b)=>a+b,0);
            const totalGet = Object.values(tradeState.pGet).reduce((a,b)=>a+b,0);
            
            // 处理等待状态
            if (isTradePending) {
                 // 禁用输入
                 $('#trade-target-list').children().addClass('opacity-50 pointer-events-none');
                 $('#p-trade-give-list button, #p-trade-get-list button').prop('disabled', true);
                 
                 btn.prop('disabled', false)
                    .removeClass('bg-blue-600 hover:bg-blue-700 shadow-blue-200')
                    .addClass('bg-orange-500 hover:bg-orange-600 shadow-orange-200')
                    .html('<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span>等待响应... (点击取消)');
            } else {
                // 正常状态
                btn.removeClass('bg-orange-500 hover:bg-orange-600 shadow-orange-200')
                   .addClass('bg-blue-600 hover:bg-blue-700 shadow-blue-200');
                   
                if (tradeState.target !== null && totalGive > 0 && totalGet > 0) {
                    btn.prop('disabled', false).text('发起交易请求');
                } else {
                    btn.prop('disabled', true).text('请选择玩家和资源');
                }
            }
        }
    }

    function confirmTrade() {
        if (tradeState.type === 'bank') {
            if (!tradeState.give || !tradeState.get) return;
            doAction({
                type: 'trade_bank',
                give: tradeState.give,
                get: tradeState.get
            });
            closeTradeModal();
        } else {
            // 玩家交易
            if (isTradePending) {
                // 取消逻辑
                 doAction({
                    type: 'trade_cancel',
                    from: myPlayerIndex,
                    target: tradeState.target
                });
                isTradePending = false;
                updateTradeUI();
                return;
            }

            if (tradeState.target === null) return;
            doAction({
                type: 'trade_offer',
                from: myPlayerIndex, // 显式添加发起者 ID
                target: tradeState.target,
                give: tradeState.pGive, // 发送者给出的
                get: tradeState.pGet    // 发送者想要的
            });
            
            isTradePending = true;
            updateTradeUI();
            // closeTradeModal(); // 保持开启以显示状态
            // showToast('交易请求已发送...'); // 可选，UI 现在显示状态
        }
    }
    
    function respondToOffer(accept) {
        if (!currentOffer) return;
        $('#trade-offer-modal').addClass('hidden');
        
        doAction({
            type: 'trade_response',
            offerId: currentOffer.id,
            from: currentOffer.from, // 原始发送者
            responder: myPlayerIndex, // 添加响应者
            accept: accept,
            // 重新发送详细信息以进行验证/执行
            give: currentOffer.give,
            get: currentOffer.get
        });
        
        currentOffer = null;
    }
    
    function updateCamera() {
        const layer = document.getElementById('game-layer');
        layer.setAttribute('transform', `translate(${camera.x}, ${camera.y}) scale(${camera.scale})`);
    }

    let currentBuildMode = null;
    function setBuildMode(mode) {
        if (currentPlayer !== myPlayerIndex) return;

        // 进入模式前的检查
        if (mode && currentBuildMode !== mode) {
            if (setupPhase) {
                // 初始阶段检查 (免费)
                if (mode === 'city') {
                    showToast('初始阶段不能建设城市！');
                    return;
                }
                if (mode === 'road' && setupState !== 'road') {
                    showToast('请先建设定居点！');
                    return;
                }
                if (mode === 'settlement' && setupState !== 'settlement') {
                    showToast('请先建设道路！');
                    return;
                }
            } else {
                // 正常阶段：检查资源
                let canBuild = canAfford(players[myPlayerIndex], mode);
                
                // 特殊情况：免费道路
                if (mode === 'road' && players[myPlayerIndex].freeRoads > 0) {
                    canBuild = true;
                }
                
                if (!canBuild) {
                    const missing = getMissingResources(players[myPlayerIndex], mode);
                    showToast(`资源不足！缺: ${missing}`);
                    return;
                }
            }
        }

        if (currentBuildMode === mode) currentBuildMode = null; // 切换关闭
        else currentBuildMode = mode;
        
        updateHints();
        updateUI(); // 触发 UI 更新以反映按钮状态和提示文字
    }

    function getEventPoint(e) {
        const t = e.originalEvent.touches ? e.originalEvent.touches[0] : e;
        return { x: t.clientX, y: t.clientY };
    }

    // --- 发展卡 ---
    // 牌堆: 14 骑士, 5 分数, 2 道路, 2 丰收, 2 垄断 = 25
    let devDeck = [];
    
    function initDevDeck() {
        devDeck = [];
        for(let i=0; i<14; i++) devDeck.push('knight');
        for(let i=0; i<5; i++) devDeck.push('vp');
        for(let i=0; i<2; i++) devDeck.push('road_building');
        for(let i=0; i<2; i++) devDeck.push('year_of_plenty');
        for(let i=0; i<2; i++) devDeck.push('monopoly');
        devDeck.sort(() => Math.random() - 0.5);
    }

    // --- 发展卡逻辑 ---
    let playedDevCardThisTurn = false;

    function openDevModal() {
        $('#dev-card-modal').removeClass('hidden');
        updateDevModal();
    }
    
    function updateDevModal() {
        const p = players[myPlayerIndex];
        if (!p) return;

        // 更新购买按钮
        const canBuy = canAfford(p, 'dev') && (currentPlayer === myPlayerIndex) && (turnPhase === 'build') && (!setupPhase);
        const btnBuy = $('#btn-buy-dev-confirm');
        btnBuy.prop('disabled', !canBuy);
        
        // 更新我的卡牌
        $('#my-dev-count').text(p.devCards.length);
        const list = $('#my-dev-list');
        list.empty();
        
        if (p.devCards.length === 0) {
            list.append('<div class="text-center text-slate-400 py-4 text-sm">暂无发展卡</div>');
        } else {
            // 卡牌分组
            const groups = {}; 
            p.devCards.forEach(c => {
                if (!groups[c.type]) groups[c.type] = [];
                groups[c.type].push(c);
            });
            
            for (let type in groups) {
                const cards = groups[type];
                let name = '', desc = '', icon = '🃏';
                
                if (type === 'knight') { name='骑士卡'; desc='移动盗贼'; icon='⚔️'; }
                else if (type === 'vp') { name='胜利点'; desc='自动加1分'; icon='🏆'; }
                else if (type === 'road_building') { name='道路建设'; desc='免费建2条路'; icon='🚧'; }
                else if (type === 'year_of_plenty') { name='丰收之年'; desc='获得2个任意资源'; icon='💰'; }
                else if (type === 'monopoly') { name='垄断'; desc='拿走一种资源的所有'; icon='✋'; }
                
                const cardEl = $(`
                    <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div class="flex items-center gap-3">
                            <div class="text-2xl">${icon}</div>
                            <div>
                                <div class="font-bold text-slate-800">${name} x${cards.length}</div>
                                <div class="text-xs text-slate-500">${desc}</div>
                            </div>
                        </div>
                        <button class="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            使用
                        </button>
                    </div>
                `);
                
                const btn = cardEl.find('button');
                
                if (type === 'vp') {
                    btn.text('已生效').prop('disabled', true).addClass('bg-transparent border-none text-green-600');
                } else {
                    const playableCard = cards.find(c => !c.boughtThisTurn);
                    // 允许在 roll 之前使用? 简化: 只在 build 阶段
                    const canPlay = (currentPlayer === myPlayerIndex) && 
                                    (turnPhase === 'build' || turnPhase === 'roll') && 
                                    !playedDevCardThisTurn && 
                                    playableCard;
                    
                    if (!canPlay) {
                        btn.prop('disabled', true);
                        if (playedDevCardThisTurn) btn.text('本回合已用');
                        else if (!playableCard) btn.text('刚购买');
                        else if (currentPlayer !== myPlayerIndex) btn.text('非你回合');
                        else btn.text('不可用');
                    }
                    
                    btn.on('click touchend', function(e) {
                        e.preventDefault();
                        if ($(this).prop('disabled')) return;
                        playDevCardReq(type);
                    });
                }
                list.append(cardEl);
            }
        }
    }
    
    function playDevCardReq(type) {
        if (type === 'knight') {
             doAction({ type: 'play_dev_card', cardType: 'knight' });
             $('#dev-card-modal').addClass('hidden');
        } else if (type === 'road_building') {
             doAction({ type: 'play_dev_card', cardType: 'road_building' });
             $('#dev-card-modal').addClass('hidden');
        } else if (type === 'year_of_plenty') {
             showResourceSelect(2, (resList) => {
                 doAction({ type: 'play_dev_card', cardType: 'year_of_plenty', resources: resList });
                 $('#dev-card-modal').addClass('hidden');
             });
        } else if (type === 'monopoly') {
             showResourceSelect(1, (resList) => {
                 doAction({ type: 'play_dev_card', cardType: 'monopoly', resource: resList[0] });
                 $('#dev-card-modal').addClass('hidden');
             });
        }
    }
    
    function showResourceSelect(maxCount, callback) {
        $('#resource-select-modal').removeClass('hidden');
        $('#res-select-title').text(maxCount === 1 ? '选择1种资源' : `选择${maxCount}个资源`);
        
        const container = $('#res-select-options');
        container.empty();
        
        const selected = [];
        
        const updateState = () => {
             // 如果需要刷新 UI
        };
        
        ['brick', 'wood', 'wool', 'grain', 'ore'].forEach(res => {
            const btn = $(`
                <button class="flex flex-col items-center justify-center p-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                    <div class="text-3xl mb-1">${RESOURCE_EMOJIS[res]}</div>
                    <span class="text-sm font-bold text-slate-600">${RESOURCE_NAMES[res]}</span>
                </button>
            `);
            
            btn.on('click touchend', function(e) {
                e.preventDefault();
                selected.push(res);
                showToast(`已选: ${RESOURCE_NAMES[res]}`);
                
                if (selected.length >= maxCount) {
                    $('#resource-select-modal').addClass('hidden');
                    callback(selected);
                }
            });
            
            container.append(btn);
        });
    }

    // --- UI 辅助函数 ---
    function addLog(html) {
        const log = $('#game-log');
        const entry = $(`<div class="log-entry">${html}</div>`);
        log.append(entry);
        // Scroll to bottom
        log.scrollTop(log[0].scrollHeight);
        
        // Limit log size
        if (log.children().length > 50) {
            log.children().first().remove();
        }
    }

    function broadcastLog(msg) {
        // Local log
        addLog(msg);
        
        // Broadcast if online host
        if (gameMode === 'online' && isHost) {
            const packet = { type: 'log', message: msg };
            for (let id in connections) {
                connections[id].send(packet);
            }
        }
    }

    function showToast(message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast-msg';
        toast.textContent = message;
        
        container.appendChild(toast);
        
        // 触发重绘
        void toast.offsetWidth;
        
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // --- 核心逻辑 ---
    function generateBoard() {
        const layout = [];
        // 生成 19 个六边形的螺旋
        const dirs = [{q:1,r:0}, {q:0,r:1}, {q:-1,r:1}, {q:-1,r:0}, {q:0,r:-1}, {q:1,r:-1}];
        let q=0, r=0;
        layout.push({q,r}); // 中心
        
        // 第 1 圈
        for(let i=0; i<6; i++) {
            let d = dirs[i];
            layout.push({q: d.q, r: d.r});
        }
        // 第 2 圈 (为了简单手动坐标)
        const coords = [
            {q:0,r:0}, 
            {q:1,r:-1}, {q:1,r:0}, {q:0,r:1}, {q:-1,r:1}, {q:-1,r:0}, {q:0,r:-1}, // 第 1 圈
            {q:2,r:-2}, {q:2,r:-1}, {q:2,r:0}, {q:1,r:1}, {q:0,r:2}, {q:-1,r:2}, {q:-2,r:2}, {q:-2,r:1}, {q:-2,r:0}, {q:-1,r:-1}, {q:0,r:-2}, {q:1,r:-2} // 第 2 圈
        ];

        // 资源: 4 木, 4 羊, 4 粮, 3 砖, 3 矿, 1 沙漠
        const resources = ['desert', ...Array(4).fill('wood'), ...Array(4).fill('wool'), ...Array(4).fill('grain'), ...Array(3).fill('brick'), ...Array(3).fill('ore')];
        resources.sort(() => Math.random() - 0.5);
        
        // 数字: 18 个数字 (跳过沙漠)
        // 2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12
        const numbers = [5,2,6,3,8,10,9,12,11,4,8,10,9,4,5,6,3,11];
        
        // 洗牌直到 6 和 8 不相邻
        let validBoard = false;
        let attempts = 0;
        
        // 映射 q,r 到 coords 索引以检查邻接
        const coordMap = {};
        coords.forEach((c, i) => coordMap[`${c.q},${c.r}`] = i);
        
        while (!validBoard && attempts < 100) {
            numbers.sort(() => Math.random() - 0.5);
            
            // 暂时分配数字
            let numIdx = 0;
            const tempHexes = coords.map((c, i) => {
                const res = resources[i];
                const num = res === 'desert' ? null : numbers[numIdx++];
                if (res === 'desert') robberHex = i; // 初始盗贼位置
                return { q: c.q, r: c.r, resource: res, number: num };
            });
            
            // 检查 6 和 8 的邻接
            validBoard = true;
            for (let i = 0; i < tempHexes.length; i++) {
                const h1 = tempHexes[i];
                if (h1.number === 6 || h1.number === 8) {
                    // 检查邻居
                    for (let d of dirs) {
                        const nKey = `${h1.q + d.q},${h1.r + d.r}`;
                        if (coordMap[nKey] !== undefined) {
                            const h2 = tempHexes[coordMap[nKey]];
                            if (h2.number === 6 || h2.number === 8) {
                                validBoard = false;
                                break;
                            }
                        }
                    }
                }
                if (!validBoard) break;
            }
            
            if (validBoard) {
                board.hexes = tempHexes;
            }
            attempts++;
        }
        
        if (!validBoard) {
            console.warn("无法在 100 次尝试中生成不相邻的 6/8 面板，使用最后一次尝试");
            // 回退：使用现有的
             let numIdx = 0;
             board.hexes = coords.map((c, i) => {
            const res = resources[i];
            const num = res === 'desert' ? null : numbers[numIdx++];
            if (res === 'desert') robberHex = i; // 初始盗贼位置
            return { q: c.q, r: c.r, resource: res, number: num };
        });
        }
        
        generateGraph();
        generatePorts();
        initDevDeck();
        renderBoardSVG(); // 构建 SVG DOM
    }
    
    function generatePorts() {
        // 港口位于地图的外边缘。
        // 标准布局第 2 圈六边形有暴露的边缘。
        // 我们有 9 个港口。
        // 港口类型: 4x '3:1', 1x 'wood', 1x 'brick', 1x 'wool', 1x 'grain', 1x 'ore'
        const portTypes = ['3:1', '3:1', '3:1', '3:1', 'wood', 'brick', 'wool', 'grain', 'ore'];
        portTypes.sort(() => Math.random() - 0.5);
        
        board.ports = [];
        
        // 边缘在周长上。
        // 我们通过检查边缘是否属于唯一的六边形来判断。
        
        const outerEdges = [];
        for (let key in board.edges) {
            const e = board.edges[key];
            // 检查有多少个六边形共享此边缘
            let hexCount = 0;
            board.hexes.forEach(hex => {
                const center = hexToPixel(hex.q, hex.r);
                const dist1 = Math.hypot(e.v1.x - center.x, e.v1.y - center.y);
                const dist2 = Math.hypot(e.v2.x - center.x, e.v2.y - center.y);
                if (dist1 < HEX_SIZE + 5 && dist2 < HEX_SIZE + 5) {
                    hexCount++;
                }
            });
            
            if (hexCount === 1) {
                outerEdges.push(e);
            }
        }
        
        // 按角度排序外边缘
        outerEdges.sort((a, b) => {
             const angleA = Math.atan2((a.v1.y + a.v2.y)/2, (a.v1.x + a.v2.x)/2);
             const angleB = Math.atan2((b.v1.y + b.v2.y)/2, (b.v1.x + b.v2.x)/2);
             return angleA - angleB;
        });
        
        // 均匀分布 9 个港口
        const step = Math.floor(outerEdges.length / 9);
        for(let i=0; i<9; i++) {
            const edge = outerEdges[i * step];
            if (edge) {
                board.ports.push({
                    edgeId: edge.id,
                    type: portTypes[i],
                    v1: edge.v1.id,
                    v2: edge.v2.id
                });
            }
        }
    }
    
    function generateGraph() {
        board.vertices = {};
        board.edges = {};
        
        board.hexes.forEach(hex => {
            const center = hexToPixel(hex.q, hex.r);
            const hexVerts = [];
            
            for(let i=0; i<6; i++) {
                const angle = Math.PI/3 * (i - 0.5);
                const vx = Math.round(center.x + HEX_SIZE * Math.cos(angle));
                const vy = Math.round(center.y + HEX_SIZE * Math.sin(angle));
                const vKey = `${vx},${vy}`; // 简单坐标键
                
                if(!board.vertices[vKey]) {
                    board.vertices[vKey] = { x: vx, y: vy, owner: null, building: null, id: vKey, adjEdges: [] };
                }
                hexVerts.push(board.vertices[vKey]);
            }
            
            // 创建边缘
            for(let i=0; i<6; i++) {
                const v1 = hexVerts[i];
                const v2 = hexVerts[(i+1)%6];
                const eKey = [v1.id, v2.id].sort().join('_');
                
                if(!board.edges[eKey]) {
                    board.edges[eKey] = { v1, v2, owner: null, id: eKey };
                    v1.adjEdges.push(eKey);
                    v2.adjEdges.push(eKey);
                }
            }
        });
    }

    function hexToPixel(q, r) {
        return {
            x: HEX_SIZE * Math.sqrt(3) * (q + r/2),
            y: HEX_SIZE * 3/2 * r
        };
    }

    function calculateLongestRoad(pid) {
        // BFS/DFS 查找 pid 拥有的最长连接边缘路径
        let maxLen = 0;
        const ownedEdges = [];
        for (let k in board.edges) {
            if (board.edges[k].owner === pid) ownedEdges.push(board.edges[k]);
        }
        
        if (ownedEdges.length === 0) return 0;

        // 转换为图
        const adj = {};
        ownedEdges.forEach(e => {
            if (!adj[e.v1.id]) adj[e.v1.id] = [];
            if (!adj[e.v2.id]) adj[e.v2.id] = [];
            adj[e.v1.id].push({ to: e.v2.id, id: e.id });
            adj[e.v2.id].push({ to: e.v1.id, id: e.id });
        });

        // DFS
        const visitedEdges = new Set();
        function dfs(u, len) {
            maxLen = Math.max(maxLen, len);
            if (!adj[u]) return;
            
            adj[u].forEach(edge => {
                if (!visitedEdges.has(edge.id)) {
                    visitedEdges.add(edge.id);
                    // 检查是否被定居点打断 (标准规则: 其他玩家的定居点打断道路)
                    const v = board.vertices[u];
                    if (v.owner !== null && v.owner !== pid) {
                        // 被阻断
                    } else {
                        dfs(edge.to, len + 1);
                    }
                    visitedEdges.delete(edge.id);
                }
            });
        }
        
        // 从所有端点开始 DFS
        for (let startNode in adj) {
            // 检查起始节点是否被阻断
            const v = board.vertices[startNode];
            if (v.owner !== null && v.owner !== pid) continue;
            
            dfs(startNode, 0);
        }
        
        return maxLen;
    }

    function updateScores() {
        // 1. 计算所有玩家的基础数据
        const stats = players.map(p => {
            // 计算 VP (建筑)
            let vp = 0;
            for (let k in board.vertices) {
                const v = board.vertices[k];
                if (v.owner === p.id) {
                    vp += (v.building === 'city' ? 2 : 1);
                }
            }
            // VP 卡 (自动生效)
            vp += p.devCards.filter(c => c.type === 'vp').length;
            
            // 最长道路
            const roadLen = calculateLongestRoad(p.id);
            p.longestRoad = roadLen;
            
            return { id: p.id, vp, roadLen, army: p.knights };
        });

        // 2. 更新最长道路持有者
        // 规则：至少 5 条。如果没人持有，谁先到 5 谁拿。
        // 如果有人持有，必须超过持有者才能抢走。
        // 如果持有者降到 5 以下（在这个版本不太可能，因为路不会被破坏，但为了严谨），则失去。
        
        let currentRoadHolder = players.find(p => p.id === longestRoadOwnerId);
        let currentMaxRoad = currentRoadHolder ? currentRoadHolder.longestRoad : 4;
        
        // 检查当前持有者是否还合格
        if (currentRoadHolder && currentRoadHolder.longestRoad < 5) {
            longestRoadOwnerId = null;
            currentRoadHolder = null;
            currentMaxRoad = 4;
        }

        // 寻找新的挑战者
        stats.forEach(s => {
            if (s.roadLen > currentMaxRoad) {
                currentMaxRoad = s.roadLen;
                longestRoadOwnerId = s.id;
            }
        });

        // 3. 更新最大军队持有者
        // 规则：至少 3 个。逻辑同上。
        let currentArmyHolder = players.find(p => p.id === largestArmyOwnerId);
        let currentMaxArmy = currentArmyHolder ? currentArmyHolder.knights : 2;

        if (currentArmyHolder && currentArmyHolder.knights < 3) {
            largestArmyOwnerId = null;
            currentArmyHolder = null;
            currentMaxArmy = 2;
        }

        stats.forEach(s => {
            if (s.army > currentMaxArmy) {
                currentMaxArmy = s.army;
                largestArmyOwnerId = s.id;
            }
        });

        // 4. 应用分数
        players.forEach((p, i) => {
            const s = stats[i];
            p.score = s.vp;
            if (longestRoadOwnerId === p.id) p.score += 2;
            if (largestArmyOwnerId === p.id) p.score += 2;
        });
        
        // 5. 检查胜利
        const targetScore = players.length === 2 ? 15 : 10;
        players.forEach(p => {
            if (p.score >= targetScore) {
                showVictory(p);
            }
        });
    }

    function showVictory(winner) {
        $('#winner-name').text(`${winner.name} 获胜!`);
        
        const scoresHtml = players.map((p, i) => {
            const isWinner = p.id === winner.id;
            return `
                <div class="flex items-center justify-between p-3 rounded-xl ${isWinner ? 'bg-orange-50 border border-orange-200' : 'bg-slate-50 border border-slate-100'}">
                    <div class="flex items-center gap-3">
                        <div class="w-3 h-3 rounded-full" style="background-color: ${getPlayerColor(p.id)}"></div>
                        <span class="font-bold ${isWinner ? 'text-orange-800' : 'text-slate-600'}">${p.name}</span>
                    </div>
                    <span class="font-bold text-xl ${isWinner ? 'text-orange-600' : 'text-slate-400'}">${p.score}</span>
                </div>
            `;
        }).join('');
        
        $('#victory-scores').html(scoresHtml);
        $('#victory-modal').removeClass('hidden');
        
        // 播放胜利音效或彩带特效（可选）
    }

    // --- 交易逻辑 ---
    function getTradeRatios(pid) {
        let ratios = { brick: 4, wood: 4, wool: 4, grain: 4, ore: 4 };
        // 遍历所有港口检查占领情况
        if (board.ports) {
            board.ports.forEach(port => {
                const v1 = board.vertices[port.v1];
                const v2 = board.vertices[port.v2];
                // 只要占据港口两端任意一个顶点即可
                if ((v1 && v1.owner === pid) || (v2 && v2.owner === pid)) {
                    if (port.type === '3:1') {
                        // 所有资源变为 3:1 (除非已有更低)
                        for (let r in ratios) {
                            ratios[r] = Math.min(ratios[r], 3);
                        }
                    } else if (ratios[port.type]) {
                        // 特定资源变为 2:1
                        ratios[port.type] = 2;
                    }
                }
            });
        }
        return ratios;
    }

    // --- 动作 & 状态更新 ---
    function doAction(action) {
        // 本地预检查
        if (action.type === 'move_robber') {
            if (turnPhase !== 'robber_move') return;
            if (currentPlayer !== myPlayerIndex && !action.isAI) {
                showToast('不是你的回合！');
                return;
            }
            if (action.hexIndex === robberHex) {
                showToast('请点击其他闪烁的黄色区域来移动盗贼！');
                return;
            }
        }
        
        // 验证建设村庄的频率 (防止连点)
        if (action.type === 'build_settlement' && setupPhase && setupState === 'road') {
             if (currentPlayer === myPlayerIndex) showToast('请先建设道路！');
             return;
        }
        
        // 关键修复：客户端验证
        // 如果是客户端，并且不是自己的回合（或者虽然是自己的回合但需要服务器确认的操作），
        // 应该发送请求而不是直接执行本地逻辑（除非是预测执行，但这里为了同步一致性，先发送后执行或等待状态）
        // 目前架构：handleAction 会在本地执行。
        // 如果是 Online 且 !isHost：
        // 1. 发送 action 到 host
        // 2. return (不要本地执行 handleAction，等待 host 的 state 广播)
        
        if (gameMode === 'online' && !isHost) {
            // 特殊：响应交易不需要是当前回合玩家 (但必须是目标)
            if (action.type === 'trade_response') {
                 if (hostConn) hostConn.send(action);
                 return;
            }
            
            // 检查是否是我的回合
            if (currentPlayer !== myPlayerIndex) {
                showToast('不是你的回合！');
                return;
            }

            // 发送给主机
            if (hostConn) {
                if (hostConn.open) {
                    try {
                        log(`[客户端] 发送动作给房主 ID: ${hostConn.peer}`, action);
                        hostConn.send(action);
                        log('[客户端] 动作发送 API 调用成功。');
                    } catch (e) {
                        console.error('[客户端] 发送动作失败:', e);
                        showToast('发送失败: ' + e.message);
                    }
                } else {
                    console.error('[客户端] 动作未发送: 房主连接已关闭或未开启!', hostConn);
                    showToast('无法连接到房主 (ID: ' + hostConn.peer + ')，请刷新重连');
                }
            } else {
                console.error('[客户端] 动作未发送: 无房主连接对象!');
                showToast('未连接到房间');
            }
            
            // 客户端不立即执行 handleAction，而是等待主机广播新的 state
            // 这样可以避免状态不一致（例如资源扣除了但主机没确认）
            // 唯一的例外是 UI 反馈（如点击按钮变色），但这由 UI 逻辑处理
            return;
        }
        
        // ... Host Logic ...
        
        // 主机 (或本地 AI) 处理逻辑
        // 如果我是主机，且收到 trade_response，我需要知道是谁发的
        if (action.type === 'trade_response' && !action.responder) {
            action.responder = myPlayerIndex; // 标记响应者
        }
        
        if (gameMode === 'online' && !isHost && action.type === 'trade_response') {
             if (hostConn) hostConn.send(action);
             return;
        }
        
        // 主机 (或本地 AI) 处理逻辑
            Promise.resolve(handleAction(action)).then((result) => {
                // 检查操作结果
                if (result === false || (typeof result === 'object' && result.success === false)) {
                    const reason = (result && result.reason) ? result.reason : '验证失败';
                    log(`[doAction] 操作被拒绝: ${action.type}, 原因: ${reason}`);
                    
                    // 如果是 AI 操作失败，尝试重新触发或跳过 (避免死循环)
                    const currentP = players[currentPlayer];
                    if (isHost && currentP && currentP.isAI && action.isAI) {
                        log(`[doAction] AI 操作失败，尝试恢复...`);
                        // 简单策略：如果是随机选点失败，可能是因为并发或其他原因，稍后重试
                        // 但如果是逻辑错误，重试也没用。
                        // 暂时不重试，以免死循环刷屏。
                    }
                    return;
                }

                // 如果是主机则同步状态
                if (gameMode === 'online' && isHost) {
                    broadcastState({ lastAction: action });
                }

                // Host needs to play effects and update UI too since it doesn't receive its own broadcast
                if (isHost || gameMode === 'ai') {
                    playActionEffect(action);
                    updateUI();
                }

                // 触发 AI
                const currentP = players[currentPlayer];
                if (isHost && currentP && currentP.isAI) {
                    log(`[doAction] 触发 AI 回合 (玩家 ${currentPlayer})`);
                    setTimeout(aiTurn, 1500); 
                }
            }).catch(err => {
            console.error("执行操作出错:", err);
            // 尝试广播当前状态以恢复同步（即使出错）
            if (gameMode === 'online' && isHost) {
                 broadcastState({ type: 'error_recovery' });
            }
        });
    }
    
    async function handleAction(action) {
        log('处理动作 (Start):', action);
        // 播放相关动作的音效
        if (['build_road', 'build_settlement', 'build_city', 'buy_dev_card'].includes(action.type)) playSound('build');
        if (action.type === 'roll') playSound('dice');
        if (action.type === 'end_turn') playSound('turn');
        
        const p = players[currentPlayer];
        log(`当前玩家: ${p ? p.name : '未知'} (索引: ${currentPlayer})`);
        
        // 处理交易请求 (对所有玩家可见，但只有目标玩家需要弹窗)
        if (action.type === 'trade_offer') {
            const senderId = action.from !== undefined ? action.from : currentPlayer; // 回退到 currentPlayer 以兼容旧代码
            
            if (myPlayerIndex === action.target) {
                // 我是被请求的玩家
                const sender = players[senderId];
                currentOffer = {
                    id: Date.now() + Math.random(),
                    from: senderId,
                    give: action.give, // 发起者给出的
                    get: action.get    // 发起者想要的
                };
                
                // 构建 UI 文本
                $('#offer-sender').text(sender.name);
                
                // 注意：对于接收者来说，sender 给出的(give)是接收者获得的，sender 想要的(get)是接收者失去的
                let gainText = '';
                for(let k in action.give) {
                    if (action.give[k] > 0) gainText += `${RESOURCE_NAMES[k]} x${action.give[k]} `;
                }
                $('#offer-get').text(gainText || '无');

                let loseText = '';
                for(let k in action.get) {
                    if (action.get[k] > 0) loseText += `${RESOURCE_NAMES[k]} x${action.get[k]} `;
                }
                $('#offer-give').text(loseText || '无');
                
                // 检查是否有足够的资源接受交易
                let canAccept = true;
                const me = players[myPlayerIndex];
                for(let k in action.get) {
                    if (me.resources[k] < action.get[k]) canAccept = false;
                }
                
                $('#btn-accept-offer').prop('disabled', !canAccept).text(canAccept ? '接受交易' : '资源不足');
                $('#trade-offer-modal').removeClass('hidden');
            } else if (gameMode === 'ai') {
                // AI 响应逻辑
                // 这里的 action.target 是目标玩家 index (在 AI 模式下，id 和 index 一致)
                // 检查目标是否是 AI
                const targetP = players[action.target];
                if (targetP && targetP.isAI) {
                     setTimeout(() => {
                        doAction({
                            type: 'trade_response',
                            offerId: Date.now(), // 伪造 ID
                            from: senderId, // 原始发起者 (人类)
                            responder: action.target, // AI 玩家 ID
                            accept: true,
                            give: action.give,
                            get: action.get
                        });
                    }, 1000); // 1秒延迟模拟思考
                }
            }
            return; // 仅仅是 UI 更新，不改变游戏状态
        }
        else if (action.type === 'trade_response') {
            if (action.accept) {
                // 执行交易
                // action.from 是发起请求的人 (sender)
                // action.responder 是响应者
                
                // 我们需要找到他们在 players 数组中的索引，因为 executeTrade 使用索引 (或者我们修改 executeTrade)
                // executeTrade 目前期望 ID (index)
                // 在新架构下，ID 是字符串。
                // 让我们修改 executeTrade 以接受 index，或者查找 index
                
                let senderIdx = typeof action.from === 'number' ? action.from : players.findIndex(p => p.id === action.from);
                // 兼容旧代码，如果 from 是 index
                if (senderIdx === -1 && typeof action.from === 'number') senderIdx = action.from;

                let responderIdx = typeof action.responder === 'number' ? action.responder : players.findIndex(p => p.id === action.responder);
                if (responderIdx === -1 && typeof action.responder === 'number') responderIdx = action.responder;

                if (senderIdx !== -1 && responderIdx !== -1) {
                    executeTrade(senderIdx, responderIdx, action.give, action.get);
                    showToast(`交易达成！`);
                } else {
                    console.error("交易失败: 找不到玩家", action);
                }
            } else {
                // 拒绝由 playActionEffect UI 更新处理
            }
            return;
        }

        if (action.type === 'roll') {
            if (turnPhase !== 'roll') return;
            
            // 产生两个骰子
            dice1 = Math.floor(Math.random()*6) + 1;
            dice2 = Math.floor(Math.random()*6) + 1;
            diceVal = dice1 + dice2;
            
            // 显示动画
            await new Promise(resolve => {
                showDiceAnimation(dice1, dice2, () => {
                    if (diceVal !== 7) {
                        distributeResources(diceVal);
                        turnPhase = 'build';
                    } else {
                        // 盗贼逻辑
                        players.forEach(pl => {
                            const total = Object.values(pl.resources).reduce((a,b)=>a+b,0);
                            if (total > 7) {
                                const lose = Math.floor(total / 2);
                                for(let i=0; i<lose; i++) {
                                    const available = Object.keys(pl.resources).filter(k => pl.resources[k] > 0);
                                    if (available.length > 0) {
                                        const r = available[Math.floor(Math.random()*available.length)];
                                        pl.resources[r]--;
                                    }
                                }
                                if (pl.id === myPlayerIndex) showToast(`你手牌过多，丢弃了 ${lose} 张资源卡！`);
                            }
                        });
                        
                        turnPhase = 'robber_move';
                        if (currentPlayer === myPlayerIndex) {
                            showToast('请移动盗贼！(点击闪烁的黄色区域)');
                            // 更新状态指示器
                            $('#status-text').text("请点击黄色区域移动盗贼");
                        }
                    }
                    updateUI();
                    resolve();
                });
            });
            return true; // Add return true for roll action
        }
        else if (action.type === 'move_robber') {
            if (turnPhase !== 'robber_move') return false;
            if (action.hexIndex === robberHex) {
                if (currentPlayer === myPlayerIndex) showToast('请点击其他闪烁的黄色区域来移动盗贼！');
                return false;
            }
            
            robberHex = action.hexIndex;
            
            // 确定可抢劫的玩家
            const hex = board.hexes[robberHex];
            const center = hexToPixel(hex.q, hex.r);
            const victims = new Set();
            
            for(let key in board.vertices) {
                const v = board.vertices[key];
                if (v.owner !== null && v.owner !== currentPlayer) {
                    const dist = Math.hypot(v.x - center.x, v.y - center.y);
                    if (dist < HEX_SIZE + 5) {
                        victims.add(v.owner);
                    }
                }
            }
            
            const victimList = Array.from(victims);
            if (victimList.length === 0) {
                turnPhase = 'build';
            } else if (victimList.length === 1) {
                stealFrom(victimList[0]);
                turnPhase = 'build';
            } else {
                // 对于 AI，随机。对于人类，提示。
                // 简化：目前总是随机/第一个以避免阻塞
                stealFrom(victimList[0]);
                turnPhase = 'build';
            }
            
            const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
            broadcastLog(`${pName} 移动了盗贼`);
            
            updateUI();
            return true;
        }
        else if (action.type === 'end_turn') {
            if (turnPhase === 'roll') return false; 
            if (setupPhase) return false; 

            // 重置当前玩家的回合标志
            const p = players[currentPlayer];
            p.devCards.forEach(c => c.boughtThisTurn = false);
            p.freeRoads = 0; // 重置未使用的免费道路
            playedDevCardThisTurn = false;
            
            const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
            broadcastLog(`${pName} 结束了回合`);

            currentPlayer = (currentPlayer + 1) % players.length;
            turnPhase = 'roll';
            
            updateUI();
            return true;
        }
        else if (action.type === 'build_settlement') {
            log('处理建设村庄:', action.id);
            const v = board.vertices[action.id];
            if (!v) {
                console.warn(`建设失败: 顶点 ${action.id} 未找到`);
                return { success: false, reason: `顶点 ${action.id} 未找到` };
            }
            if (v.owner !== null) {
                console.warn(`建设失败: 顶点 ${action.id} 已被 ${v.owner} 占用`);
                return { success: false, reason: '此位置已被占用' };
            }
            
            // 检查成本和规则
            if (!setupPhase) {
                if (turnPhase !== 'build') {
                    console.warn(`建设失败: 错误的阶段 ${turnPhase}`);
                    return { success: false, reason: '当前不是建设阶段' };
                }
                if (!canAfford(p, 'settlement')) {
                    console.warn(`建设失败: 无法支付村庄费用`);
                    return { success: false, reason: '资源不足' };
                }
                if (!checkConnectivity(v, p.id)) { 
                    console.warn(`建设失败: 在 ${action.id} 处无连接为 ${p.id}`);
                    showToast('必须连接道路！'); 
                    return { success: false, reason: '必须连接道路' }; 
                }
            } else {
                // 初始阶段逻辑
                if (setupState !== 'settlement') { 
                    console.warn(`建设失败: 错误的初始状态 ${setupState}`);
                    showToast('请先建设道路！'); 
                    return { success: false, reason: '初始阶段顺序错误：请先建设道路' }; 
                }
                if (turnPhase !== 'build_setup') {
                    console.warn(`建设失败: 错误的阶段 ${turnPhase}`);
                    return { success: false, reason: '游戏阶段错误' };
                }
            }

            // 距离规则适用于所有阶段
            if (!checkDistanceRule(v)) { 
                console.warn(`建设失败: 在 ${action.id} 处违反距离规则`);
                showToast('距离太近！'); 
                return { success: false, reason: '距离太近，违反规则' }; 
            }
            
            if (!setupPhase) payCost(p, 'settlement');
            v.owner = p.id;
            v.building = 'settlement';
            p.score += 1;
            
            log('村庄建设成功:', v);
            
            const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
            broadcastLog(`${pName} 建设了 <span class="font-bold text-slate-700">村庄</span>`);

            if (setupPhase) {
                lastBuiltSettlement = v.id;
                setupState = 'road'; // 下一步必须是道路
                
                // 在初始阶段 2 (第二轮)，立即给予资源
                if (setupTurn >= players.length) {
                    giveInitialResources(v, p);
                }
                
                // 广播日志：提示当前玩家建路
                broadcastLog(`请 ${pName} 继续建设 <span class="font-bold text-slate-700">道路</span>`);
            }
            
            updateScores();
            updateUI();
            return true;
        }
    else if (action.type === 'build_road') {
            const e = board.edges[action.id];
            if (!e || e.owner !== null) return false;
            
            if (!setupPhase) {
                if (turnPhase !== 'build') return false;
                if (p.freeRoads > 0) {
                    // Allowed
                } else if (!canAfford(p, 'road')) return false;
            } else {
                 if (turnPhase !== 'build_setup') return false;
                 if (setupState !== 'road') { showToast('请先建设村庄！'); return false; }
                 
                 // 严格的初始规则：必须连接刚才建立的定居点
                 if (e.v1.id !== lastBuiltSettlement && e.v2.id !== lastBuiltSettlement) {
                     showToast('必须连接刚才建立的定居点！');
                     return false;
                 }
            }

            if (!setupPhase && !checkRoadConnectivity(e, p.id)) { showToast('必须连接自己的建筑或道路！'); return false; }
            
            let isFree = false;
            if (!setupPhase) {
                if (p.freeRoads > 0) {
                    p.freeRoads--;
                    isFree = true;
                } else {
                    payCost(p, 'road');
                }
            }
            e.owner = p.id;

            const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
            const costText = isFree ? ' (免费)' : '';
            broadcastLog(`${pName} 建设了 <span class="font-bold text-slate-700">道路</span>${costText}`);
            
            if (setupPhase) {
                // 推进初始回合
                setupState = 'settlement'; // 为下一个玩家重置
                setupTurn++;
                
                if (setupTurn < players.length) {
                    currentPlayer = setupTurn;
                } else if (setupTurn < players.length * 2) {
                    currentPlayer = (players.length * 2 - 1) - setupTurn;
                } else {
                    // 结束初始阶段
                    setupPhase = false;
                    currentPlayer = 0;
                    turnPhase = 'roll';
                    setupState = null;
                    
                    // 广播日志
                    broadcastLog("初始阶段结束，游戏正式开始！");
                    const nextP = players[currentPlayer];
                    broadcastLog(`请 <span class='font-bold' style='color:${getPlayerColor(nextP.id)}'>${nextP.name}</span> 掷骰子`);
                    updateScores();
                    updateUI();
                    return true;
                }
                turnPhase = 'build_setup';
                lastBuiltSettlement = null;
                
                const nextP = players[currentPlayer];
                broadcastLog(`轮到 <span class='font-bold' style='color:${getPlayerColor(nextP.id)}'>${nextP.name}</span> 建设定居点`);
            }
            
            updateScores();
            updateUI();
            return true;
        }
    else if (action.type === 'build_city') {
            if (setupPhase) return false;
            const v = board.vertices[action.id];
            if (!v || v.owner !== p.id || v.building !== 'settlement') return false;
            if (!canAfford(p, 'city')) return false;
            
            payCost(p, 'city');
            v.building = 'city';
            p.score += 1; 
            
            const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
            broadcastLog(`${pName} 建设了 <span class="font-bold text-slate-700">城市</span>`);
            
            updateScores();
            updateUI();
            return true;
        }
        else if (action.type === 'trade_bank') {
            if (turnPhase !== 'build') return false;
            const give = action.give;
            const get = action.get;
            
            const ratios = getTradeRatios(p.id);
            const cost = ratios[give];
            
            if (p.resources[give] >= cost) {
                p.resources[give] -= cost;
                p.resources[get] += 1;
                if (p.id === myPlayerIndex) showToast(`交易成功：${cost} ${RESOURCE_NAMES[give]} -> 1 ${RESOURCE_NAMES[get]}`);
                
                const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
                broadcastLog(`${pName} 与 <span class="text-blue-600 font-bold">银行</span> 进行了交易`);
            } else {
                return false;
            }
            
            updateUI();
            return true;
        }
        else if (action.type === 'buy_dev_card') {
            if (turnPhase !== 'build') return false;
            if (!canAfford(p, 'dev')) return false;
            if (devDeck.length === 0) {
                showToast('发展卡已售罄');
                return false;
            }
            
            payCost(p, 'dev');
            const cardType = devDeck.pop();
            p.devCards.push({ type: cardType, boughtThisTurn: true });
            
            const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
            broadcastLog(`${pName} 购买了一张 <span class="font-bold text-slate-700">发展卡</span>`);
            
            updateScores(); // 立即更新分数 (如果是 VP 卡)
            updateUI();
            if (currentPlayer === myPlayerIndex) updateDevModal();
            return true;
        }
        else if (action.type === 'play_dev_card') {
             const cardIdx = p.devCards.findIndex(c => c.type === action.cardType && !c.boughtThisTurn);
             if (cardIdx === -1) return false;
             if (playedDevCardThisTurn) return false;
             
             p.devCards.splice(cardIdx, 1);
             playedDevCardThisTurn = true;
             
             const pName = `<span style="color:${getPlayerColor(p.id)}" class="font-bold">${p.name}</span>`;
             
             if (action.cardType === 'knight') {
                 p.knights++;
                 turnPhase = 'robber_move';
                 broadcastLog(`${pName} 使用了 <span class="font-bold text-slate-800">骑士卡</span>`);
                 updateScores();
             }
             else if (action.cardType === 'road_building') {
                 p.freeRoads = 2;
                 currentBuildMode = 'road';
                 broadcastLog(`${pName} 使用了 <span class="font-bold text-green-600">道路建设卡</span>`);
                 showToast('免费建设2条道路！');
                 updateHints();
             }
             else if (action.cardType === 'year_of_plenty') {
                 if (!Array.isArray(action.resources)) return false;
                 const validRes = ['brick', 'wood', 'wool', 'grain', 'ore'];
                 action.resources.forEach(r => {
                     if (validRes.includes(r)) p.resources[r]++;
                 });
                 broadcastLog(`${pName} 使用了 <span class="font-bold text-yellow-600">丰收之年</span>`);
             }
             else if (action.cardType === 'monopoly') {
                 const res = action.resource;
                 const validRes = ['brick', 'wood', 'wool', 'grain', 'ore'];
                 if (!validRes.includes(res)) return false;
                 
                 let totalStolen = 0;
                 players.forEach(other => {
                     if (other.id !== p.id) {
                         const amount = other.resources[res] || 0;
                         other.resources[res] = 0;
                         p.resources[res] += amount;
                         totalStolen += amount;
                     }
                 });
                 broadcastLog(`${pName} 使用了 <span class="font-bold text-purple-600">垄断</span> (获得 ${totalStolen} ${RESOURCE_NAMES[res]})`);
             }
             
             updateUI();
             return true;
        }
    }
    
    // --- 骰子动画 ---
    function showDiceAnimation(final1, final2, callback) {
        const resultContainer = $('#dice-result');
        const die1 = $('#die-1');
        const die2 = $('#die-2');
        const total = $('#dice-total');
        
        // 重置按钮状态
        const btn = $('#btn-roll');
        btn.prop('disabled', false).removeClass('opacity-75 cursor-wait');
        btn.find('span').last().text('掷骰子');
        
        // 显示容器
        resultContainer.removeClass('hidden').addClass('flex');
        
        // 移除旧的动画类（如果存在）
        die1.removeClass('animate-bounce');
        die2.removeClass('animate-bounce');
        
        let count = 0;
        const maxCount = 10; // 动画跳动次数
        const interval = setInterval(() => {
            // 随机数字
            die1.text(Math.floor(Math.random()*6) + 1);
            die2.text(Math.floor(Math.random()*6) + 1);
            total.text('...');
            
            count++;
            if (count >= maxCount) {
                clearInterval(interval);
                
                // 设置最终值
                die1.text(final1);
                die2.text(final2);
                total.text(`= ${final1 + final2}`);
                
                // 红色高亮 7 点
                if (final1 + final2 === 7) {
                    total.addClass('text-red-500').removeClass('text-slate-500');
                } else {
                    total.removeClass('text-red-500').addClass('text-slate-500');
                }
                
                if (callback) callback();
            }
        }, 80); // 80ms 变换一次
    }

    function giveInitialResources(v, p) {
        // 查找相邻的六边形
        board.hexes.forEach(hex => {
            const center = hexToPixel(hex.q, hex.r);
            const dist = Math.hypot(v.x - center.x, v.y - center.y);
            if (dist < HEX_SIZE + 5 && hex.resource !== 'desert') {
                p.resources[hex.resource] += 1;
            }
        });
    }
    
    function stealFrom(victimId) {
        // victimId 可能是索引或 ID
        const victimIdx = (typeof victimId === 'number') ? victimId : players.findIndex(p => p.id === victimId);
        if (victimIdx === -1) return;
        
        const victim = players[victimIdx];
        const thief = players[currentPlayer];
        
        const available = Object.keys(victim.resources).filter(k => victim.resources[k] > 0);
        if (available.length === 0) {
            if (currentPlayer === myPlayerIndex) showToast(`玩家 ${victim.name} 没有资源可抢！`);
            return;
        }
        
        // 随机抢夺
        const hand = [];
        for (let r in victim.resources) {
            for(let i=0; i<victim.resources[r]; i++) hand.push(r);
        }
        
        const stolenRes = hand[Math.floor(Math.random() * hand.length)];
        victim.resources[stolenRes]--;
        thief.resources[stolenRes]++;
        
        if (currentPlayer === myPlayerIndex) showToast(`你抢到了 ${RESOURCE_NAMES[stolenRes] || stolenRes}！`);
    }

    function distributeResources(num) {
        let gained = {};
        board.hexes.forEach((hex, i) => {
            // 盗贼阻断生产
            if (i === robberHex) return; 
            
            if (hex.number === num && hex.resource !== 'desert') {
                const center = hexToPixel(hex.q, hex.r);
                for(let key in board.vertices) {
                    const v = board.vertices[key];
                    if (v.owner !== null) {
                        const dist = Math.hypot(v.x - center.x, v.y - center.y);
                        if (dist < HEX_SIZE + 5) { // 是这个六边形的角
                            // v.owner 可能是 ID，需要找到对应玩家
                            const pIdx = players.findIndex(p => p.id === v.owner);
                            if (pIdx !== -1) {
                                const amount = v.building === 'city' ? 2 : 1;
                                players[pIdx].resources[hex.resource] += amount;
                                
                                // 记录玩家获得的资源
                                if (players[pIdx].id === myId) {
                                    if (!gained[hex.resource]) gained[hex.resource] = 0;
                                    gained[hex.resource] += amount;
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // 显示获得资源提示
        if (Object.keys(gained).length > 0) {
            let msg = '获得资源: ';
            for(let res in gained) {
                msg += `${RESOURCE_NAMES[res] || res} x${gained[res]} `;
            }
            showToast(msg);
        }
    }
    
    function checkDistanceRule(v) {
        for (let eKey of v.adjEdges) {
            const edge = board.edges[eKey];
            const otherV = edge.v1 === v ? edge.v2 : edge.v1;
            if (otherV.owner !== null) return false;
        }
        return true;
    }
    
    function checkConnectivity(v, pid) {
        for (let eKey of v.adjEdges) {
            const edge = board.edges[eKey];
            if (edge.owner === pid) return true;
        }
        return false;
    }
    
    function checkRoadConnectivity(edge, pid) {
        const ends = [edge.v1, edge.v2];
        for (let v of ends) {
            if (v.owner === pid) return true;
            for (let adjKey of v.adjEdges) {
                if (adjKey === edge.id) continue;
                if (board.edges[adjKey].owner === pid) return true;
            }
        }
        return false;
    }
    
    function canAfford(p, type) {
        const cost = COSTS[type];
        if (!cost) return true; // Should not happen
        for (let res in cost) {
            if (p.resources[res] < cost[res]) return false;
        }
        return true;
    }
    
    function getMissingResources(p, type) {
        const cost = COSTS[type];
        const missing = [];
        for (let res in cost) {
            if (p.resources[res] < cost[res]) {
                missing.push(`${RESOURCE_NAMES[res]}x${cost[res] - p.resources[res]}`);
            }
        }
        return missing.join(' ');
    }

    function payCost(p, type) {
        const cost = COSTS[type];
        for (let res in cost) {
            p.resources[res] -= cost[res];
        }
    }
    
    // --- AI ---
    function executeTrade(senderId, receiverId, give, get) {
        const sender = players[senderId];
        const receiver = players[receiverId];
        
        // 验证双方资源是否足够 (虽然 UI 检查过，但为了安全)
        for(let k in give) {
            if (sender.resources[k] < give[k]) return false;
        }
        for(let k in get) {
            if (receiver.resources[k] < get[k]) return false;
        }
        
        // 执行交换
        // 发起者: 给 -> 接收者
        // 接收者: 拿 -> 发起者
        // 注意：give 是 sender 给出的。
        
        for(let k in give) {
            sender.resources[k] -= give[k];
            receiver.resources[k] += give[k];
        }
        
        for(let k in get) {
            receiver.resources[k] -= get[k];
            sender.resources[k] += get[k];
        }
        
        updateUI();
        return true;
    }
    
    function aiTurn() {
        // AI check logic
        const currentP = players[currentPlayer];
        if (!currentP || !currentP.isAI) return;
        
        // Host controls all AI in online mode
        if (gameMode === 'online' && !isHost) return;
        
        // In local mode, we control AI if it's not our turn? 
        // No, in local PvAI, there is only one human (myPlayerIndex), so if currentPlayer != myPlayerIndex, it's AI.
        // But for consistency:
        if (gameMode !== 'online' && currentPlayer === myPlayerIndex) return;

        log("AI 回合开始:", currentPlayer, turnPhase, setupPhase);
        
        if (setupPhase) {
            // 初始阶段逻辑
            setTimeout(() => {
                try {
                    log("AI 执行初始阶段操作...", setupState);
                    if (setupState === 'settlement') {
                        // 选择随机有效顶点
                        const validKeys = [];
                        for(let k in board.vertices) {
                            const v = board.vertices[k];
                            if (v.owner === null && checkDistanceRule(v)) {
                                validKeys.push(k);
                            }
                        }
                        
                        log(`AI 可选定居点数量: ${validKeys.length}`);
                        
                        if (validKeys.length > 0) {
                            const k = validKeys[Math.floor(Math.random() * validKeys.length)];
                            log(`AI 选择定居点: ${board.vertices[k].id}`);
                            doAction({ type: 'build_settlement', id: board.vertices[k].id, isAI: true });
                        } else {
                            log("AI 警告: 无有效的定居点位置！");
                        }
                    } else if (setupState === 'road') {
                        // 从 lastBuiltSettlement 建设道路
                        log(`AI 尝试建设道路 (setupPhase), lastBuiltSettlement: ${lastBuiltSettlement}`);
                        if (!lastBuiltSettlement) {
                            log("AI 错误: lastBuiltSettlement 为空");
                            // 尝试恢复：如果当前玩家有定居点但没路，找那个定居点
                            // 但这里必须是刚建的。
                            // 也许是因为上一轮 set 没成功？
                            return;
                        }

                        const v = board.vertices[lastBuiltSettlement]; 
                        if (v) {
                            const validEdges = [];
                            v.adjEdges.forEach(eid => {
                                const edge = board.edges[eid];
                                if (edge.owner === null) {
                                    // 双重检查，防止 doAction 拒绝
                                    validEdges.push(eid);
                                }
                            });
                            
                            log(`AI 可选道路数量: ${validEdges.length} (围绕顶点 ${v.id})`);
                            
                            if (validEdges.length > 0) {
                                const ek = validEdges[Math.floor(Math.random() * validEdges.length)];
                                log(`AI 选择道路: ${board.edges[ek].id}`);
                                doAction({ type: 'build_road', id: board.edges[ek].id, isAI: true });
                            } else {
                                log("AI 警告: 无有效的道路位置！");
                            }
                        } else {
                            log("AI 错误: 找不到最后建设的定居点顶点对象");
                        }
                    }
                } catch (e) {
                    console.error("AI 初始阶段执行错误:", e);
                }
            }, 1000);
            return;
        }
        
        if (turnPhase === 'roll') {
            setTimeout(() => doAction({ type: 'roll' }), 1000);
            return;
        }
        
        if (turnPhase === 'robber_discard') {
             // 假设 AI 已经在 handleAction 中自动丢弃
        }
        
        if (turnPhase === 'robber_move') {
             setTimeout(() => {
                 try {
                     // 选择随机六边形 != robberHex
                     let target = robberHex;
                     let attempts = 0;
                     while(target === robberHex && attempts < 20) {
                         target = Math.floor(Math.random() * board.hexes.length);
                         attempts++;
                     }
                     doAction({ type: 'move_robber', hexIndex: target, isAI: true });
                 } catch (e) {
                     console.error("AI 移动强盗错误:", e);
                 }
             }, 1000);
             return;
        }
        
        if (turnPhase === 'build') {
            // 简单 AI: 如果买得起就建设，否则结束回合
            setTimeout(() => {
                try {
                    const p = players[currentPlayer];
                    let acted = false;
                    
                    // 尝试建设城市
                    if (canAfford(p, 'city')) {
                        for(let k in board.vertices) {
                            const v = board.vertices[k];
                            if (v.owner === p.id && v.building === 'settlement') {
                                log(`AI 建设城市: ${v.id}`);
                                doAction({ type: 'build_city', id: v.id, isAI: true });
                                acted = true;
                                break;
                            }
                        }
                    }
                    
                    // 尝试建设村庄
                    if (!acted && canAfford(p, 'settlement')) {
                        // 查找连接到道路的有效点
                        for(let k in board.vertices) {
                            const v = board.vertices[k];
                            if (v.owner === null && checkDistanceRule(v) && checkConnectivity(v, p.id)) {
                                 log(`AI 建设村庄: ${v.id}`);
                                 doAction({ type: 'build_settlement', id: v.id, isAI: true });
                                 acted = true;
                                 break;
                            }
                        }
                    }
                    
                    // 尝试建设道路
                    if (!acted && canAfford(p, 'road')) {
                         // 查找有效边缘
                         for(let k in board.edges) {
                             const e = board.edges[k];
                             if (e.owner === null && checkRoadConnectivity(e, p.id)) {
                                 log(`AI 建设道路: ${e.id}`);
                                 doAction({ type: 'build_road', id: e.id, isAI: true });
                                 acted = true;
                                 break;
                             }
                         }
                    }
                    
                    // 总是最终结束回合
                    setTimeout(() => doAction({ type: 'end_turn', isAI: true }), 500);
                } catch (e) {
                    console.error("AI 建设阶段错误:", e);
                    setTimeout(() => doAction({ type: 'end_turn' }), 500);
                }
            }, 1000);
        }
    }

    // --- SVG 渲染 ---
    function renderBoardSVG() {
        const layer = document.getElementById('game-layer');
        layer.innerHTML = ''; // 清除
        
        // 分层组
        const gHexes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const gEdges = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const gVertices = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const gRobberLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        // 绘制六边形
        board.hexes.forEach((hex, i) => {
            const center = hexToPixel(hex.q, hex.r);
            const gHex = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            gHex.setAttribute('transform', `translate(${center.x}, ${center.y})`);
            
            // 带有剪切路径的图像
            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', RESOURCE_IMAGES[hex.resource]);
            img.setAttribute('x', -HEX_SIZE);
            img.setAttribute('y', -HEX_SIZE);
            img.setAttribute('width', HEX_SIZE * 2);
            img.setAttribute('height', HEX_SIZE * 2);
            img.setAttribute('clip-path', 'url(#hex-clip)');
            img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
            gHex.appendChild(img);

            // 边框多边形
            let points = "";
            for(let i=0; i<6; i++) {
                const angle = Math.PI/3 * (i - 0.5);
                const x = HEX_SIZE * Math.cos(angle);
                const y = HEX_SIZE * Math.sin(angle);
                points += `${x},${y} `;
            }
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', points);
            poly.setAttribute('class', 'hex-poly');
            poly.setAttribute('fill', 'none'); // 透明填充，仅边框
            gHex.appendChild(poly);
            
            // 数字标记
            if (hex.number) {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('r', 18);
                circle.setAttribute('class', 'hex-number');
                gHex.appendChild(circle);
                
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('y', 1); // 垂直微调
                text.setAttribute('class', 'hex-text');
                text.setAttribute('fill', (hex.number===6 || hex.number===8) ? '#d00' : '#000');
                text.textContent = hex.number;
                gHex.appendChild(text);
            }

            // 盗贼
            if (i === robberHex) {
                const robberGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                robberGroup.setAttribute('transform', `translate(${center.x}, ${center.y})`);
                
                // 1. 基础圆 (移除黑底，仅保留阴影或无)
                // 使用 emoji 不需要圆底
                
                // 2. Emoji 文本 "😈"
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.textContent = '😈';
                text.setAttribute('x', 0);
                text.setAttribute('y', -20); // 向上移动，位于数字上方
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('font-size', '40px'); // 更大的尺寸
                text.setAttribute('style', 'filter: drop-shadow(0px 2px 2px rgba(0,0,0,0.5));'); // 阴影
                robberGroup.appendChild(text);

                // 3. 上方浮动标签 (可选，但有助于可见性)
                // 移除 "当前位置" 标签，保持简洁，或者保留但调整位置
                /*
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.textContent = '当前位置';
                label.setAttribute('y', '-32');
                ...
                */

                // 指针事件 none 以允许点击下方的六边形 (虽然通常我们点击其他六边形)
                robberGroup.setAttribute('style', 'pointer-events: none; user-select: none;'); 
                
                gRobberLayer.appendChild(robberGroup);
            }
            
            // 移动盗贼的交互
            if (turnPhase === 'robber_move') {
                const hitHex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                hitHex.setAttribute('points', points);
                hitHex.setAttribute('fill', 'transparent');
                hitHex.setAttribute('class', 'interactive cursor-pointer');
                
                const handleRobberClick = (evt) => {
                    if (evt.type === 'touchstart') evt.preventDefault();
                    doAction({ type: 'move_robber', hexIndex: i });
                };
                
                hitHex.onclick = handleRobberClick;
                hitHex.ontouchstart = handleRobberClick;
                
                gHex.appendChild(hitHex);
                
                // 高亮有效目标 (非当前盗贼位置)
                if (i !== robberHex) {
                    poly.setAttribute('stroke', '#fbbf24'); // Amber-400
                    poly.setAttribute('stroke-width', '6');
                    poly.setAttribute('stroke-dasharray', '10,5');
                    
                    // 在中心上方添加视觉提示 (避免遮挡数字)
                    const hint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    hint.setAttribute('r', 12);
                    hint.setAttribute('cy', -35); // 向上偏移，避开中心数字，对应盗贼位置
                    hint.setAttribute('fill', '#fbbf24');
                    hint.setAttribute('opacity', '0.8');
                    hint.setAttribute('class', 'animate-pulse pointer-events-none');
                    gHex.appendChild(hint);
                } else {
                    // 高亮当前盗贼位置显示 "来源"
                    poly.setAttribute('stroke', '#ef4444'); // Red-500
                    poly.setAttribute('stroke-width', '4');
                }
            }
            
            gHexes.appendChild(gHex);
        });
        
        // 绘制带有点击区域的边缘
        for (let key in board.edges) {
            const e = board.edges[key];
            const gEdge = document.createElementNS('http://www.w3.org/2000/svg', 'g');

            // 计算角度和中心
            const midX = (e.v1.x + e.v2.x) / 2;
            const midY = (e.v1.y + e.v2.y) / 2;
            const angle = Math.atan2(e.v2.y - e.v1.y, e.v2.x - e.v1.x) * 180 / Math.PI;

            // 视觉道路图标 (初始隐藏)
            const roadIcon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            roadIcon.setAttribute('d', ICON_PATHS.road);
            roadIcon.setAttribute('id', `edge-icon-${key}`);
            roadIcon.setAttribute('class', 'edge-icon');
            roadIcon.setAttribute('transform', `translate(${midX}, ${midY}) rotate(${angle})`);
            roadIcon.setAttribute('fill', 'none');
            roadIcon.setAttribute('stroke', 'none');
            roadIcon.style.display = 'none';
            gEdge.appendChild(roadIcon);

            // 视觉线 (虚线提示线)
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', e.v1.x);
            line.setAttribute('y1', e.v1.y);
            line.setAttribute('x2', e.v2.x);
            line.setAttribute('y2', e.v2.y);
            line.setAttribute('id', `edge-${key}`);
            line.setAttribute('class', 'edge-line');
            gEdge.appendChild(line);

            // 影子图标 (用于建设预览)
            const shadowLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            shadowLine.setAttribute('d', ICON_PATHS.road);
            shadowLine.setAttribute('id', `edge-shadow-${key}`);
            shadowLine.setAttribute('transform', `translate(${midX}, ${midY}) rotate(${angle})`);
            shadowLine.setAttribute('fill', 'rgba(0,0,0,0.5)'); // 黑色透明
            shadowLine.setAttribute('stroke', 'none');
            shadowLine.style.display = 'none'; // 默认隐藏
            shadowLine.style.pointerEvents = 'none'; // 确保不阻挡点击
            gEdge.appendChild(shadowLine);

            // 点击线 (不可见，较粗)
            const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hitLine.setAttribute('x1', e.v1.x);
            hitLine.setAttribute('y1', e.v1.y);
            hitLine.setAttribute('x2', e.v2.x);
            hitLine.setAttribute('y2', e.v2.y);
            hitLine.setAttribute('stroke', 'transparent');
            hitLine.setAttribute('stroke-width', '30'); // 增加点击区域宽度
            hitLine.setAttribute('stroke-linecap', 'butt'); // 平头端点，避免在顶点处过度重叠
            hitLine.setAttribute('class', 'interactive cursor-pointer');
            
            const handleEdgeClick = (evt) => {
                if (evt.type === 'touchstart') evt.preventDefault(); // 防止双重触发
                if (currentBuildMode === 'road') doAction({ type: 'build_road', id: e.id });
            };

            hitLine.onclick = handleEdgeClick;
            hitLine.ontouchstart = handleEdgeClick;
            
            // Hover 效果：当鼠标悬停在点击区域时，加深影子颜色
            hitLine.onmouseenter = () => {
                if (currentBuildMode === 'road' && $(`#edge-shadow-${key}`).is(':visible')) {
                    $(`#edge-shadow-${key}`).attr('fill', 'rgba(0,0,0,0.8)');
                }
            };
            hitLine.onmouseleave = () => {
                $(`#edge-shadow-${key}`).attr('fill', 'rgba(0,0,0,0.5)');
            };
            
            gEdge.appendChild(hitLine);
            gEdges.appendChild(gEdge);
        }
        
        // 绘制带有点击区域的顶点
        for (let key in board.vertices) {
            const v = board.vertices[key];
            const gVertex = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            gVertex.setAttribute('transform', `translate(${v.x}, ${v.y})`);

            // 视觉圆 (未建设的占位符)
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', 10);
            circle.setAttribute('id', `vertex-${key}`);
            circle.setAttribute('class', 'vertex-point');
            gVertex.appendChild(circle);

            // 视觉图标 (用于已建设筑)
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            icon.setAttribute('id', `vertex-icon-${key}`);
            icon.setAttribute('class', 'vertex-icon');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', 'none');
            gVertex.appendChild(icon);

            // 影子图标 (用于建设预览)
            const shadowIcon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            shadowIcon.setAttribute('id', `vertex-shadow-${key}`);
            shadowIcon.setAttribute('fill', 'rgba(0,0,0,0.5)'); // 黑色透明
            shadowIcon.setAttribute('stroke', 'none');
            shadowIcon.style.display = 'none'; // 默认隐藏
            shadowIcon.style.pointerEvents = 'none';
            gVertex.appendChild(shadowIcon);

            // 点击圆 (不可见，较大)
            const hitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            hitCircle.setAttribute('r', 15);
            hitCircle.setAttribute('fill', 'transparent');
            hitCircle.setAttribute('class', 'interactive cursor-pointer vertex-hit-circle'); // 添加 class 方便选择
            
            const handleVertexClick = (evt) => {
                if (evt.type === 'touchstart') evt.preventDefault();
                if (currentBuildMode === 'settlement' || currentBuildMode === 'city') {
                    doAction({ type: 'build_' + currentBuildMode, id: v.id });
                }
            };

            hitCircle.onclick = handleVertexClick;
            hitCircle.ontouchstart = handleVertexClick;
            
            // Hover 效果
            hitCircle.onmouseenter = () => {
                const shadow = $(`#vertex-shadow-${key}`);
                if (shadow.is(':visible')) {
                    shadow.attr('fill', 'rgba(0,0,0,0.8)');
                }
            };
            hitCircle.onmouseleave = () => {
                $(`#vertex-shadow-${key}`).attr('fill', 'rgba(0,0,0,0.5)');
            };
            
            gVertex.appendChild(hitCircle);
            gVertices.appendChild(gVertex);
        }
        
        // 绘制港口
        if (board.ports) {
            const gPorts = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            board.ports.forEach(port => {
                const v1 = board.vertices[port.v1];
                const v2 = board.vertices[port.v2];
                if (!v1 || !v2) return;
                
                const midX = (v1.x + v2.x) / 2;
                const midY = (v1.y + v2.y) / 2;
                
                // 计算从中心 (0,0) 向外的方向
                const dist = Math.hypot(midX, midY);
                const pushDist = 35; // 向外推 35px
                const finalX = midX + (midX / dist) * pushDist;
                const finalY = midY + (midY / dist) * pushDist;
                
                const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                group.setAttribute('transform', `translate(${finalX}, ${finalY})`);
                
                // 标签
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('class', 'port-text');
                text.setAttribute('font-size', '14px');
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('fill', '#fff');
                text.setAttribute('stroke', '#000'); // 描边以提高可读性
                text.setAttribute('stroke-width', '0.5px');
                text.setAttribute('style', 'pointer-events: none; text-shadow: 0 0 3px rgba(0,0,0,0.5);'); 
                
                let label = port.type;
                if (port.type === '3:1') label = '❓ 3:1';
                else if (port.type === 'wood') label = '🪵 2:1';
                else if (port.type === 'brick') label = '🧱 2:1';
                else if (port.type === 'wool') label = '🐑 2:1';
                else if (port.type === 'grain') label = '🌾 2:1';
                else if (port.type === 'ore') label = '🪨 2:1';
                
                text.textContent = label;
                
                // 连接到边缘的线 (虚线)
                const connector = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                connector.setAttribute('x1', 0);
                connector.setAttribute('y1', 0); // 从港口中心
                connector.setAttribute('x2', midX - finalX); // 到边缘中心 (相对)
                connector.setAttribute('y2', midY - finalY);
                connector.setAttribute('stroke', '#fff');
                connector.setAttribute('stroke-width', '2');
                connector.setAttribute('stroke-dasharray', '3,3');
                connector.setAttribute('opacity', '0.7');

                group.appendChild(connector);
                group.appendChild(text);
                gPorts.appendChild(group);
            });
            layer.appendChild(gPorts);
        }
        
        layer.appendChild(gHexes);
        // 先绘制 gVertices 可能会被 gEdges 遮挡点击，但我们希望点击事件由上层捕获
        // 实际上 SVG 的 z-index 是由 DOM 顺序决定的，后添加的在上面
        // 为了让道路点击区域（特别是端点）不被顶点遮挡，或者反过来，需要权衡
        // 现在的逻辑是：道路点击区域非常大，可能会遮挡顶点点击
        // 所以我们应该把 gVertices 放在 gEdges 上面，以确保顶点（如村庄）优先被点击
        // 但是道路的端点（即顶点）如果无法点击到道路，会导致用户感觉"两端点不了"
        // 解决方法：让道路的点击区域位于底层，或者调整层级
        
        // 尝试新的层级顺序：Hexes -> Edges (Roads) -> Vertices (Settlements) -> Robber
        // 这样村庄会覆盖在道路之上。
        // 但问题是用户说"道路两端依然点不了"，这意味着可能是顶点层（即使是空的）遮挡了道路的点击区域
        // 我们来看一下 gVertices 的实现
        
        layer.appendChild(gEdges);
        layer.appendChild(gVertices);
        layer.appendChild(gRobberLayer);
    }

    // --- UI 更新 ---
    function updateUI() {
        try {
            _updateUIInternal();
        } catch (e) {
            console.error("UI 更新失败:", e);
        }
    }

    function _updateUIInternal() {
        // 重新渲染 SVG 以反映基于阶段的变化 (如盗贼移动的高亮区域)
        renderBoardSVG();

        // 更新游戏状态指示器
        // 安全检查：players 数组可能在初始或大厅时为空
        if (!players || players.length === 0) {
            $('#game-status-indicator').addClass('hidden').removeClass('flex md:flex');
            return;
        }

        const p = players[currentPlayer];

        // 自动退出无效的建设模式 (如果在正常阶段且资源不足，且没有免费建设机会)
        if (currentPlayer === myPlayerIndex && !setupPhase && currentBuildMode) {
            // Check if free roads available
            if (currentBuildMode === 'road' && p.freeRoads > 0) {
                // Allowed to stay in build mode
            } else if (!canAfford(p, currentBuildMode)) {
                currentBuildMode = null;
                updateHints();
            }
        }

        // 如果发展卡模态框已打开，则刷新它 (确保购买后列表立即更新)
        if (!$('#dev-card-modal').hasClass('hidden')) {
             updateDevModal();
        }

        const statusEl = $('#status-text');
        const dotEl = $('#status-dot');
        const indicator = $('#game-status-indicator');
        const mobileIndicator = $('#mobile-status-indicator');
        const mobileDot = $('#mobile-status-dot');
        
        if (p) {
            // 仅当游戏容器可见时显示 (游戏已开始)
            if (!$('#game-container').hasClass('hidden')) {
                // 显示：在移动端隐藏(hidden)，桌面端显示(md:flex)
                indicator.addClass('hidden').addClass('md:flex').removeClass('flex');
                // 移动端指示器
                mobileIndicator.removeClass('hidden');
            } else {
                indicator.addClass('hidden').removeClass('flex md:flex');
                mobileIndicator.addClass('hidden');
            }
            
            // 设置颜色
            const color = getPlayerColor(p.id);
            dotEl.css('background-color', color);
            mobileDot.css('background-color', color);
            
            // 设置文本
            let statusText = '';
            if (currentPlayer === myPlayerIndex) {
                statusText = "你的回合";
                if (setupPhase) {
                    // 自动进入建设模式以获得更好的用户体验
                    if (setupState && currentBuildMode !== setupState) {
                        currentBuildMode = setupState;
                        updateHints();
                    }
                    
                    if (currentBuildMode === 'settlement') statusText = "正在建设村庄... (请点击地图上的白圈)";
                    else if (currentBuildMode === 'road') statusText = "正在建设道路... (请点击地图上的白线)";
                    else if (setupState === 'settlement') statusText += " - 请建设定居点";
                    else if (setupState === 'road') statusText += " - 请建设道路";
                } else {
                    if (turnPhase === 'roll') statusText += " - 请掷骰子";
                    else if (turnPhase === 'build') {
                        if (currentBuildMode === 'road') statusText = "正在建设道路... (点击地图上的白线，再次点击按钮取消)";
                        else if (currentBuildMode === 'settlement') statusText = "正在建设村庄... (点击地图上的白圈，再次点击按钮取消)";
                        else if (currentBuildMode === 'city') statusText = "正在建设城市... (点击已有的村庄升级，再次点击按钮取消)";
                        else statusText += " - 请选择建设操作或结束回合";
                    }
                    else if (turnPhase === 'robber_move') statusText += " - 请点击黄色区域移动盗贼";
                }
            } else {
                statusText = `等待 ${p.name}`;
                if (setupPhase) {
                    if (setupState === 'settlement') statusText += " 建设定居点...";
                    else if (setupState === 'road') statusText += " 建设道路...";
                } else {
                    if (turnPhase === 'roll') statusText += " 掷骰子...";
                    else if (turnPhase === 'build') statusText += " 进行行动...";
                    else if (turnPhase === 'robber_move') statusText += " 移动盗贼...";
                }
            }
            statusEl.text(statusText);
        } else {
            indicator.addClass('hidden').removeClass('flex');
            mobileIndicator.addClass('hidden').hide();
        }

        // 更新建设按钮状态和光标
        $('.btn-action').removeClass('ring-4 ring-green-400 bg-green-100 text-green-700').addClass('bg-white text-slate-700');
        // 恢复默认按钮样式 (除了 roll 和 end-turn，它们有特定样式，需要小心覆盖)
        $('#btn-roll').removeClass('bg-white text-slate-700').addClass('bg-gradient-to-r from-yellow-400 to-orange-500 text-white');
        $('#btn-end-turn').removeClass('bg-white text-slate-700').addClass('bg-slate-800 text-white');

        const svg = document.getElementById('game-svg');
        if (svg) svg.style.cursor = 'grab';

        if (currentPlayer === myPlayerIndex && currentBuildMode) {
             const btnId = `#btn-build-${currentBuildMode}`;
             $(btnId).removeClass('bg-white text-slate-700')
                     .addClass('ring-4 ring-green-400 bg-green-100 text-green-800 font-bold shadow-inner');
             
             if (svg) svg.style.cursor = 'crosshair';
        }

        // 更新棋盘状态 (颜色)
        for (let key in board.edges) {
            const e = board.edges[key];
            const el = document.getElementById(`edge-${key}`);
            const icon = document.getElementById(`edge-icon-${key}`);
            
            if (e.owner !== null) {
                // 已建设状态
                if (icon) {
                    icon.style.display = 'block';
                    icon.setAttribute('fill', getPlayerColor(e.owner));
                    icon.setAttribute('stroke', '#fff'); // 道路的可选边框
                    icon.setAttribute('stroke-width', '1');
                }
                if (el) el.style.display = 'none'; // 隐藏线条
            } else {
                // 未建设状态
                if (icon) icon.style.display = 'none';
                if (el) {
                    el.style.display = 'block';
                    el.setAttribute('stroke', 'transparent');
                    el.classList.remove('built');
                }
            }
        }
        
        for (let key in board.vertices) {
            const v = board.vertices[key];
            const el = document.getElementById(`vertex-${key}`);
            const icon = document.getElementById(`vertex-icon-${key}`);
            
            if (v.owner !== null) {
                // 已建设状态：显示图标，隐藏圆圈
                if (icon) {
                    icon.setAttribute('d', v.building === 'city' ? ICON_PATHS.city : ICON_PATHS.settlement);
                    icon.setAttribute('fill', getPlayerColor(v.owner));
                    icon.setAttribute('stroke', '#fff');
                    icon.setAttribute('stroke-width', '2');
                    icon.style.display = 'block';
                }
                if (el) el.style.display = 'none';
            } else {
                // 未建设状态：显示圆圈 (透明/提示)，隐藏图标
                if (icon) icon.style.display = 'none';
                if (el) {
                    el.style.display = 'block';
                    el.setAttribute('fill', 'transparent');
                    el.setAttribute('stroke', 'none');
                    el.setAttribute('r', 10);
                }
            }
        }
        
        updateHints();

        // 更新信息面板
        if (players[myPlayerIndex]) {
            const pLocal = players[myPlayerIndex];
            for (let res in pLocal.resources) {
                $(`#res-${res}`).text(pLocal.resources[res]);
            }
        }
        
        // 回合指示器
        if (currentPlayer === myPlayerIndex) {
            $('#turn-indicator').text("你的回合").addClass('text-green-600').removeClass('text-red-600');
            $('#turn-dot').removeClass('bg-red-500').addClass('bg-green-500');
            $('#game-controls button').prop('disabled', false);
            
            if (turnPhase === 'roll') {
                $('#btn-roll').show();
                $('.btn-action').not('#btn-roll').prop('disabled', true);
            } else {
                $('#btn-roll').hide();
                
                if (setupPhase) {
                    // 初始阶段：根据 setupState 启用/禁用
                    $('#btn-build-city').prop('disabled', true);
                    $('#btn-build-settlement').prop('disabled', setupState !== 'settlement');
                    $('#btn-build-road').prop('disabled', setupState !== 'road');
                    $('#btn-buy-dev').prop('disabled', true);
                } else {
                    // 正常阶段：检查成本
                    for (let type of ['road', 'settlement', 'city']) {
                        if (type === 'road' && p.freeRoads > 0) {
                            $(`#btn-build-${type}`).prop('disabled', false);
                        } else {
                            $(`#btn-build-${type}`).prop('disabled', !canAfford(p, type));
                        }
                    }
                    // 发展卡按钮：如果资源足够，或者有可用的卡牌，则启用
                    const hasPlayableCards = p.devCards.some(c => !c.boughtThisTurn && !playedDevCardThisTurn);
                    const canAffordDev = canAfford(p, 'dev');
                    
                    $('#btn-buy-dev').prop('disabled', !(canAffordDev || hasPlayableCards));
                }
            }
        } else {
            $('#turn-indicator').text(`玩家 ${currentPlayer+1} 的回合`).addClass('text-red-600').removeClass('text-green-600');
            $('#turn-dot').removeClass('bg-green-500').addClass('bg-red-500');
            $('#game-controls button').prop('disabled', true);
        }
        
        $('#dice-val').text(diceVal).parent().removeClass('hidden');
        
        // 更新玩家列表 (合并了我的资源和积分板)
        let playerRows = '';
        players.forEach((pl, i) => {
            const isCurrent = i === currentPlayer;
            const isMe = pl.id === myId;
            const totalRes = Object.values(pl.resources).reduce((a,b)=>a+b,0);
            const bgColor = isCurrent ? 'bg-orange-50' : (isMe ? 'bg-blue-50/50' : '');
            
            let badges = '';
            if (longestRoadOwnerId === pl.id) badges += '<span title="最长道路 (2分)">🛣️</span>';
            if (largestArmyOwnerId === pl.id) badges += '<span title="最大军队 (2分)">⚔️</span>';
            
            playerRows += `
                <tr class="${bgColor} border-b border-slate-100 last:border-0 transition-colors">
                    <td class="py-1 pl-1 font-semibold whitespace-nowrap" style="color:${getPlayerColor(pl.id)}">
                        ${pl.name} ${isMe ? '(你)' : ''} ${badges}
                    </td>
                    <td class="py-1 px-1 text-center font-bold text-slate-700">${pl.score}</td>
                    <td class="py-1 px-1 text-center ${pl.resources.brick > 0 ? 'text-slate-800 font-medium' : 'text-slate-300'}">${pl.resources.brick}</td>
                    <td class="py-1 px-1 text-center ${pl.resources.wood > 0 ? 'text-slate-800 font-medium' : 'text-slate-300'}">${pl.resources.wood}</td>
                    <td class="py-1 px-1 text-center ${pl.resources.wool > 0 ? 'text-slate-800 font-medium' : 'text-slate-300'}">${pl.resources.wool}</td>
                    <td class="py-1 px-1 text-center ${pl.resources.grain > 0 ? 'text-slate-800 font-medium' : 'text-slate-300'}">${pl.resources.grain}</td>
                    <td class="py-1 px-1 text-center ${pl.resources.ore > 0 ? 'text-slate-800 font-medium' : 'text-slate-300'}">${pl.resources.ore}</td>
                    <td class="py-1 px-1 text-center text-slate-500 text-xs">${totalRes}</td>
                </tr>`;
        });
        $('#player-table-body').html(playerRows);
    }
    
    function updateHints() {
        // 清除提示和影子
        $('.hint').removeClass('hint');
        $('[id^="edge-shadow-"]').hide();
        $('[id^="vertex-shadow-"]').hide();
        
        if (currentPlayer !== myPlayerIndex) return;
        
        if (currentBuildMode === 'road') {
            for (let key in board.edges) {
                const edge = board.edges[key];
                if (edge.owner === null) {
                    let isValid = false;
                    if (setupPhase) {
                        // 初始阶段：只能连接到刚刚建立的定居点
                        if (setupState === 'road' && lastBuiltSettlement) {
                            if (edge.v1.id === lastBuiltSettlement || edge.v2.id === lastBuiltSettlement) {
                                isValid = true;
                            }
                        }
                    } else {
                        // 正常阶段：必须连接自己的道路或建筑
                        if (checkRoadConnectivity(edge, myPlayerIndex)) {
                            isValid = true;
                        }
                    }

                    if (isValid) {
                        // 显示影子
                        const shadow = document.getElementById(`edge-shadow-${key}`);
                        if (shadow) {
                            shadow.style.display = 'block';
                        }
                    }
                }
            }
        } else if (currentBuildMode === 'settlement') {
            for (let key in board.vertices) {
                const v = board.vertices[key];
                if (v.owner === null) {
                    let isValid = false;
                    // 距离规则总是适用
                    if (checkDistanceRule(v)) {
                        if (setupPhase) {
                            // 初始阶段：任意符合距离规则的位置
                            if (setupState === 'settlement') {
                                isValid = true;
                            }
                        } else {
                            // 正常阶段：必须连接到自己的道路
                            if (checkConnectivity(v, myPlayerIndex)) {
                                isValid = true;
                            }
                        }
                    }

                    if (isValid) {
                        $(`#vertex-${key}`).addClass('hint');
                        // 显示影子 (村庄形状)
                        const shadow = document.getElementById(`vertex-shadow-${key}`);
                        if (shadow) {
                            shadow.setAttribute('d', ICON_PATHS.settlement);
                            shadow.style.display = 'block';
                        }
                    }
                }
            }
        } else if (currentBuildMode === 'city') {
            for (let key in board.vertices) {
                const v = board.vertices[key];
                if (v.owner === myPlayerIndex && v.building === 'settlement') {
                     // 城市升级提示 - 目标是图标因为圆圈被隐藏
                     $(`#vertex-icon-${key}`).addClass('hint');
                     
                     // 显示影子 (城市形状，稍微覆盖在原图标上，但透明)
                     const shadow = document.getElementById(`vertex-shadow-${key}`);
                     if (shadow) {
                         shadow.setAttribute('d', ICON_PATHS.city);
                         shadow.style.display = 'block';
                         // 城市影子可以稍微偏移一点或者直接覆盖，这里直接覆盖
                     }
                }
            }
        }
    }

    // --- 大厅逻辑 ---
    function updateLobbyUI() {
        const list = $('#lobby-players');
        list.empty();
        players.forEach(p => {
            list.append(`<li class="${p.id === myId ? 'font-bold text-orange-600' : ''}">${p.name} ${p.isAI ? '(AI)' : ''}</li>`);
        });

        if (isHost && !isGameStarted) {
            $('#btn-add-bot').removeClass('hidden');
            if (players.length >= 2) {
                $('#btn-start-game').removeClass('hidden');
            } else {
                $('#btn-start-game').addClass('hidden');
            }
        } else {
            $('#btn-add-bot').addClass('hidden');
            $('#btn-start-game').addClass('hidden');
        }
    }

    function addBot() {
        if (!isHost) return;
        if (players.length >= 4) {
            showToast("房间已满");
            return;
        }
        let botId = 'bot_' + Date.now() + '_' + Math.floor(Math.random()*1000);
        players.push({
            id: botId,
            name: "Bot " + (players.length),
            isAI: true,
            // 初始资源和状态将在 startGame 重置
        });
        updateLobbyUI();
        broadcastState({ type: 'lobby-update' });
    }

    function hostStartGame() {
        if (players.length < 2) {
            showToast("至少需要2名玩家！");
            return;
        }
        isGameStarted = true;
        startGame(players.length, 'online'); // 这里实际上只是重置状态
        broadcastState();
    }

    // --- 持久化 ---
    function saveGameState() {
        if (!isHost || !roomId) return;
        
        // 序列化板子状态 (只保存必要的数据，重建时生成图)
        const boardState = {
            hexes: board.hexes,
            ports: board.ports,
            // 保存所有有点/边的所有者信息
            vertices: {},
            edges: {}
        };
        
        for(let k in board.vertices) {
            const v = board.vertices[k];
            if (v.owner !== null) {
                boardState.vertices[k] = { owner: v.owner, building: v.building };
            }
        }
        for(let k in board.edges) {
            const e = board.edges[k];
            if (e.owner !== null) {
                boardState.edges[k] = { owner: e.owner };
            }
        }
        
        const state = {
            players,
            board: boardState,
            currentPlayer,
            turnPhase,
            setupPhase,
            setupTurn,
            setupState,
            lastBuiltSettlement,
            diceVal,
            robberHex,
            longestRoadOwnerId,
            largestArmyOwnerId,
            isGameStarted,
            myId // 验证身份
        };
        
        localStorage.setItem(`catan_game_${roomId}`, JSON.stringify(state));
    }

    function loadGameState() {
        const saved = localStorage.getItem(`catan_game_${myId}`); // roomId should be myId for host
        if (!saved) return false;
        
        try {
            const state = JSON.parse(saved);
            if (!state.isGameStarted) return false; // 只有游戏开始后才恢复
            
            gameMode = 'online'; // 恢复的游戏默认为在线模式 (因为只有在线模式的主机才会保存状态)

            log("正在恢复游戏状态...", state);
            
            players = state.players;
            currentPlayer = state.currentPlayer;
            turnPhase = state.turnPhase;
            setupPhase = state.setupPhase;
            setupTurn = state.setupTurn;
            setupState = state.setupState;
            lastBuiltSettlement = state.lastBuiltSettlement;
            diceVal = state.diceVal;
            robberHex = state.robberHex;
            longestRoadOwnerId = state.longestRoadOwnerId;
            largestArmyOwnerId = state.largestArmyOwnerId;
            isGameStarted = state.isGameStarted;
            
            // 恢复板子
            board.hexes = state.board.hexes;
            board.ports = state.board.ports;
            
            generateGraph(); // 重建图结构
            
            // 恢复建筑
            for(let k in state.board.vertices) {
                const savedV = state.board.vertices[k];
                if (board.vertices[k]) {
                    board.vertices[k].owner = savedV.owner;
                    board.vertices[k].building = savedV.building;
                }
            }
            for(let k in state.board.edges) {
                const savedE = state.board.edges[k];
                if (board.edges[k]) {
                    board.edges[k].owner = savedE.owner;
                }
            }
            
            renderBoardSVG();
            return true;
        } catch(e) {
            console.error("加载游戏状态失败", e);
            return false;
        }
    }

    // 提取 connection 处理器以复用
    // 必须定义在 initPeer 之前或全局作用域，确保可访问
    function setupPeerConnectionHandler(conn) {
        if (!isHost) {
            log("拒绝连接，因为不是房主:", conn.peer);
            conn.close();
            return;
        }
        
        log("正在为以下对象设置房主连接处理程序:", conn.peer);

        const handleOpen = () => {
            log("新连接:", conn.peer);
            
            // 检查重连
            let existing = players.find(p => p.id === conn.peer);
            
            if (!existing && players.length >= 4) {
                conn.send({ type: 'error', msg: 'Room full' });
                conn.close();
                return;
            }

            connections[conn.peer] = conn;
            
            if (!existing) {
                players.push({
                    id: conn.peer,
                    name: "Player " + (players.length + 1),
                    isAI: false
                });
            } else {
                log("玩家重新连接:", existing.name);
                showToast(`${existing.name} 重新连接`);
            }
            
            if (isGameStarted) {
                conn.send({ type: 'welcome', playerId: conn.peer, players: players });
                broadcastState();
            } else {
                updateLobbyUI();
                conn.send({ type: 'welcome', playerId: conn.peer, players: players });
                broadcastState({ type: 'lobby-update' });
            }
        };

        if (conn.open) {
            handleOpen();
        } else {
            conn.on('open', handleOpen);
        }

        setupHostConnection(conn);
    }

    // --- PeerJS & 网络 ---
    function initPeer() {
        const savedId = localStorage.getItem('catan_peer_id');
        peer = new Peer(savedId, PEER_CONFIG);
        
        peer.on('open', id => {
            myId = id;
            localStorage.setItem('catan_peer_id', id); // 确保保存
            log('我的 ID:', id);
            
            // 不要自动填充输入框
            // if (!$('#room-id-input').val()) {
            //     $('#room-id-input').val(id);
            // }
            
            // 检查 URL 中的房间
            const urlParams = new URLSearchParams(window.location.search);
            const room = urlParams.get('room');
            
            // 修复 room=null 问题
            if (room === 'null' || room === 'undefined') {
                const url = new URL(window.location.href);
                url.searchParams.delete('room');
                window.history.pushState({}, '', url);
            } else if (room) {
                if (room === id) { // 我是主机
                    // 房主刷新网页应该退出房间，并且清空地址上的room id
                    const url = new URL(window.location.href);
                    url.searchParams.delete('room');
                    window.history.replaceState({}, '', url);
                    
                    // 清除可能存在的旧状态
                    localStorage.removeItem(`catan_game_${id}`);
                    
                    showToast("已退出房间");
                } else { // 我是访客
                    joinRoom(room);
                }
            }
            
            // 如果在大厅且我是房主，确保我的ID正确
            if (isHost && players.length > 0 && players[0].id === null) {
                players[0].id = myId;
                updateLobbyUI();
            }
            
            // 显示房主 ID 方便调试
            if (isHost) {
                $('#waiting-msg').html(`你的房间 ID (房主): <span class="font-mono bg-slate-200 px-2 rounded select-all">${myId}</span><br>请将此 ID 分享给朋友`);
            }
        });
        
        peer.on('connection', conn => {
            setupPeerConnectionHandler(conn);
        });
        
        peer.on('error', err => {
            console.error(err);
            if (err.type === 'peer-unavailable') {
                 // 尝试连接不存在的 ID，可能是 URL 错误或房主已离开
                 showToast('房间不存在或房主已离开');
                 // 清除 URL 中的错误房间号，防止死循环
                 const url = new URL(window.location.href);
                 url.searchParams.delete('room');
                 window.history.pushState({}, '', url);
                 // 恢复大厅
                 $('#waiting-section').addClass('hidden');
                 $('#create-room-section').removeClass('hidden');
                 $('#lobby').removeClass('hidden');
                 $('#game-container').addClass('hidden');
            } else if (err.type === 'unavailable-id') {
                // ID 被占用 (通常意味着我是房主但刷新了，或者 ID 冲突)
                console.warn("ID 冲突，生成新 ID");
                const newId = 'catan_' + Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2);
                localStorage.setItem('catan_peer_id', newId);
                // 重新初始化
                if (peer) peer.destroy();
                initPeer(); // 递归调用，使用新 ID
            } else {
                showToast('连接错误: ' + err.type);
            }
        });
    }
    
    function setupHostConnection(conn) {
        // ... replaced above ...
    }

    // 全局变量，用于防止状态回滚
    let lastReceivedStateTimestamp = 0;

    function joinRoom(id) {
        roomId = id;
        gameMode = 'online'; // 确保客户端设置为在线模式
        hostConn = peer.connect(id);
        
        hostConn.on('open', () => {
            $('#waiting-msg').html(`已连接！房主 ID: <span class="font-mono bg-slate-200 px-2 rounded">${id}</span><br>等待房主开始游戏...`);
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden');
            isHost = false;
        });

        hostConn.on('data', data => {
            log('收到数据类型:', data.type, '时间戳:', data.timestamp);
            
            if (data.type === 'host_left') {
                alert('房主已解散房间');
                const url = new URL(window.location.href);
                url.searchParams.delete('room');
                window.location.href = url.toString();
                return;
            }

            if (data.type === 'welcome') {
                myPlayerIndex = -1;
                // 但是 welcome 消息可能包含 players
                if (data.players) {
                    players = data.players;
                    updateLobbyUI();
                }
            } else if (data.type === 'lobby-update') {
                players = data.players;
                updateLobbyUI();
            } else if (data.type === 'state') {
                // 防止状态乱序/回滚
                if (data.timestamp && data.timestamp < lastReceivedStateTimestamp) {
                    console.warn("收到过时状态，忽略。", data.timestamp, lastReceivedStateTimestamp);
                    return;
                }
                if (data.timestamp) lastReceivedStateTimestamp = data.timestamp;

                // 游戏开始/更新
                if (!isGameStarted) {
                    isGameStarted = true;
                    $('#lobby').addClass('hidden');
                    $('#game-container').removeClass('hidden');
                }

                players = data.players;
                // 更新 myPlayerIndex
                const me = players.findIndex(p => p.id === myId);
                if (me !== -1) myPlayerIndex = me;

                board.hexes = data.board.hexes; 
                if (data.robberHex !== undefined) robberHex = data.robberHex;

                // 只要收到 state，最好确保 vertices 是完整的
                const needRegen = Object.keys(board.vertices).length === 0 
                                  || document.getElementById('game-layer').children.length === 0
                                  || board.hexes.length !== Object.keys(board.vertices).length / 6 * 3; // 粗略估算

                if (Object.keys(board.vertices).length === 0 || setupPhase) {
                     // log("重新生成图结构...");
                     generateGraph(); 
                }

                log("正在同步棋盘数据...", Object.keys(data.board.vertices).length, "个来自房主的已占用顶点");
                syncBoardData(data.board);
                
                currentPlayer = data.currentPlayer;
                turnPhase = data.turnPhase;
                diceVal = data.diceVal;
                dice1 = data.dice1 || 3;
                dice2 = data.dice2 || 4;
                setupPhase = data.setupPhase;
                setupTurn = data.setupTurn; // 确保同步 setupTurn
                setupState = data.setupState;
                lastBuiltSettlement = data.lastBuiltSettlement;
                longestRoadOwnerId = data.longestRoadOwnerId;
                largestArmyOwnerId = data.largestArmyOwnerId;
                
                // 处理 Action 效果 (音效、动画)
                if (data.lastAction) {
                    playActionEffect(data.lastAction);
                }

                // 重新渲染
                // 注意：generateGraph 上面已经检查过了，这里只需确保 renderBoardSVG 执行
                renderBoardSVG();
                
                updateUI();
                lastStateUpdate = Date.now(); // 更新看门狗时间戳
            } else if (data.type === 'log') {
                addLog(data.message);
            } else if (data.type === 'action_failed') {
                console.error("操作失败:", data.action, data.reason);
                showToast('操作失败: ' + (data.reason || '未知错误'));
            }
        });

        hostConn.on('close', () => {
             if (!isHost) {
                 // 稍微延迟以避免和 host_left 冲突 (如果收到了 host_left，页面已经跳转了)
                 setTimeout(() => {
                     const urlParams = new URLSearchParams(window.location.search);
                     if (urlParams.get('room')) {
                         alert("与房主连接断开");
                         const url = new URL(window.location.href);
                         url.searchParams.delete('room');
                         window.location.href = url.toString();
                     }
                 }, 1000);
             }
        });
    }
    
    function broadcastState(extra = {}) {
        // 如果在大厅阶段，只发送 players
        if (!isGameStarted) {
            const state = {
                type: 'lobby-update',
                players: players,
                ...extra
            };
            for (let id in connections) {
                try {
                    if (connections[id] && connections[id].open) {
                        connections[id].send(state);
                    }
                } catch(e) { console.error('大厅广播错误', e); }
            }
            return;
        }

        const simpleBoard = {
            hexes: board.hexes,
            vertices: {},
            edges: {}
        };
        for(let k in board.vertices) {
            const v = board.vertices[k];
            if (v.owner !== null) simpleBoard.vertices[k] = { owner: v.owner, building: v.building };
        }
        for(let k in board.edges) {
            const e = board.edges[k];
            if (e.owner !== null) simpleBoard.edges[k] = { owner: e.owner };
        }
        
        const state = {
            type: 'state',
            players: players,
            board: simpleBoard,
            robberHex: robberHex, // Sync robber position
            currentPlayer: currentPlayer,
            turnPhase: turnPhase,
            diceVal: diceVal,
            dice1: dice1, // Sync dice details
            dice2: dice2, // Sync dice details
            setupPhase: setupPhase,
            setupTurn: setupTurn, // 确保广播 setupTurn
            setupState: setupState,
            lastBuiltSettlement: lastBuiltSettlement, // Sync last built settlement for road connectivity hints
            longestRoadOwnerId: longestRoadOwnerId,
            largestArmyOwnerId: largestArmyOwnerId,
            timestamp: Date.now(), // 增加时间戳防止乱序
            ...extra
        };

        if (isHost && isGameStarted) {
            saveGameState();
        }

        let sentCount = 0;
        log(`正在向 ${Object.keys(connections).length} 个连接广播状态...`);
        
        for (let id in connections) {
            try {
                const conn = connections[id];
                // 尝试发送，即使 open 状态看起来不对（PeerJS 有时状态更新滞后）
                // 但如果 conn 已经 null 或者明显关闭了，还是得小心
                if (conn) {
                    if (!conn.open) console.warn(`连接 ${id} 报告关闭，尝试强制发送...`);
                    conn.send(state);
                    sentCount++;
                }
            } catch(e) {
                console.error('向 ' + id + ' 广播错误', e);
            }
        }
        log(`已向 ${sentCount} 个客户端广播状态。`);
    }
    
    function setupHostConnection(conn) {
        conn.on('data', data => {
            // 最顶层日志：打印所有接收到的数据，不进行任何过滤
            log(`[房主] 收到来自 ${conn.peer} 的原始数据:`, data);

            if (!data || typeof data !== 'object') {
                console.warn('[房主] 收到无效数据格式:', data);
                return;
            }

            // Relaxed check: Accept any message that is not a system message as an action
            // Previously: if (data.type === 'action')
            if (data.type !== 'request_state') {
                log("房主收到来自 " + conn.peer + " 的操作:", data);
                
                // 验证操作者是否为当前玩家 (如果是普通操作)
                // 注意: trade_response 等操作不需要是当前玩家
                if (data.type !== 'trade_response' && data.type !== 'chat') {
                    const p = players[currentPlayer];
                    // 严格 ID 检查
                    if (p.id !== conn.peer) {
                        console.warn(`操作被拒绝: 玩家 ${conn.peer} 尝试操作，但当前是 ${p.name} 的回合 (ID: ${p.id})。`);
                        
                        // 增加更详细的调试信息
                        log('当前玩家列表:', players.map(pl => `${pl.name}:${pl.id}`));
                        log('当前回合索引:', currentPlayer);
                        
                        conn.send({ type: 'log', message: `不是你的回合！当前是 ${p.name} 的回合` });
                        conn.send({ type: 'action_failed', action: data, reason: 'not_your_turn' });
                        return;
                    }
                }

                Promise.resolve(handleAction(data)).then((result) => {
                    // 如果 handleAction 返回 false 或 {success: false}，说明执行失败（被拒绝）
                    if (result === false || (typeof result === 'object' && result.success === false)) {
                        console.warn("操作验证失败:", data, result);
                        const reason = (result && result.reason) ? result.reason : '未知验证错误';
                        conn.send({ type: 'action_failed', action: data, reason: reason });
                    } else {
                        // 成功：广播状态
                        // 注意：如果 result 是 undefined (旧逻辑)，我们也假设成功并广播，
                        // 除非明确返回 false。
                        // 现在的 handleAction 应该都返回 true，但为了兼容性：
                        log("操作处理成功，正在广播状态...");
                        broadcastState({ lastAction: data }); 
                        
                        // Host also needs to run effects if it's the initiator or involved
                        if (isHost) {
                            playActionEffect(data);
                            updateUI();
                        }

                        // 触发 AI (如果客户端操作导致轮到 AI)
                        const currentP = players[currentPlayer];
                        if (isHost && currentP && currentP.isAI) {
                            log(`[房主] Client操作后触发 AI 回合 (玩家 ${currentPlayer})`);
                            setTimeout(aiTurn, 1500); 
                        }
                    }
                }).catch(err => {
                    console.error("处理客户端操作出错:", err);
                    conn.send({ type: 'log', message: '操作执行出错: ' + err.message });
                    broadcastState({ type: 'error_recovery' });
                });
            } else if (data.type === 'request_state') {
                log('客户端请求状态同步:', conn.peer);
                broadcastState(); // 单播太麻烦，直接广播也没问题，或者修改 broadcastState 支持单播
                // 简单起见，这里触发一次广播，因为通常只有一个客户端请求
            }
        });
        conn.on('close', () => {
            if (!isGameStarted) {
                players = players.filter(p => p.id !== conn.peer);
                delete connections[conn.peer];
                updateLobbyUI();
                broadcastState({ type: 'lobby-update' });
            } else {
                log(`玩家 ${conn.peer} 在游戏中断开连接。`);
                // 游戏中断线不删除玩家，但 UI 应该显示离线
                showToast(`玩家 ${conn.peer.substr(0,4)}... 断开连接`);
            }
        });
    }

    // 客户端看门狗：如果状态长时间未更新，主动请求
    // 移除自动轮询，改用事件驱动。
    // 如果确实需要手动同步，可以稍后添加 UI 按钮。
    // let lastStateUpdate = Date.now();
    // setInterval(() => { ... }, 2000); 
    let lastStateUpdate = Date.now(); // 保留变量用于 UI 显示最后更新时间（可选）

    function syncBoardData(remoteBoard) {
        let vCount = 0, eCount = 0;
        
        for(let k in remoteBoard.vertices) {
            if (board.vertices[k]) {
                Object.assign(board.vertices[k], remoteBoard.vertices[k]);
                vCount++;
            } else {
                console.warn(`同步警告: 本地未找到来自房主的顶点 key ${k}!`);
            }
        }
        for(let k in remoteBoard.edges) {
            if (board.edges[k]) {
                Object.assign(board.edges[k], remoteBoard.edges[k]);
                eCount++;
            } else {
                console.warn(`同步警告: 本地未找到来自房主的边 key ${k}!`);
            }
        }
        log(`从房主同步了 ${vCount} 个顶点和 ${eCount} 条边。`);
    }

    function createRoom() {
        isHost = true;
        
        // 初始化房主玩家
        players = [{
            id: myId,
            name: "Host",
            isAI: false
        }];
        updateLobbyUI();

        const url = new URL(window.location.href);
        url.searchParams.set('room', myId);
        window.history.pushState({}, '', url);
        $('#share-url').val(url.toString());
        $('#create-room-section').addClass('hidden');
        $('#waiting-section').removeClass('hidden');
        $('#btn-copy').prop('disabled', false).removeClass('cursor-not-allowed');
    }
    
    function startPvAI() {
        gameMode = 'ai';
        isHost = true; // 本地主机
        myId = 'local_human';
        // 自动添加3个AI
        players = [{ id: myId, name: "You", isAI: false }];
        for(let i=0; i<3; i++) {
            players.push({
                id: 'bot_'+i,
                name: "Bot " + (i+1),
                isAI: true
            });
        }
        startGame(4, 'ai');
    }
    
    function startGame(numPlayers, mode) { // numPlayers 参数不再使用，使用 players.length
        gameMode = mode; // 确保设置全局游戏模式
        // 初始化玩家状态
        players.forEach((p, i) => {
            // 保留 id, name, isAI
            p.resources = { brick:0, wood:0, wool:0, grain:0, ore:0 };
            p.devCards = [];
            p.knights = 0;
            p.longestRoad = 0;
            p.score = 0;
            p.freeRoads = 0;
        });
        
        if (mode === 'ai') {
             myPlayerIndex = 0;
        } else {
             myPlayerIndex = players.findIndex(p => p.id === myId);
        }

        generateBoard();
        
        setupPhase = true; 
        setupTurn = 0;
        turnPhase = 'build_setup'; 
        currentPlayer = 0;
        
        longestRoadOwnerId = null;
        largestArmyOwnerId = null;
        
        $('#lobby').addClass('hidden');
        $('#game-container').removeClass('hidden');
        updateUI();
    }
    
    function copyLink() {
        const text = $('#share-url').val();
        
        const updateBtn = () => {
            const $btn = $('#btn-copy');
            const originalText = $btn.text();
            $btn.text('已复制').addClass('text-green-500').removeClass('text-orange-500');
            setTimeout(() => {
                $btn.text('复制').addClass('text-orange-500').removeClass('text-green-500');
            }, 2000);
        };

        // 优先尝试现代 API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => {
                    showToast('已复制!');
                    updateBtn();
                })
                .catch(err => {
                    console.error('剪贴板操作失败，尝试回退方案', err);
                    fallbackCopy(text, updateBtn);
                });
        } else {
            fallbackCopy(text, updateBtn);
        }
    }
    
    function fallbackCopy(text, onSuccess) {
        // 创建临时文本域
        const textArea = document.createElement("textarea");
        textArea.value = text;
        
        // 确保不可见但可选中
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToast('已复制!');
                if (onSuccess) onSuccess();
            }
            else showToast('复制失败，请手动复制');
        } catch (err) {
            console.error('回退复制方案失败', err);
            showToast('复制失败，请手动复制');
        }
        
        document.body.removeChild(textArea);
    }

    // 启动
    init();
});
