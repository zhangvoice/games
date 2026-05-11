$(document).ready(function() {
    // --- 常量与配置 ---
    const SPELLS = {
        1: { count: 1, name: "Ancient Dragon", desc: "对所有对手造成1-3点伤害" },
        2: { count: 2, name: "Dark Wanderer", desc: "所有对手扣除1点生命，你增加1点生命" },
        3: { count: 3, name: "Sweet Dream", desc: "你增加1-3点生命" },
        4: { count: 4, name: "Owl", desc: "获取一张秘密牌，若存活本轮每张秘密牌+1分" },
        5: { count: 5, name: "Lightning", desc: "上家和下家各扣除1点生命" },
        6: { count: 6, name: "Blizzard", desc: "上家扣除1点生命" },
        7: { count: 7, name: "Fireball", desc: "下家扣除1点生命" },
        8: { count: 8, name: "Magic Potion", desc: "你增加1点生命" }
    };

    const SHORT_NAMES = {
        1: "龙", 2: "幽", 3: "梦", 4: "夜", 5: "雷", 6: "雪", 7: "火", 8: "药"
    };

    const DEBUG = false;

    function debugLog(...args) {
        if (DEBUG) {
            console.log(...args);
        }
    }

    // 初始化咒语提示框
    Object.keys(SPELLS).forEach(spellId => {
        let spell = SPELLS[spellId];
        let tooltip = `
            <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 w-48 bg-slate-800 text-white text-xs rounded p-2 hidden group-hover:block z-50 pointer-events-none shadow-lg">
                <div class="font-bold mb-1">${spellId}号 - ${spell.name}</div>
                <div>${spell.desc}</div>
                <div class="text-slate-400 mt-1 text-[10px] flex justify-between">
                    <span>总数: ${spell.count}</span>
                    <span class="text-orange-400 font-bold">已知: <span class="visible-count-${spellId}">0</span></span>
                </div>
                <!-- 三角形指示箭头 -->
                <div class="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
            </div>
        `;
        $(`.spell-container[data-spell="${spellId}"]`).append(tooltip);
    });

    const MAX_HP = 6;
    const WIN_SCORE = 8;
    const HAND_SIZE = 5;

    // --- 游戏状态 ---
    let myId = null;
    let myName = "Me";
    let isHost = false;
    let roomId = null;
    
    // 核心状态 (已同步)
    let players = []; // 玩家对象结构: { id, name, hp, hand: [], score, isDead, secretStonesFound: 0 }
    let secretStones = []; // 咒语数字数组 (秘密牌池)
    let drawPile = []; // 补牌堆
    let graveyard = []; // 咒语数字数组
    let currentPlayerIdx = 0;
    let nextStarterIdx = 0; // 下一轮开始者
    let roundNum = 1;
    let currentSpellChain = 0; // 本回合施放的上一个咒语的值 (必须施放 >= 此值)
    let isGameStarted = false;
    let gameLog = [];
    let latestDiceRoll = null; // { id: string, value: number }

    // 本地状态
    let peer = null;
    let connections = {}; // 房主: id -> conn
    let hostConn = null; // 客户端: conn
    let localLastDiceRollId = null; // 客户端记录的最后一次骰子ID
    let isDiceAnimating = false; // 是否正在播放骰子动画
    let pendingState = null; // 动画播放期间积压的最新状态
    let myHandIndices = []; // 实际上在我手中的秘密牌索引 (等等，不)
    // 实际上，对于“我的手牌”，服务器知道我有什么。
    // 客户端接收 { myHand: [1, 2, ...], others: ... } ?
    // 不。在这个游戏中，我不知道我的手牌。服务器知道。
    // 所以服务器将我的手牌发送为 [0, 0, 0, 0, 0] (隐藏) 或者干脆不发送具体数值。
    // 但我能看到别人的手牌。
    // 所以客户端状态:
    // players: [ { id, name, hp, hand: [1, 5, 8...], ... } ]
    // 但对于“我”，手牌应该被屏蔽？
    // 实际上，为了防止作弊，服务器应该发送屏蔽后的手牌数值给我。
    
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

        if (type === 'cast') {
            osc.frequency.setValueAtTime(400, t);
            osc.frequency.exponentialRampToValueAtTime(800, t + 0.1);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.3);
            osc.start(t);
            osc.stop(t + 0.3);
        } else if (type === 'hit') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.exponentialRampToValueAtTime(50, t + 0.2);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.2);
            osc.start(t);
            osc.stop(t + 0.2);
        } else if (type === 'fail') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, t);
            osc.frequency.linearRampToValueAtTime(100, t + 0.3);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.3);
            osc.start(t);
            osc.stop(t + 0.3);
        } else if (type === 'win') {
            // 胜利号角 - 简单的大调琶音
            const now = audioCtx.currentTime;
            
            // 音符 1: C5
            const osc1 = audioCtx.createOscillator();
            const gain1 = audioCtx.createGain();
            osc1.connect(gain1);
            gain1.connect(audioCtx.destination);
            osc1.frequency.value = 523.25;
            gain1.gain.setValueAtTime(0.1, now);
            gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc1.start(now);
            osc1.stop(now + 0.5);

            // 音符 2: E5
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.frequency.value = 659.25;
            gain2.gain.setValueAtTime(0.1, now + 0.1);
            gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
            osc2.start(now + 0.1);
            osc2.stop(now + 0.6);

            // 音符 3: G5
            const osc3 = audioCtx.createOscillator();
            const gain3 = audioCtx.createGain();
            osc3.connect(gain3);
            gain3.connect(audioCtx.destination);
            osc3.frequency.value = 783.99;
            gain3.gain.setValueAtTime(0.1, now + 0.2);
            gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
            osc3.start(now + 0.2);
            osc3.stop(now + 0.8);
            
            // 音符 4: C6 (High C)
            const osc4 = audioCtx.createOscillator();
            const gain4 = audioCtx.createGain();
            osc4.connect(gain4);
            gain4.connect(audioCtx.destination);
            osc4.frequency.value = 1046.50;
            gain4.gain.setValueAtTime(0.2, now + 0.3);
            gain4.gain.exponentialRampToValueAtTime(0.01, now + 1.5);
            osc4.start(now + 0.3);
            osc4.stop(now + 1.5);
        }
    }

    // --- 辅助函数 ---
    function generateDeck() {
        let deck = [];
        for (let i = 1; i <= 8; i++) {
            for (let j = 0; j < SPELLS[i].count; j++) {
                deck.push(i);
            }
        }
        return shuffle(deck);
    }

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function rollDie() {
        // 1-3 骰子
        let val = Math.floor(Math.random() * 3) + 1;
        latestDiceRoll = {
            id: Date.now() + '_' + Math.random(),
            value: val
        };
        return val;
    }

    // --- AI 逻辑 ---
    function addBot() {
        if (!isHost) return;
        if (players.length >= 5) {
            alert("房间已满");
            return;
        }
        let botId = 'bot_' + Date.now() + '_' + Math.floor(Math.random()*1000);
        players.push({
            id: botId,
            name: "Bot " + (players.length), // 例如 Bot 2
            hp: MAX_HP,
            score: 0, // 初始0分
            collectedStones: [], // 收集的秘密石
            hand: [],
            isDead: false,
            secretStonesFound: 0,
            isAI: true
        });
        updateLobbyUI();
        broadcastState();
    }

    function removeBot(botId) {
        if (!isHost) return;
        players = players.filter(p => p.id !== botId);
        // Renumber bots or just leave names? Leave names is fine.
        updateLobbyUI();
        broadcastState();
    }

    function checkAITurn() {
        if (!isHost || !isGameStarted) return;
        let curPlayer = players[currentPlayerIdx];
        if (curPlayer && curPlayer.isAI && !curPlayer.isDead) {
            setTimeout(() => executeAITurn(curPlayer), 1500); // 延迟以增加真实感
        }
    }

    function executeAITurn(aiPlayer) {
        // 简单 AI 策略
        // 1. 计算概率
        // 可见信息: 墓地 + 其他玩家的手牌 (AI 可以看到其他所有人的手牌)
        // 未知信息: 秘密牌堆 + AI 自己的手牌
        
        let visibleCounts = {}; // 咒语 -> 数量
        for(let i=1; i<=8; i++) visibleCounts[i] = 0;
        
        // 统计墓地
        graveyard.forEach(s => visibleCounts[s]++);
        
        // 统计其他玩家手牌
        players.forEach(p => {
            if (p.id !== aiPlayer.id) {
                p.hand.forEach(s => visibleCounts[s]++);
            }
        });
        
        let unknownPoolSize = 0;
        let unknownCounts = {};
        for(let i=1; i<=8; i++) {
            unknownCounts[i] = SPELLS[i].count - visibleCounts[i];
            unknownPoolSize += unknownCounts[i];
        }
        
        // 计算拥有每种咒语至少一张的概率
        // 这很复杂，但可以使用简单的启发式方法: prob = unknownCounts[i] / unknownPoolSize * handSize?
        // 实际上我们只想知道手中最可能的牌。
        // 牌 X 的概率 = unknownCounts[X] / unknownPoolSize。
        
        let bestSpell = null;
        let maxProb = -1;
        
        // 有效咒语必须 >= currentSpellChain
        let candidates = [];
        for(let i=1; i<=8; i++) {
            if (i >= currentSpellChain && unknownCounts[i] > 0) {
                let prob = unknownCounts[i] / unknownPoolSize;
                candidates.push({ spell: i, prob: prob });
            }
        }
        
        candidates.sort((a,b) => b.prob - a.prob);
        
        // 决策: 施法还是停止?
        // 如果必须施法 (chain == 0 或刚开始回合), 选择最好的。
        // 如果可以停止 (chain > 0), 检查风险。
        
        let action = null;
        
        if (candidates.length === 0) {
            // 没有有效咒语? (应该意味着手牌空了或都用完了?)
            // 如果我们要么有牌但都 < chain (如果逻辑正确这是不可能的，等等)
            // 如果所有 i >= chain 的 unknownCounts[i] 都是 0，那我们要假设我们没有这些牌吗？
            // 但我们确实有牌。这意味着我们手中的牌必须 < chain。
            // 所以如果我们施法肯定会失败。
            // 如果能停止，就停止。
            if (currentSpellChain > 0) {
                action = { type: 'stop' };
            } else {
                // 必须施放某些东西。随机选择有效的？或者干脆选 1 (自杀)?
                // 就施放 1。
                action = { type: 'cast', spell: 1 };
            }
        } else {
            let best = candidates[0];
            
            // 风险阈值
            // 如果概率低 (< 20%), 并且我们可以停止，也许该停止?
            // 但通常在这个游戏中你想稍微冒险一点。
            
            if (currentSpellChain > 0 && best.prob < 0.25) {
                 action = { type: 'stop' };
            } else {
                 action = { type: 'cast', spell: best.spell };
            }
        }
        
        handlePlayerAction(aiPlayer.id, action);
    }

    // --- 核心逻辑 (房主) ---
    function initHostGame() {
        players = [{
            id: myId,
            name: "Host (Me)",
            hp: MAX_HP,
            score: 0, // 初始0分
            collectedStones: [],
            hand: [],
            isDead: false,
            secretStonesFound: 0
        }];
        updateLobbyUI();
    }

    function hostStartGame() {
        if (players.length < 2) {
            alert("至少需要2名玩家！");
            return;
        }
        isGameStarted = true;
        roundNum = 1;
        // 重置分数
        players.forEach(p => { p.score = 0; p.collectedStones = []; p.hp = MAX_HP; p.isDead = false; });
        startRound();
        broadcastState();
    }

    function startRound() {
        // 此外，还要取出一些牌作为“秘密牌”
        // 2人游戏有12张秘密牌
        // 3人游戏有6张秘密牌
        // 4、5人游戏有4张秘密牌
        let secretCount = 0;
        if (players.length === 2) secretCount = 12;
        else if (players.length === 3) secretCount = 6;
        else secretCount = 4;

        // 确保牌堆足够
        // 总牌数 36. 
        // 手牌: players * 5. 
        // 剩余 = 36 - 5*P.
        // 如果 secretCount > 剩余，则取最大可能值
        
        // 洗牌后的 deck
        let deck = generateDeck(); // 36 张
        
        // 移除秘密牌
        secretStones = [];
        for(let i=0; i<secretCount; i++) {
            if (deck.length > 0) secretStones.push(deck.pop());
        }

        players.forEach(p => {
            p.hp = MAX_HP; // 每轮重置生命
            p.isDead = false;
            p.hand = [];
            p.collectedStones = []; // 重置收集的秘密牌
            // p.score 不重置，是累积的
            
            for (let i = 0; i < HAND_SIZE; i++) {
                if (deck.length > 0) p.hand.push(deck.pop());
            }
            p.hand.sort((a,b) => a - b); 
        });
        
        // 剩余的牌留在 deck 中用于补牌?
        // 规则: "每个玩家回合结束时，需要摸牌补齐到5张（如果剩余的牌摸完了，就不需要摸了）"
        // 这里的“剩余的牌”是指哪里？
        // 通常秘密牌是移除游戏的（或者作为奖励池）。
        // 补牌应该从 deck 中补。
        // 所以我们需要一个 drawPile。
        // 原代码用 secretStones 作为补牌堆是不对的（或者之前的规则不同）。
        // 现在明确了：秘密牌是特殊的，用于 Owl 获取。
        // 补牌堆是 deck 剩下的。
        
        // 让我们修正全局变量
        // secretStones -> owlPool (或者叫 secretCards)
        // deck -> drawPile
        
        // 为了最小化修改，我们保留 secretStones 变量名，但它的用途现在专指“秘密牌池（Owl获取用）”
        // 我们需要一个新的变量 drawPile
        drawPile = deck; // 剩下的牌
        
        graveyard = [];
        currentSpellChain = 0;
        
        // 确定起始玩家
        // 第一轮房主开始，后面是每轮赢家
        if (roundNum === 1) {
             let hostIdx = players.findIndex(p => p.id === myId); // 房主 ID 在 initHostGame 中设置
             // 等等，players 在 hostStartGame 时已经同步了。
             // 只有房主运行 startRound。
             // 房主总是 players[0] 吗？不一定，如果有人重连。
             // 但 initHostGame 设置了 players[0] = Host.
             // 简单起见，第一轮 index 0 开始。
             currentPlayerIdx = 0;
        } else {
             // 保持上一轮的 winner 作为起始，或者如果没有 winner (平局)，谁开始？
             // 规则: "后面是每轮赢家开始"
             // 如果上一轮平局（例如都死了），也许随机或保持不变？
             // 我们在 endRound 中设置 nextStarterIdx。
             if (typeof nextStarterIdx !== 'undefined' && nextStarterIdx !== -1) {
                 currentPlayerIdx = nextStarterIdx;
             } else {
                 currentPlayerIdx = 0;
             }
        }
        
        log("第 " + roundNum + " 轮开始！", 'turn');
        // checkAITurn(); // 移至 handleStateUpdate
    }

    function handlePlayerAction(playerId, action) {
        if (!isHost) return;
        
        debugLog(`[HandleAction] PlayerId=${playerId}, Action=`, action);
        
        // 查找玩家
        let pIdx = players.findIndex(p => p.id === playerId);
        if (pIdx === -1) {
            console.error(`[HandleAction] Player not found: ${playerId}`);
            return;
        }
        
        if (pIdx !== currentPlayerIdx) {
            console.warn(`[HandleAction] Not player's turn. Current: ${currentPlayerIdx}, Request: ${pIdx}`);
            // 不是他们的回合
            return;
        }

        if (action.type === 'cast') {
            let spell = parseInt(action.spell);
            debugLog(`[HandleAction] Casting spell ${spell}. Chain requirement: ${currentSpellChain}`);
            
            if (spell < currentSpellChain) {
                console.warn(`[HandleAction] Illegal move: Spell ${spell} < Chain ${currentSpellChain}`);
                // 非法移动 (应该被 UI 阻止，但需要双重检查)
                return;
            }
            
            // 检查玩家是否有该牌
            let hand = players[pIdx].hand;
            debugLog(`[HandleAction] Player hand:`, hand);
            
            let idx = hand.indexOf(spell);
            
            if (idx !== -1) {
                // 成功!
                // 移除牌
                hand.splice(idx, 1);
                graveyard.push(spell);
                
                log(`${players[pIdx].name} 成功施放了 ${spell}号-${SPELLS[spell].name}!`);
                playSound('cast');
                
                // 执行效果
                if (resolveSpellEffect(pIdx, spell)) return;
                
                // 检查回合胜利 (手牌清空)
                if (players[pIdx].hand.length === 0) {
                    log(`${players[pIdx].name} 打光了所有手牌，赢得本轮！`);
                    endRound(players[pIdx].id, 'empty_hand');
                } else {
                    // 更新连锁要求
                    // 更新连锁要求
                    currentSpellChain = spell;
                    // 玩家可以选择继续或停止
                    // 我们需要等待下一个动作。
                    // 但如果他们刚刚施法，他们仍然是活跃的。
                    // UI 需要知道他们可以继续。
                    
                    // checkAITurn(); // 移动：AI 应等待动画/状态更新后再决定下一步
                    // 但是等等，如果玩家继续回合，如果是 AI 回合我们需要再次触发 AI。
                    // broadcastState 将触发 handleStateUpdate，进而触发 checkAITurn。
                    // 所以没问题。
                }
            } else {
                // 失败!
                log(`${players[pIdx].name} 施法失败！手中没有 ${spell}号！`);
                playSound('fail');
                // 惩罚
                let dmg = 1;
                if (spell === 1) {
                    dmg = rollDie(); // 龙失败伤害
                    log(`召唤古龙失败，受到反噬伤害 ${dmg}点！`, 'fail');
                } else if (spell === 3) {
                    dmg = rollDie();
                    log(`美梦破碎，受到反噬伤害 ${dmg}点！`, 'fail');
                }
                players[pIdx].hp -= dmg;
                
                // 检查是否死亡
                if (checkDeaths(players[pIdx].id, spell === 1 || spell === 3)) return;

                // 结束回合
                endTurn(pIdx);
            }
        } else if (action.type === 'stop') {
            log(`${players[pIdx].name} 停止施法。`);
            endTurn(pIdx);
        }

        broadcastState();
    }

    function resolveSpellEffect(casterIdx, spell) {
        let caster = players[casterIdx];
        let alivePlayers = players.filter(p => !p.isDead);
        let casterAliveIdx = alivePlayers.findIndex(p => p.id === caster.id);
        
        let leftNeighbor = alivePlayers[(casterAliveIdx + alivePlayers.length - 1) % alivePlayers.length];
        let rightNeighbor = alivePlayers[(casterAliveIdx + 1) % alivePlayers.length];
        
        switch(spell) {
            case 1: // 龙: 其他所有玩家受到伤害
                let dmg = rollDie();
                log(`古龙吐息！所有对手受到 ${dmg} 点伤害！`, 'hit');
                players.forEach((p, i) => {
                    if (i !== casterIdx && !p.isDead) {
                        p.hp -= dmg;
                    }
                });
                break;
            case 2: // 幽灵: 所有对手扣除1点生命，你增加1点生命
                log(`幽灵现身！所有对手扣除1点生命！`, 'steal');
                players.forEach((p, i) => {
                    if (i !== casterIdx && !p.isDead) {
                        p.hp -= 1;
                    }
                });
                caster.hp = Math.min(caster.hp + 1, MAX_HP);
                log(`${caster.name} 恢复了1点生命。`, 'heal');
                break;
            case 3: // 美梦: 回复骰子点数
                let heal = rollDie();
                log(`美梦时刻，回复 ${heal} 点生命。`, 'heal');
                caster.hp = Math.min(caster.hp + heal, MAX_HP);
                break;
            case 4: // 夜歌: 拿走一颗秘密石
                if (secretStones.length > 0) {
                    let stone = secretStones.shift();
                    if (!caster.collectedStones) caster.collectedStones = [];
                    caster.collectedStones.push(stone);
                    // caster.score 不立即更新
                    // 发送私信告知具体卡牌？
                    if (connections[caster.id]) {
                        connections[caster.id].send({ type: 'secret-reveal', stone: stone });
                    } else if (caster.id === myId) {
                         showToast(`秘密牌是: ${stone}号-${SPELLS[stone].name}`, 'info');
                    }
                    
                    log(`${caster.name} 获得了一颗秘密牌 (当前收集: ${caster.collectedStones.length})`);
                } else {
                    log(`秘密牌已耗尽！`);
                }
                break;
            case 5: // 闪电: 上家和下家各扣除1点生命
                if (leftNeighbor.id !== caster.id) { 
                    leftNeighbor.hp -= 1; 
                    log(`${leftNeighbor.name} (上家) 被雷击，失去1点生命！`); 
                }
                if (rightNeighbor.id !== caster.id && rightNeighbor.id !== leftNeighbor.id) { 
                    rightNeighbor.hp -= 1; 
                    log(`${rightNeighbor.name} (下家) 被雷击，失去1点生命！`); 
                }
                break;
            case 6: // 暴风雪: 上家扣除1点生命
                if (leftNeighbor.id !== caster.id) { 
                    leftNeighbor.hp -= 1; 
                    log(`${leftNeighbor.name} (上家) 被暴风雪击中，失去1点生命！`); 
                }
                break;
            case 7: // 火球: 下家扣除1点生命
                 if (rightNeighbor.id !== caster.id) { 
                     rightNeighbor.hp -= 1; 
                     log(`${rightNeighbor.name} (下家) 被火球击中，失去1点生命！`); 
                 }
                break;
            case 8: // 药水: 你增加1点生命
                caster.hp = Math.min(caster.hp + 1, MAX_HP);
                log(`${caster.name} 喝下药水，恢复了1点生命。`);
                break;
        }
        
        // 检查场上秘密石是否被拿光
        if (secretStones.length === 0) {
            log(`场上秘密石已被拿光，游戏立刻结束！`);
            // 触发游戏结束，比较分数
            let winner = players.reduce((prev, current) => (prev.score > current.score) ? prev : current);
            // 实际上应该在 endRound 中处理，或者直接这里结束
            // 简单处理：广播结束
             broadcastState({ gameOver: true, winner: winner.name });
             isGameStarted = false;
             return true;
        }

        // 检查死亡
        return checkDeaths(players[casterIdx].id, false);
    }

    function checkDeaths(actorId, isSuicide = false) {
        let died = false;
        let killedSomeone = false;

        players.forEach(p => {
            if (p.hp <= 0 && !p.isDead) {
                p.isDead = true;
                p.hp = 0;
                log(`${p.name} 被击败了！`);
                died = true;
                if (p.id !== actorId) killedSomeone = true;
                
                // Return hand to graveyard
                graveyard.push(...p.hand);
                p.hand = [];
                
                // 将收集的秘密牌放回墓地？
                // 规则未明确死亡玩家本轮是否丢失收集的秘密牌。
                // 但通常死亡玩家得 0 分。
                // "其他玩家死亡" -> 0 分。
                // 所以是的，丢失收集的秘密牌。
                if (p.collectedStones && p.collectedStones.length > 0) {
                     graveyard.push(...p.collectedStones);
                     p.collectedStones = [];
                }
                // p.score = 0; // 移除：分数在多轮游戏中保留，直到游戏结束，但本轮死亡意味着本轮不得分。除非游戏重新开始，否则总分不应重置为 0。
                // 原代码有 p.score = 1 重置，这对多轮游戏是错误的。
                // 等等，死亡会重置总分吗？
                // Rule: "每轮结算一次积分...本轮结束后，若没有玩家达到8分，便开启下一轮"
                // 这意味着分数是累积的。
                // 死亡仅影响本轮的潜在得分。
            }
        });
        
        if (died) {
            // 如果是自杀 (Actor died)
            let actor = players.find(p => p.id === actorId);
            if (actor && actor.isDead) {
                log(`${actor.name} 自杀了！本轮结束。`);
                endRound(actorId, 'suicide');
                return true;
            }
            
            // 如果击败了别人 (Actor alive, someone else died)
            if (killedSomeone) {
                 log(`${actor.name} 击败了对手！本轮结束。`);
                 endRound(actorId, 'kill');
                 return true;
            }
        }

        return false;
    }

    function endTurn(pIdx) {
        currentSpellChain = 0; // 为下一位玩家重置连锁
        
        // 补牌逻辑：补满5张
        let player = players[pIdx];
        if (!player.isDead) {
            let refilled = false;
            while (player.hand.length < 5) {
                if (drawPile.length > 0) {
                    let newStone = drawPile.shift(); // 从 drawPile 补
                    player.hand.push(newStone);
                    refilled = true;
                } else {
                    break;
                }
            }
            if (refilled) {
                player.hand.sort((a,b) => a - b);
                log(`${player.name} 回合结束，补齐手牌。`, 'turn');
            }
        }

        // 查找下一位存活玩家
        let nextIdx = (pIdx + 1) % players.length;
        let loopCount = 0;
        while (players[nextIdx].isDead && loopCount < players.length) {
            nextIdx = (nextIdx + 1) % players.length;
            loopCount++;
        }
        
        currentPlayerIdx = nextIdx;
        // broadcastState(); // 移除：调用者 (handlePlayerAction) 将广播。这防止了双重广播导致骰子动画同步的竞争条件。
        // checkAITurn(); // 移至 handleStateUpdate 回调以确保同步
    }

    function endRound(triggerPlayerId, reason) {
        // reason: 'empty_hand', 'kill', 'suicide'
        
        // 阻止后续动作
        currentPlayerIdx = -1;
        broadcastState();

        let triggerPlayer = players.find(p => p.id === triggerPlayerId);
        let winnerName = "";

        // 基础分计算
        if (reason === 'empty_hand') {
            // 施放了所有魔法: 他得3分，其他玩家死亡(0分)
            winnerName = triggerPlayer.name;
            triggerPlayer.score += 3;
            log(`${triggerPlayer.name} 打光手牌，获得3分！`, 'win');
            
            // 其他玩家实际上得 0 分。 
            // 存活状态已经在 checkDeaths 中处理吗？不，empty_hand 触发时其他人可能还活着。
            // 规则说 "其他玩家死亡"。
            // 意味着他们不得分（存活分）。
            // 他们的 collectedStones 应该被清空吗？
            // "本轮若你存活，每张秘密牌让你多加一分" -> 既然视为死亡，则不加分。
            // collectedStones 清空。
            players.forEach(p => {
                if (p.id !== triggerPlayerId) {
                    p.isDead = true; // 标记为死亡
                    p.collectedStones = []; // 清空收集，无法获得Owl奖励
                }
            });
            
        } else if (reason === 'kill') {
            // 击败了其他任一玩家: 他得3分，存活玩家得1分
            winnerName = triggerPlayer.name;
            triggerPlayer.score += 3;
            log(`${triggerPlayer.name} 击杀获胜，获得3分！`, 'win');
            
            // 触发者本身也算存活吗？通常 "存活玩家得1分" 指的是其他人。
            // "他得3分，存活玩家得1分" -> 暗示赢家得3分（总共），其他人得1分。
            // 如果赢家也得1分，那就变4分了。通常是 3 vs 1.
            // 让我们保持赢家只得3分。
            players.forEach(p => {
                if (p.id !== triggerPlayerId && !p.isDead) {
                    p.score += 1;
                    log(`${p.name} 存活，获得1分。`, 'win');
                }
            });
            
        } else if (reason === 'suicide') {
            // 因用错魔法自杀: 其他玩家得1分
            // 触发者已死 (checkDeaths 处理了)
            // 触发者得 0 分
            winnerName = "Nobody (Suicide)";
            
            players.forEach(p => {
                if (p.id !== triggerPlayerId && !p.isDead) {
                    p.score += 1;
                    log(`${p.name} 存活，获得1分。`, 'win');
                }
            });
        }

        // 猫头鹰奖励（秘密牌）
        // "若成功施放🦉猫头鹰魔法...本轮若你存活，每张秘密牌让你多加一分"
        // 注意：empty_hand 情况下，其他人都标记为死了，所以只有赢家能拿 Owl 分（如果有的话）。
        // 自杀者已死，拿不到 Owl 分。
        // 被杀者已死，拿不到 Owl 分。
        players.forEach(p => {
            if (!p.isDead && p.collectedStones && p.collectedStones.length > 0) {
                let bonus = p.collectedStones.length;
                p.score += bonus;
                log(`${p.name} 因持有 ${bonus} 张秘密牌，额外获得 ${bonus} 分！`, 'win');
            }
            // 清空收集堆，为下一轮准备
            p.collectedStones = [];
        });

        // 设置下一轮开始者
        // "后面是每轮赢家开始"
        // 如果是 suicide，谁是赢家？没有明确赢家。
        // 这种情况下，也许让下一个顺位的人开始？或者随机？
        // 简单处理：如果是 suicide，下一个人开始。
        // 如果有明确赢家 (empty_hand, kill)，赢家开始。
        if (reason === 'suicide') {
             // 这里的 triggerPlayerId 是死者。
             let deadIdx = players.findIndex(p => p.id === triggerPlayerId);
             nextStarterIdx = (deadIdx + 1) % players.length;
        } else {
             let winIdx = players.findIndex(p => p.id === triggerPlayerId);
             nextStarterIdx = winIdx;
        }

        // 检查游戏胜利
        let gameWinner = players.find(p => p.score >= WIN_SCORE);
        // 如果有多个达到8分，分数最高的胜利
        let highestScore = -1;
        players.forEach(p => { if (p.score > highestScore) highestScore = p.score; });
        
        if (highestScore >= WIN_SCORE) {
            let winners = players.filter(p => p.score === highestScore);
            // 如果平局？
            let finalWinner = winners[0]; 
            
            log(`游戏结束！${finalWinner.name} 获胜！`);
             broadcastState({ gameOver: true, winner: finalWinner.name });
             isGameStarted = false;
        } else {
            // 延迟后开始下一轮
            setTimeout(() => {
                roundNum++;
                startRound();
                broadcastState();
            }, 3000);
        }
    }

    function log(msg, type = 'info', playerId = null) {
        // 结构化日志
        // 尝试识别玩家名字并加粗显示
        let formattedMsg = msg;
        players.forEach(p => {
            if (msg.includes(p.name)) {
                // 使用全局正则将名字替换为加粗 span
                formattedMsg = formattedMsg.replace(new RegExp(p.name, 'g'), `<span class="font-bold text-slate-800">${p.name}</span>`);
            }
        });

        let logEntry = {
            msg: formattedMsg,
            type: type, // info, cast, hit, fail, win, heal, steal, turn
            time: Date.now(),
            playerId: playerId
        };
        gameLog.push(logEntry);
        if (gameLog.length > 50) gameLog.shift();
        // 移除：if (isHost) updateLogUI(); 
        // 房主 UI 更新现在通过广播在 applyState 中处理，以确保与动画同步
    }

    function broadcastState(extra = {}) {
        // 为每位玩家准备状态
        // 我们必须屏蔽他们自己的手牌！
        
        players.forEach(targetP => {
            // 克隆玩家以避免修改源数据
            let maskedPlayers = players.map(p => {
                let pClone = { ...p };
                // 如果是发送给房主自己，保留完整手牌数据，因为房主逻辑需要它
                // UI层会负责隐藏房主自己的手牌
                if (targetP.id === myId && isHost) {
                    // 不屏蔽房主自己
                } else if (p.id === targetP.id) {
                    // 屏蔽我自己的手牌 (对于客户端)
                    pClone.hand = null; 
                    pClone.handCount = p.hand.length;
                } else {
                    // 可见手牌
                    // 保持 pClone.hand 不变
                }
                delete pClone.connection; // 不发送连接对象
                return pClone;
            });

            let state = {
                type: 'state-update',
                players: maskedPlayers,
                currentPlayerIdx,
                roundNum,
                currentSpellChain,
                secretCount: secretStones.length,
                drawPileCount: drawPile.length,
                graveyardCount: graveyard.length, // 也许发送最后几个墓地物品？
                graveyard: graveyard, // 发送完整墓地数据供客户端计算概率
                log: gameLog, // 发送完整日志还是增量？完整日志对同步更安全。
                isGameStarted,
                latestDiceRoll,
                ...extra
            };

            if (targetP.id === myId) {
                // 房主更新
                handleStateUpdate(state);
            } else if (connections[targetP.id]) {
                connections[targetP.id].send(state);
            }
        });
    }

    // --- 网络 ---
    function initPeer() {
        if (peer) return; // 防止多次初始化
        
        const savedId = localStorage.getItem('abracada_peer_id');
        peer = new Peer(savedId, PEER_CONFIG);

        peer.on('open', (id) => {
            myId = id;
            localStorage.setItem('abracada_peer_id', id);
            debugLog('My ID:', id);
            // 如果输入框有值 (来自 URL)，则不要覆盖
            if (!$('#room-id-input').val()) {
                $('#room-id-input').val(id);
            }
            
            // 确保如果是房主，立即更新大厅UI以显示正确的链接
            // 并且更新房主在 players 列表中的 ID (修复初始化时 myId 可能为 null 的问题)
            if (isHost) {
                if (players.length > 0 && players[0].id === null) {
                    players[0].id = myId;
                }
                updateLobbyUI();
            }
        });

        peer.on('connection', (conn) => {
            if (!isHost) {
                conn.close();
                return;
            }
            
            conn.on('open', () => {
                debugLog("New connection:", conn.peer);
                // 添加玩家
                if (players.length >= 5) {
                    conn.send({ type: 'error', msg: 'Room full' });
                    conn.close();
                    return;
                }
                
                connections[conn.peer] = conn;
                
                // 检查玩家是否已存在 (重连)
                let existingPlayer = players.find(p => p.id === conn.peer);
                if (existingPlayer) {
                     debugLog(`Player ${conn.peer} reconnected.`);
                     // 更新连接？
                } else {
                    players.push({
                        id: conn.peer,
                        name: "Player " + (players.length + 1),
                        hp: MAX_HP,
                        score: 0,
                        hand: [],
                        isDead: false,
                        secretStonesFound: 0
                    });
                }
                
                updateLobbyUI();
                
                // 发送初始化数据
                conn.send({ type: 'welcome', playerId: conn.peer });
                // 立即广播最新状态，让所有玩家（包括新加入的）更新大厅列表
                broadcastState();
            });

            conn.on('data', (data) => {
                debugLog(`[HostReceive] From=${conn.peer}, Data=`, data);
                if (data.type === 'action' || data.type === 'game-action') {
                    // 为了健壮性支持新旧协议，虽然我们正在更改客户端以发送 'game-action'
                    // 如果 payload 存在，则使用它；否则使用 data 本身 (为了向后兼容，如果有)
                    let actionPayload = data.payload || data;
                    handlePlayerAction(conn.peer, actionPayload);
                } else if (data.type === 'update-name') {
                    let p = players.find(p => p.id === conn.peer);
                    if (p) {
                        p.name = data.newName;
                        updateLobbyUI();
                        broadcastState();
                    }
                }
            });
            
            conn.on('close', () => {
                // 移除玩家？还是标记为断开连接？
                // 目前如果未开始，则从大厅移除。
                if (!isGameStarted) {
                    players = players.filter(p => p.id !== conn.peer);
                    delete connections[conn.peer];
                    updateLobbyUI();
                } else {
                    // 标记断开连接？
                    log(`Player ${conn.peer} disconnected.`);
                }
            });
        });
    }

    function joinRoom(id) {
        hostConn = peer.connect(id);
        
        hostConn.on('open', () => {
            // 连接成功，但不要立即切换到游戏界面，等待状态同步
            $('#waiting-msg').text("已连接！等待房主开始游戏...");
            $('#create-room-section').addClass('hidden');
            $('#waiting-section').removeClass('hidden');
            $('#btn-start-game').addClass('hidden'); // 访客不能开始
            isHost = false;
            roomId = id;
        });

        hostConn.on('data', (data) => {
            if (data.type === 'welcome') {
                // 初始握手
            } else if (data.type === 'state-update') {
                handleStateUpdate(data);
            } else if (data.type === 'secret-reveal') {
                showToast(`秘密牌是: ${data.stone}号-${SPELLS[data.stone].name}`, 'info');
            } else if (data.type === 'error') {
                alert(data.msg);
            }
        });
        
        hostConn.on('close', () => {
            alert("房主已断开连接");
            exitRoom();
        });
    }

    function handleStateUpdate(state) {
        // 检查是否有新的骰子掷出
        // 如果 localLastDiceRollId 为空（首次连接），则不要播放动画，直接同步ID
        if (state.latestDiceRoll) {
            if (!localLastDiceRollId && !isHost) {
                // 首次连接，同步ID但不播放 (仅限非房主)
                localLastDiceRollId = state.latestDiceRoll.id;
            } else if (!localLastDiceRollId || state.latestDiceRoll.id !== localLastDiceRollId) {
                // 有新的骰子事件
                localLastDiceRollId = state.latestDiceRoll.id;
                isDiceAnimating = true;
                pendingState = state; // 暂存此状态，等待动画结束
                
                // 播放动画
                playDiceAnimation(state.latestDiceRoll.value, () => {
                     isDiceAnimating = false;
                     
                     // 动画结束，应用积压的最新状态
                     if (pendingState) {
                         applyState(pendingState);
                         pendingState = null;
                         
                         // 如果我是房主，动画结束后检查AI
                         if (isHost) {
                             checkAITurn();
                         }
                     }
                });
                return; // 暂停 UI 更新
            }
        }
        
        // 如果正在播放动画，拦截所有更新
        if (isDiceAnimating) {
            // 动画播放中，排队状态更新...
            pendingState = state; // 更新积压状态为最新
            return;
        }
        
        // 正常更新（没有动画，且当前没有动画在播放）
        applyState(state);
        
        // 确保状态更新后立即检查AI (如果无动画)
        if (isHost) {
             checkAITurn();
        }
    }

    function applyState(state) {
        // 同步本地状态
        // 小心合并玩家数据
        players = state.players;
        currentPlayerIdx = state.currentPlayerIdx;
        roundNum = state.roundNum;
        currentSpellChain = state.currentSpellChain;
        isGameStarted = state.isGameStarted;
        
        // 新消息
        // 始终更新日志引用和 UI，以确保房主看到更新，即使数组引用相同
        gameLog = state.log;
        updateLogUI();
        
        // 更新 UI
        if (!isGameStarted) {
             $('#lobby').removeClass('hidden');
             $('#game-room').addClass('hidden');
             updateLobbyUI(); // 显示已加入玩家
             if (!isHost) {
                 $('#create-room-section').addClass('hidden');
                 $('#waiting-section').removeClass('hidden');
             }
        } else {
             $('#lobby').addClass('hidden');
             $('#game-room').removeClass('hidden');
             updateGameUI(state);
        }
        
        if (state.gameOver) {
            $('#winner-name').text(state.winner);
            $('#game-over-modal').removeClass('hidden');
            
            // Only host can restart
            if (isHost) {
                $('#btn-play-again').removeClass('hidden');
            } else {
                $('#btn-play-again').addClass('hidden');
            }
            
            playSound('win');
        } else if (state.isGameStarted) {
            // New game started, auto close modal
            $('#game-over-modal').addClass('hidden');
        }
    }

    // --- UI 更新 ---
    function updateLobbyUI() {
        $('#lobby-players').empty();
        players.forEach(p => {
            let isMe = p.id === myId;
            let nameHtml = isMe 
                ? `<span class="my-lobby-name cursor-pointer hover:bg-slate-200 rounded px-1 transition-colors font-bold text-orange-600" title="点击修改">${p.name}</span>` 
                : p.name;
            
            let removeBtn = '';
            if (isHost && p.isAI) {
                removeBtn = `<button class="btn-remove-bot text-red-500 ml-2 hover:text-red-700 px-1 font-bold" data-id="${p.id}" title="移除机器人">✖</button>`;
            }
            
            $('#lobby-players').append(`<li>${nameHtml} ${isMe ? '(You)' : ''} ${removeBtn}</li>`);
        });
        
        if (isHost) {
            $('#btn-start-game').removeClass('hidden');
            $('#btn-add-bot').removeClass('hidden');
            // 更新分享链接
            const url = new URL(window.location.href);
            url.searchParams.set('room', myId);
            $('#share-url').val(url.toString());
            $('#btn-copy').prop('disabled', false);
            $('#waiting-section').removeClass('hidden');
            $('#create-room-section').addClass('hidden');
        }
    }

    function updateGameUI(state) {
        $('#round-num').text(roundNum);
        $('#secret-count').text(state.secretCount);
        
        let curPlayer = players[currentPlayerIdx];
        $('#current-player-name').text(curPlayer ? curPlayer.name : 'Unknown');
        
        // 渲染我的区域
        let me = players.find(p => p.id === myId);
        if (me) {
            // 如果没有在编辑，仅更新文本
            if ($('#my-name').find('input').length === 0) {
                $('#my-name').text(me.name + (currentPlayerIdx === players.indexOf(me) ? '' : ''));
            }
            $('#my-hp').text(me.hp);
            
            // 塔层显示（已移除）
            // let towerHtml = `<div class="flex flex-col-reverse items-center gap-0.5" title="Tower Layers: ${me.score}">`;
            // for(let i=0; i<me.score; i++) {
            //     towerHtml += `<div class="w-4 h-2 bg-yellow-500 border border-yellow-700 rounded-sm"></div>`;
            // }
            // towerHtml += `</div>`;
            
            // 收集堆显示（收集的秘密牌）
            let collectedHtml = '';
            if (me.collectedStones && me.collectedStones.length > 0) {
                // 显示为单个计数值
                collectedHtml = `<div class="flex items-center justify-center gap-1 mt-1 text-[10px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-200" title="Collected Stones">
                    <span>🦉</span>
                    <span>${me.collectedStones.length}</span>
                </div>`;
            }
            
            $('#my-score').html(`
                <div class="flex flex-col items-center">
                    <div>${me.score}</div>
                    ${collectedHtml}
                </div>
            `);
            
            // 手牌
            $('#my-hand').empty();
            let count = me.handCount !== undefined ? me.handCount : (me.hand ? me.hand.length : 0);
            for(let i=0; i<count; i++) {
                $('#my-hand').append(`<div class="stone-back">?</div>`);
            }
            
        // 控制
        let isMyTurn = (curPlayer && curPlayer.id === myId) && !me.isDead;
        
        // 更新回合指示器
        if (isMyTurn) {
            $('#my-turn-indicator').removeClass('hidden');
        } else {
            $('#my-turn-indicator').addClass('hidden');
        }

        debugLog(`Update UI: MyTurn=${isMyTurn}, CurPlayer=${curPlayer ? curPlayer.id : 'null'}, MyId=${myId}`);
        
        $('.spell-btn').prop('disabled', !isMyTurn);
        
        if (isMyTurn) {
            // 禁用小于 currentSpellChain 的咒语
            for(let i=1; i<=8; i++) {
                if (i < currentSpellChain) {
                    $(`.btn-${i}`).prop('disabled', true);
                } else {
                     // 确保有效咒语被启用
                     $(`.btn-${i}`).prop('disabled', false);
                }
            }
            
            // 显示/隐藏停止按钮
            // 只有 chain > 0 (意味着我至少施放了一个咒语) 才能停止
            if (currentSpellChain > 0) {
                $('#btn-stop').removeClass('hidden');
            } else {
                $('#btn-stop').addClass('hidden');
            }
        } else {
             $('#btn-stop').addClass('hidden');
        }
        }

        // 渲染对手
        $('#opponents-area').empty();
        
        // 计算已知牌 (墓地 + 对手手牌)
        let visibleCounts = {};
        for(let i=1; i<=8; i++) visibleCounts[i] = 0;
        
        // 墓地
        if (state.graveyard) {
            state.graveyard.forEach(s => visibleCounts[s]++);
        }
        
        // 对手手牌 (注意: players 在 applyState 中已经更新为 state.players)
        // 但 state.players 对于“我”是屏蔽的。对于“对手”是可见的。
        // 我们需要遍历所有对手。
        players.forEach(p => {
            if (p.id !== myId) {
                if (p.hand && Array.isArray(p.hand)) {
                    p.hand.forEach(s => visibleCounts[s]++);
                }
            }
        });
        
        // 更新 Tooltips 和 按钮文本
        for(let i=1; i<=8; i++) {
            let count = visibleCounts[i];
            let total = SPELLS[i].count;
            
            $(`.visible-count-${i}`).text(count);
            
            // 更新按钮
            let shortName = SHORT_NAMES[i];
            let countClass = (count === total) ? "text-red-600 font-bold" : "text-slate-100";
            
            // 保持按钮文本与计数更新
            $(`.btn-${i}`).html(`${i} ${shortName} <span class="${countClass} text-[10px] ml-0.5">(${count}/${total})</span>`);
        }

        players.forEach((p, idx) => {
            if (p.id === myId) return;
            
            let isCurrent = (idx === currentPlayerIdx);
            let borderClass = isCurrent ? 'border-orange-500 shadow-md ring-2 ring-orange-200' : 'border-transparent';
            let opacityClass = p.isDead ? 'opacity-50 grayscale' : '';
            
            // 塔层显示（已移除）
            // let towerHtml = `<div class="flex flex-col-reverse items-center gap-0.5 ml-2" title="Tower Layers: ${p.score}">`;
            // for(let i=0; i<p.score; i++) {
            //     towerHtml += `<div class="w-3 h-1.5 bg-yellow-500 border border-yellow-700 rounded-sm"></div>`;
            // }
            // towerHtml += `</div>`;
            
            // 收集堆显示
            let collectedHtml = '';
            if (p.collectedStones && p.collectedStones.length > 0) {
                // 显示为带有猫头鹰图标的计数
                collectedHtml = `<div class="ml-1 flex items-center gap-0.5 text-[10px] text-blue-600 bg-blue-50 px-1 rounded-full border border-blue-200"><span>🦉</span><span>${p.collectedStones.length}</span></div>`;
            }

            let stonesHtml = '';
            if (p.hand && Array.isArray(p.hand)) {
                p.hand.forEach(s => {
                    stonesHtml += `<div class="stone stone-${s}">${s}</div>`;
                });
            } else if (p.handCount) {
                // 如果状态正确，对手不应该发生这种情况，
                // 除非我们处于旁观模式？
                // 在我们的逻辑中，我们接收对手的完整手牌。
            }

            let html = `
                <div class="bg-white p-3 rounded-lg shadow border-2 ${borderClass} ${opacityClass}">
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-bold truncate" title="${p.name}">${p.name}</span>
                        <div class="flex items-center">
                            <span class="bg-red-50 text-red-600 px-1 rounded mr-1">❤️ ${p.hp}</span>
                            <span class="bg-yellow-50 text-yellow-600 px-1 rounded flex items-center">
                                🏆 ${p.score} 
                                ${collectedHtml}
                            </span>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-1 min-h-[40px]">
                        ${stonesHtml}
                    </div>
                </div>
            `;
            $('#opponents-area').append(html);
        });
    }

    function updateLogUI() {
        const $log = $('#game-log');
        $log.empty();
        
        gameLog.forEach(entry => {
            // 旧字符串日志的向后兼容性
            let msg = typeof entry === 'string' ? entry : entry.msg;
            let type = typeof entry === 'object' ? entry.type : 'info';
            let playerId = typeof entry === 'object' ? entry.playerId : null;
            
            let icon = '📝';
            let bgColor = 'bg-slate-50';
            let textColor = 'text-slate-600';
            let borderColor = 'border-slate-200'; // 将左侧条的默认值更改为可见边框

            switch(type) {
                case 'cast': 
                    icon = '🪄'; 
                    bgColor = 'bg-purple-50/50'; // 更浅
                    textColor = 'text-purple-700'; 
                    borderColor = 'border-purple-400';
                    break;
                case 'hit': 
                    icon = '💥'; 
                    bgColor = 'bg-red-50/50'; 
                    textColor = 'text-red-700';
                    borderColor = 'border-red-400';
                    break;
                case 'fail': 
                    icon = '💨'; 
                    bgColor = 'bg-gray-50'; 
                    textColor = 'text-gray-500';
                    borderColor = 'border-gray-300';
                    break;
                case 'win': 
                    icon = '🏆'; 
                    bgColor = 'bg-yellow-50/50'; 
                    textColor = 'text-yellow-700 font-bold';
                    borderColor = 'border-yellow-400';
                    break;
                case 'heal': 
                    icon = '💖'; 
                    bgColor = 'bg-pink-50/50'; 
                    textColor = 'text-pink-600';
                    borderColor = 'border-pink-400';
                    break;
                case 'steal': 
                    icon = '👻'; 
                    bgColor = 'bg-indigo-50/50'; 
                    textColor = 'text-indigo-600';
                    borderColor = 'border-indigo-400';
                    break;
                case 'turn': 
                    icon = '👉'; 
                    bgColor = 'bg-blue-50/50'; 
                    textColor = 'text-blue-600';
                    borderColor = 'border-blue-400';
                    break;
            }
            
            // 紧凑日志样式
            let html = `
                <div class="flex items-start gap-1.5 py-0.5 px-1.5 rounded-r border-l-4 ${borderColor} ${bgColor} mb-0.5 animate-fade-in text-[11px] md:text-xs leading-tight">
                    <span class="${textColor} break-words">${msg}</span>
                </div>
            `;
            $log.append(html);
        });
        
        // 更新滚动条
        if (gameLog.length > 0) {
            const lastEntry = gameLog[gameLog.length - 1];
            let lastMsg = typeof lastEntry === 'string' ? lastEntry : lastEntry.msg;
            $('#log-ticker').html(lastMsg).removeClass('opacity-0').addClass('animate-pulse');
            setTimeout(() => $('#log-ticker').removeClass('animate-pulse'), 500);
        }

        // 在最后一个元素上使用 scrollIntoView
        const lastElement = $log.children().last()[0];
        if (lastElement) {
            lastElement.scrollIntoView({ behavior: "smooth", block: "end" });
        }
    }

    function showToast(msg, type='info') {
        // 简单弹窗或自定义提示
        // 目前使用日志
        log(`[System] ${msg}`);
    }

    function playDiceAnimation(resultValue, callback) {
        const $overlay = $('#dice-overlay');
        const $diceVal = $('#dice-value');
        
        // 确保覆盖层存在
        if ($overlay.length === 0) {
            $('body').append(`
                <div id="dice-overlay" class="fixed inset-0 bg-black/50 flex items-center justify-center hidden z-50">
                    <div id="dice-box" class="bg-white p-10 rounded-xl shadow-2xl flex flex-col items-center animate-bounce-in">
                        <div class="text-2xl font-bold mb-4 text-slate-700">🎲 掷骰子中...</div>
                        <div id="dice-value" class="text-8xl font-mono font-bold text-orange-600">?</div>
                    </div>
                </div>
            `);
        }
        
        // 检查是否已在动画中
        if (!$('#dice-overlay').hasClass('hidden')) {
            // 强制重置还是排队？
            // 简单方法：立即强制完成上一个动画
            // 但更好的是：用新值重新开始逻辑
            // 我们需要清除任何现有的间隔
            if (window.currentDiceInterval) clearInterval(window.currentDiceInterval);
        }

        $('#dice-overlay').removeClass('hidden');
        
        // 动画循环
        let duration = 1500; // 1.5 seconds
        let interval = 100;
        let elapsed = 0;
        
        window.currentDiceInterval = setInterval(() => {
            let randomVal = Math.floor(Math.random() * 3) + 1;
            $('#dice-value').text(randomVal);
            elapsed += interval;
            
            if (elapsed >= duration) {
                clearInterval(window.currentDiceInterval);
                window.currentDiceInterval = null;
                
                // 显示最终结果
                $('#dice-value').text(resultValue);
                // 稍等片刻以显示结果
                setTimeout(() => {
                    $('#dice-overlay').addClass('hidden');
                    if (callback) callback();
                }, 1000);
            }
        }, interval);
    }

    // --- 事件监听器 ---
    $('#btn-create').click(() => {
        isHost = true;
        initHostGame();
        initPeer(); // 启动 peer
        $('#room-link-container').removeClass('hidden'); // 确保显示链接
        $('#waiting-msg').removeClass('hidden'); // 显示等待动画
    });

    $('#btn-ai').click(() => {
        isHost = true;
        initHostGame();
        // 添加 1 个默认机器人
        addBot();
        // 设置 UI 为大厅模式，但隐藏在线相关元素
        $('#lobby').removeClass('hidden');
        $('#game-room').addClass('hidden');
        $('#create-room-section').addClass('hidden');
        $('#waiting-section').removeClass('hidden');
        $('#room-link-container').addClass('hidden'); // 隐藏链接
        $('#waiting-msg').addClass('hidden'); // 隐藏等待动画
        $('#btn-start-game').removeClass('hidden');
        $('#btn-add-bot').removeClass('hidden');
    });

    $('#btn-add-bot').click(() => {
        addBot();
    });

    $(document).on('click', '.btn-remove-bot', function() {
        let botId = $(this).data('id');
        removeBot(botId);
    });

    $('#btn-join').click(() => {
        let id = $('#room-id-input').val().trim();
        if (!id) return alert("请输入房间ID");
        
        // 禁用按钮以防止双击
        $('#btn-join').prop('disabled', true).text('连接中...');
        
        initPeer();
        // 等待打开
        let check = setInterval(() => {
            if (myId) {
                clearInterval(check);
                
                // 检查是否加入自己 (房主刷新)
                if (myId === id) {
                    isHost = true;
                    // 恢复房主 UI
                    updateLobbyUI();
                    $('#btn-join').prop('disabled', false).text('加入');
                    // 也许显示提示？
                    showToast("欢迎回来，房主！", "success");
                } else {
                    joinRoom(id);
                    // 按钮重置将在连接成功/失败或超时时发生
                    setTimeout(() => {
                         $('#btn-join').prop('disabled', false).text('加入');
                    }, 5000);
                }
            }
        }, 100);
    });

        $('#btn-toggle-log').click(() => {
        $('#log-container').removeClass('hidden').addClass('flex');
    });

    $('#btn-close-log').click(() => {
        $('#log-container').addClass('hidden').removeClass('flex');
    });

    $('#btn-start-game').click(() => {
        if (isHost) hostStartGame();
    });

    $('#btn-copy').click(() => {
        let url = $('#share-url').val();
        if (!url || url.includes('room=null')) {
            alert("链接尚未生成，请稍候...");
            return;
        }
        
        // 尝试使用 Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                showToast("链接已复制！", "success");
                let originalText = $('#btn-copy').text();
                $('#btn-copy').text("已复制").addClass('text-green-500').removeClass('text-orange-500');
                setTimeout(() => $('#btn-copy').text(originalText).addClass('text-orange-500').removeClass('text-green-500'), 2000);
            }).catch(err => {
                console.error("Clipboard API failed:", err);
                fallbackCopy(url);
            });
        } else {
            fallbackCopy(url);
        }
    });

    function fallbackCopy(text) {
        let $temp = $("<input>");
        $("body").append($temp);
        $temp.val(text).select();
        try {
            document.execCommand("copy");
            showToast("链接已复制！", "success");
            let originalText = $('#btn-copy').text();
            $('#btn-copy').text("已复制").addClass('text-green-500').removeClass('text-orange-500');
            setTimeout(() => $('#btn-copy').text(originalText).addClass('text-orange-500').removeClass('text-green-500'), 2000);
        } catch (e) {
            alert("复制失败，请手动复制输入框中的链接");
        }
        $temp.remove();
    }

    $('#btn-leave').click(() => {
        if (confirm("确定要退出房间吗？")) {
            exitRoom();
        }
    });

    function exitRoom() {
        if (isHost) {
            // 关闭所有连接
            Object.values(connections).forEach(conn => conn.close());
            connections = {};
            players = [];
            isHost = false;
        } else {
            if (hostConn) {
                hostConn.close();
                hostConn = null;
            }
        }
        
        // 重置状态
        isGameStarted = false;
        roomId = null;
        gameLog = [];
        
        // 重置 URL
        const url = new URL(window.location.href);
        url.searchParams.delete('room');
        window.history.pushState({}, '', url);
        $('#room-id-input').val(myId || ''); // 重置输入框为我的 ID
        
        // 重置 UI
        $('#game-room').addClass('hidden');
        $('#lobby').removeClass('hidden');
        $('#create-room-section').removeClass('hidden');
        $('#waiting-section').addClass('hidden');
        $('#room-link-container').removeClass('hidden'); // 恢复默认可见性
        $('#waiting-msg').removeClass('hidden'); // 恢复默认可见性
        $('#btn-start-game').addClass('hidden');
        $('#btn-add-bot').addClass('hidden');
        $('#btn-join').prop('disabled', false).text('加入');
        $('#game-over-modal').addClass('hidden'); // 确保退出时隐藏模态框
        
        updateLobbyUI();
    }

    $('#btn-close-gameover').click(() => {
        $('#game-over-modal').addClass('hidden');
    });

    $('#btn-play-again').click(() => {
        $('#game-over-modal').addClass('hidden');
        if (isHost) {
            hostStartGame();
        }
    });

    // 为动态按钮使用委托事件处理程序
    $(document).on('click', '.spell-btn', function() {
        let spell = $(this).data('spell');
        debugLog(`[Click] Casting spell: ${spell}`);
        sendAction({ type: 'cast', spell: spell });
    });

    $('#btn-stop').click(() => {
        sendAction({ type: 'stop' });
    });

    function sendAction(action) {
        debugLog(`[SendAction] isHost=${isHost}, Action=`, action);
        if (isHost) {
            handlePlayerAction(myId, action);
        } else {
            if (hostConn) {
                debugLog(`[SendAction] 通过连接发送给房主`);
                // 使用 'game-action' 并包装 payload 以防止类型冲突
                hostConn.send({ type: 'game-action', payload: action });
            } else {
                console.error("[SendAction] No host connection!");
            }
        }
    }
    
    // --- 名字编辑 ---
    function startEditing($element) {
         if ($element.find('input').length > 0) return; // 已经在编辑
         
         let me = players.find(p => p.id === myId);
         let nameToEdit = me ? me.name : (myName || "Me");
         
         let $input = $('<input type="text" class="border rounded px-1 text-slate-800 w-32 shadow-sm" />').val(nameToEdit);
         
         $element.html($input);
         $input.focus();
         $input.select();
    }

    $(document).on('click', '#my-name', function(e) {
        e.stopPropagation();
        startEditing($(this));
    });

    $(document).on('click', '.my-lobby-name', function(e) {
        e.stopPropagation();
        startEditing($(this));
    });

    // 处理外部点击以保存
    $(document).on('click', function(e) {
        if (!$(e.target).closest('#my-name, .my-lobby-name').length) {
            // 检查这些容器中是否有任何输入框处于活动状态
            let $input = $('#my-name input, .my-lobby-name input');
            if ($input.length > 0) {
                saveName($input.val());
            }
        }
    });

    $(document).on('keydown', '#my-name input, .my-lobby-name input', function(e) {
        if (e.key === 'Enter') {
            saveName($(this).val());
        }
        if (e.key === 'Escape') {
             // 取消编辑 - 恢复 UI
             let me = players.find(p => p.id === myId);
             if (me) {
                 if ($(this).closest('#my-name').length) {
                     $('#my-name').text(me.name + (currentPlayerIdx === players.indexOf(me) ? '' : ''));
                 } else {
                     updateLobbyUI();
                 }
             }
        }
        e.stopPropagation(); 
    });

    function saveName(newName) {
        newName = newName ? newName.trim() : "";
        let me = players.find(p => p.id === myId);
        
        if (!newName) {
             // 恢复
             if (me) {
                 if ($('#my-name').find('input').length > 0) {
                     $('#my-name').text(me.name + (currentPlayerIdx === players.indexOf(me) ? '' : ''));
                 }
                 updateLobbyUI();
             }
             return; 
        }
        
        if (isHost) {
            if (me) {
                me.name = newName;
                myName = newName; 
                broadcastState();
                // 立即刷新 UI
                if ($('#my-name').length) {
                    $('#my-name').text(me.name + (currentPlayerIdx === players.indexOf(me) ? '' : ''));
                }
                updateLobbyUI();
            }
        } else {
             if (hostConn) {
                 hostConn.send({ type: 'update-name', newName: newName });
                 // 乐观更新
                 let $input = $('#my-name input, .my-lobby-name input');
                 if ($input.length > 0) {
                     $input.parent().text(newName);
                 }
             }
        }
    }
    
    // 从 URL 自动加入
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        $('#room-id-input').val(roomParam);
        // 自动点击加入
        debugLog("Auto joining room:", roomParam);
        setTimeout(() => {
             $('#btn-join').click();
        }, 500);
    }

});
