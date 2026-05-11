$(document).ready(function() {
    const icons = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'];
    let cards = [...icons, ...icons];
    let flippedCards = [];
    let matchedPairs = 0;
    let moves = 0;
    let timer = null;
    let seconds = 0;
    let isGameActive = false;

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function updateTimer() {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        $('#time').text(`${mins}:${secs}`);
        seconds++;
    }

    function initGame() {
        const $board = $('#memory-game');
        $board.empty();
        cards = shuffle(cards);
        flippedCards = [];
        matchedPairs = 0;
        moves = 0;
        seconds = 0;
        isGameActive = true;
        
        $('#moves').text('0');
        $('#time').text('00:00');
        clearInterval(timer);
        timer = setInterval(updateTimer, 1000);
        $('#win-modal').addClass('hidden').removeClass('flex');

        cards.forEach((icon, index) => {
            const $card = $(`
                <div class="aspect-square cursor-pointer relative" data-index="${index}" data-icon="${icon}">
                    <div class="absolute inset-0 flex items-center justify-center text-2xl transition-all duration-300 rounded-xl border-2 border-slate-200 bg-white shadow-sm text-slate-300 hover:border-orange-300">
                        ?
                    </div>
                    <div class="absolute inset-0 flex items-center justify-center text-4xl bg-orange-50 rounded-xl opacity-0 transition-all duration-300 border-2 border-orange-200 shadow-inner">
                        ${icon}
                    </div>
                </div>
            `);

            $card.on('click', function() {
                if (!isGameActive || $(this).hasClass('flipped') || flippedCards.length >= 2) return;

                $(this).addClass('flipped');
                $(this).find('div:first').addClass('opacity-0');
                $(this).find('div:last').removeClass('opacity-0');
                
                flippedCards.push($(this));

                if (flippedCards.length === 2) {
                    moves++;
                    $('#moves').text(moves);
                    checkMatch();
                }
            });

            $board.append($card);
        });
    }

    function checkMatch() {
        const [card1, card2] = flippedCards;
        const icon1 = card1.data('icon');
        const icon2 = card2.data('icon');

        if (icon1 === icon2) {
            matchedPairs++;
            card1.addClass('matched').off('click');
            card1.find('div:last').addClass('border-green-400 bg-white');
            
            card2.addClass('matched').off('click');
            card2.find('div:last').addClass('border-green-400 bg-white');
            
            flippedCards = [];

            if (matchedPairs === icons.length) {
                endGame();
            }
        } else {
            setTimeout(() => {
                card1.removeClass('flipped');
                card1.find('div:first').removeClass('opacity-0');
                card1.find('div:last').addClass('opacity-0');
                
                card2.removeClass('flipped');
                card2.find('div:first').removeClass('opacity-0');
                card2.find('div:last').addClass('opacity-0');
                
                flippedCards = [];
            }, 800);
        }
    }

    function endGame() {
        isGameActive = false;
        clearInterval(timer);
        setTimeout(() => {
            $('#win-modal').removeClass('hidden').addClass('flex');
        }, 500);
    }

    $('#restart-btn').on('click', initGame);
    
    // 大厅逻辑
    $('#btn-single').on('click', function() {
        $('#lobby').addClass('hidden');
        $('#game-board').removeClass('hidden');
        initGame();
    });



    // 退出游戏
    $('#btn-quit').on('click', function() {
        isGameActive = false;
        clearInterval(timer);
        $('#game-board').addClass('hidden');
        $('#lobby').removeClass('hidden');
    });

    // 胜利弹窗逻辑
    $('#btn-play-again').on('click', function() {
        initGame();
    });

    // initGame(); // 移除自动开始
});