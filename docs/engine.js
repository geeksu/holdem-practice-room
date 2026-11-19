(function (root) {
  'use strict';

  // No-limit reference: TDA rules 21, 23, 36, 45 and 49.
  // https://www.pokertda.com/view-poker-tda-rules/
  // Short opening all-ins do not allow "completing" a no-limit bet:
  // https://www.pokertda.com/forum/index.php?topic=1456.0

  const SUITS = ['s', 'h', 'd', 'c'];
  const PHASE_NAMES = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
  const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

  function compare(a, b) {
    const av = Array.isArray(a) ? a : a.score;
    const bv = Array.isArray(b) ? b : b.score;
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const difference = (av[i] || 0) - (bv[i] || 0);
      if (difference) return Math.sign(difference);
    }
    return 0;
  }

  function five(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const counts = new Map();
    ranks.forEach(rank => counts.set(rank, (counts.get(rank) || 0) + 1));
    const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every(c => c.suit === cards[0].suit);
    const unique = [...counts.keys()];
    if (unique.includes(14)) unique.push(1);
    let straight = 0;
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) { straight = unique[i]; break; }
    }
    let score;
    if (flush && straight) score = [8, straight];
    else if (groups[0][1] === 4) score = [7, groups[0][0], groups[1][0]];
    else if (groups[0][1] === 3 && groups[1][1] === 2) score = [6, groups[0][0], groups[1][0]];
    else if (flush) score = [5, ...ranks];
    else if (straight) score = [4, straight];
    else if (groups[0][1] === 3) score = [3, groups[0][0], ...groups.slice(1).map(g => g[0])];
    else if (groups[0][1] === 2 && groups[1][1] === 2) score = [2, groups[0][0], groups[1][0], groups[2][0]];
    else if (groups[0][1] === 2) score = [1, groups[0][0], ...groups.slice(1).map(g => g[0])];
    else score = [0, ...ranks];
    return { score, category: score[0], name: score[0] === 8 && score[1] === 14 ? '皇家同花顺' : HAND_NAMES[score[0]], cards: cards.slice() };
  }

  function evaluate(cards) {
    if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) {
      throw new Error('牌型评估需要 5 至 7 张牌。');
    }
    let best = null;
    const n = cards.length;
    for (let a = 0; a < n - 4; a++)
      for (let b = a + 1; b < n - 3; b++)
        for (let c = b + 1; c < n - 2; c++)
          for (let d = c + 1; d < n - 1; d++)
            for (let e = d + 1; e < n; e++) {
              const hand = five([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || compare(hand, best) > 0) best = hand;
            }
    return best;
  }

  class PokerEngine {
    constructor(options = {}) {
      const startingStack = options.startingStack === undefined ? 1000 : options.startingStack;
      if (!Number.isInteger(startingStack) || startingStack < 1) throw new Error('初始筹码必须为正整数。');
      const playerCount = options.playerCount === undefined ? 8 : options.playerCount;
      if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) throw new Error('玩家数量须为 2 至 8 人。');
      this.rng = typeof options.rng === 'function' ? options.rng : Math.random;
      this.botPolicy = typeof options.botPolicy === 'function' ? options.botPolicy : null;
      this.smallBlind = 10;
      this.bigBlind = 20;
      const personas = [['你', 'human'], ['磐石', 'tag'], ['烈焰', 'lag'], ['千面', 'balanced'],
        ['狙击', 'nit'], ['暗影', 'trap'], ['疾风', 'pressure'], ['铁壁', 'defend']];
      this.state = {
        phase: 'idle', handNo: 0, dealer: playerCount - 1, actor: null,
        smallBlindSeat: null, bigBlindSeat: null, board: [],
        players: personas.slice(0, playerCount).map(([name, style]) => ({
          name, style, stack: startingStack, bet: 0, cards: [], folded: false, out: false, lastAction: '',
        })),
        pot: 0, currentBet: 0, minRaise: this.bigBlind, log: ['筹码就绪，开始第一手。'], result: null,
      };
      this._contributions = Array(playerCount).fill(0);
      // Track each seat's own last decision level; cumulative short all-ins may
      // reopen one seat's raise rights without reopening another seat's rights.
      this._actedAt = Array(playerCount).fill(null);
      this._deck = [];
    }

    _random() { return Math.max(0, Math.min(0.999999999999, Number(this.rng()) || 0)); }

    _seatsAfter(seat) {
      return this.state.players.map((_, offset) => (seat + offset + 1) % this.state.players.length);
    }

    _nextSeat(seat, predicate) { return this._seatsAfter(seat).find(i => predicate(this.state.players[i], i)); }

    _liveSeats() { return this.state.players.map((_, i) => i).filter(i => !this.state.players[i].out && !this.state.players[i].folded); }

    _pay(index, amount) {
      const p = this.state.players[index];
      const paid = Math.min(p.stack, amount);
      p.stack -= paid;
      p.bet += paid;
      this.state.pot += paid;
      this._contributions[index] += paid;
      return paid;
    }

    startHand() {
      const s = this.state;
      if (s.phase !== 'idle' && s.phase !== 'complete') throw new Error('请先完成当前这手牌。');
      if (s.players.filter(p => p.stack > 0).length < 2) throw new Error('本桌已分出胜负，请重新开始。');
      const previousHandSize = s.players.filter(p => !p.out).length;
      const enteringHeadsUp = s.handNo > 0 && previousHandSize > 2 && s.players.filter(p => p.stack > 0).length === 2;
      // On the transition to heads-up, do not give a surviving big blind the
      // big blind twice in a row. It becomes the button/small blind instead.
      s.dealer = enteringHeadsUp && s.players[s.bigBlindSeat].stack > 0 ? s.bigBlindSeat : this._nextSeat(s.dealer, p => p.stack > 0);
      s.handNo++;
      s.phase = 'preflop';
      s.board = [];
      s.pot = 0;
      s.currentBet = this.bigBlind; // The nominal big blind remains a full bet even if posted short.
      s.minRaise = this.bigBlind;
      s.result = null;
      s.log = [`第 ${s.handNo} 手 · ${s.players[s.dealer].name}是庄家。`];
      this._contributions.fill(0);
      this._actedAt.fill(null);
      s.players.forEach(p => {
        p.bet = 0; p.out = p.stack === 0; p.folded = false; p.cards = [];
        p.lastAction = p.out ? '已离桌' : '';
      });
      const participants = this._liveSeats();
      s.smallBlindSeat = participants.length === 2 ? s.dealer : this._nextSeat(s.dealer, p => !p.out);
      s.bigBlindSeat = this._nextSeat(s.smallBlindSeat, p => !p.out);
      this._deck = SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit })));
      for (let i = this._deck.length - 1; i > 0; i--) {
        const j = Math.floor(this._random() * (i + 1));
        [this._deck[i], this._deck[j]] = [this._deck[j], this._deck[i]];
      }
      const dealOrder = this._seatsAfter(s.dealer).filter(i => !s.players[i].out);
      for (let round = 0; round < 2; round++) for (const i of dealOrder) s.players[i].cards.push(this._deck.pop());
      const small = this._pay(s.smallBlindSeat, this.smallBlind);
      const big = this._pay(s.bigBlindSeat, this.bigBlind);
      s.players[s.smallBlindSeat].lastAction = `小盲 ${small}${s.players[s.smallBlindSeat].stack === 0 ? ' · 全下' : ''}`;
      s.players[s.bigBlindSeat].lastAction = `大盲 ${big}${s.players[s.bigBlindSeat].stack === 0 ? ' · 全下' : ''}`;
      s.log.push(`${s.players[s.smallBlindSeat].name}下小盲 ${small}；${s.players[s.bigBlindSeat].name}下大盲 ${big}。`);
      this._progress(s.bigBlindSeat);
      return s;
    }

    legalActions(index) {
      const s = this.state;
      const p = s.players[index];
      const active = !!p && s.actor === index && s.phase !== 'idle' && s.phase !== 'complete' && !p.folded && !p.out && p.stack > 0;
      const due = p ? Math.max(0, s.currentBet - p.bet) : 0;
      const maxRaiseTo = p ? p.bet + p.stack : 0;
      const raiseRights = this._actedAt[index] === null || s.currentBet - this._actedAt[index] >= s.minRaise;
      // No betting into an empty side pot: another live seat must be able to
      // contest a wager above the current level, not merely hold uncalled chips.
      const canRespondToRaise = s.players.some((other, i) => i !== index && !other.folded && !other.out && other.stack > 0 && other.bet + other.stack > s.currentBet);
      return {
        canFold: active,
        canCheck: active && due === 0,
        canCall: active && due > 0,
        callAmount: active ? Math.min(due, p.stack) : 0,
        canRaise: active && raiseRights && canRespondToRaise && maxRaiseTo > s.currentBet,
        minRaiseTo: Math.min(s.currentBet + s.minRaise, maxRaiseTo),
        maxRaiseTo,
      };
    }

    act(index, action, raiseTo) {
      const s = this.state;
      const legal = this.legalActions(index);
      if (!legal.canFold) throw new Error('还没有轮到这一方行动。');
      const p = s.players[index];
      if (action === 'fold') {
        p.folded = true;
        p.lastAction = '弃牌';
        s.log.push(`${p.name}弃牌。`);
      } else if (action === 'call') {
        const paid = this._pay(index, legal.callAmount);
        p.lastAction = paid ? `${p.stack === 0 ? '全下跟注' : '跟注'} ${paid}` : '过牌';
        s.log.push(`${p.name}${p.lastAction}。`);
        this._actedAt[index] = s.currentBet;
      } else if (action === 'raise') {
        if (!legal.canRaise || !Number.isInteger(raiseTo) || raiseTo < legal.minRaiseTo || raiseTo > legal.maxRaiseTo || raiseTo <= s.currentBet) {
          throw new Error('加注金额不符合规则。');
        }
        const increment = raiseTo - s.currentBet;
        const fullRaise = increment >= s.minRaise;
        if (!fullRaise && raiseTo !== legal.maxRaiseTo) throw new Error('不足最小加注额时，只能全下。');
        this._pay(index, raiseTo - p.bet);
        s.currentBet = raiseTo;
        if (fullRaise) s.minRaise = increment;
        this._actedAt[index] = raiseTo;
        p.lastAction = `${p.stack === 0 ? '全下至' : '加注至'} ${raiseTo}`;
        s.log.push(`${p.name}${p.lastAction}${!fullRaise ? '（不足完整加注）' : ''}。`);
      } else {
        throw new Error('未知行动。');
      }
      this._progress(index);
      return s;
    }

    _progress(previous) {
      const s = this.state;
      const live = this._liveSeats();
      if (live.length === 1) { this._settle(false); return; }
      const able = live.filter(i => s.players[i].stack > 0);
      if (able.length <= 1) {
        // With no other opponent able to bet, only an actual unmatched all-in
        // needs a response. A nominal short big blind cannot create a side pot.
        s.currentBet = Math.max(...live.map(i => s.players[i].bet));
        if (able.length === 1 && s.players[able[0]].bet < s.currentBet) s.actor = able[0];
        else this._runout();
        return;
      }
      const next = this._nextSeat(previous, (p, i) => !p.out && !p.folded && p.stack > 0 && (this._actedAt[i] === null || p.bet < s.currentBet));
      if (next !== undefined) s.actor = next;
      else this._nextStreet();
    }

    _dealStreet() {
      const s = this.state;
      this._deck.pop();
      if (s.phase === 'preflop') {
        s.phase = 'flop';
        s.board.push(this._deck.pop(), this._deck.pop(), this._deck.pop());
      } else if (s.phase === 'flop') {
        s.phase = 'turn';
        s.board.push(this._deck.pop());
      } else if (s.phase === 'turn') {
        s.phase = 'river';
        s.board.push(this._deck.pop());
      }
      s.log.push(`进入${PHASE_NAMES[s.phase]}。`);
    }

    _nextStreet() {
      const s = this.state;
      if (s.phase === 'river') { this._settle(true); return; }
      this._dealStreet();
      s.players.forEach(p => {
        p.bet = 0;
        if (!p.folded && !p.out) p.lastAction = p.stack === 0 ? '全下' : '';
      });
      s.currentBet = 0;
      s.minRaise = this.bigBlind;
      this._actedAt.fill(null);
      this._progress(s.dealer);
    }

    _refundUnmatched() {
      const ordered = this._contributions.map((amount, i) => ({ amount, i })).sort((a, b) => b.amount - a.amount);
      const refund = ordered[0].amount - ordered[1].amount;
      if (refund <= 0) return;
      const i = ordered[0].i;
      this._contributions[i] -= refund;
      this.state.pot -= refund;
      const p = this.state.players[i];
      p.stack += refund;
      p.bet = Math.max(0, p.bet - refund);
      this.state.log.push(`${p.name}收回无人跟注的 ${refund} 筹码。`);
    }

    _runout() {
      this._refundUnmatched();
      while (this.state.phase !== 'river') this._dealStreet();
      this._settle(true);
    }

    _settle(showdown) {
      const s = this.state;
      this._refundUnmatched();
      const live = this._liveSeats();
      const hands = s.players.map((p, i) => showdown && live.includes(i) ? evaluate([...p.cards, ...s.board]) : null);
      const handNames = hands.map(h => h ? h.name : null);
      const payouts = s.players.map(() => 0);
      const levels = [...new Set(this._contributions.filter(value => value > 0))].sort((a, b) => a - b);
      const pots = [];
      let previous = 0;
      for (const level of levels) {
        const contributors = s.players.map((_, i) => i).filter(i => this._contributions[i] >= level);
        const amount = (level - previous) * contributors.length;
        const eligible = contributors.filter(i => live.includes(i));
        if (!eligible.length) throw new Error('内部错误：底池缺少有资格的玩家。');
        // Folded dead money can introduce contribution levels, but does not
        // create a new side pot when the set of eligible live hands is unchanged.
        const last = pots[pots.length - 1];
        if (last && last.eligible.length === eligible.length && last.eligible.every((seat, i) => seat === eligible[i])) last.amount += amount;
        else pots.push({ amount, eligible, winners: [] });
        previous = level;
      }
      for (const pot of pots) {
        const { amount, eligible } = pot;
        let winners = eligible.slice(0, 1);
        if (showdown) for (const i of eligible.slice(1)) {
          const comparison = compare(hands[i], hands[winners[0]]);
          if (comparison > 0) winners = [i];
          else if (comparison === 0) winners.push(i);
        }
        const share = Math.floor(amount / winners.length);
        winners.forEach(i => { payouts[i] += share; });
        const oddOrder = this._seatsAfter(s.dealer).filter(i => winners.includes(i));
        for (let chip = 0; chip < amount % winners.length; chip++) payouts[oddOrder[chip]]++;
        pot.winners = winners;
      }
      const winners = payouts.map((_, i) => i).filter(i => payouts[i] > 0);
      s.players.forEach((p, i) => { p.stack += payouts[i]; p.bet = 0; });
      const winner = winners.length === 1 ? winners[0] : null;
      const title = winner === 0 ? '你赢了' : winner !== null ? `${s.players[winner].name}获胜` : pots.length > 1 ? '主池与边池已分配' : '平分底池';
      const detail = winners.map(i => `${s.players[i].name}赢得 ${payouts[i]} 筹码${showdown ? `（${handNames[i]}）` : ''}`).join('；') + '。';
      s.result = { winner, winners, payouts, pots, title, detail, showdown, handNames };
      s.phase = 'complete';
      s.actor = null;
      s.currentBet = 0;
      s.pot = 0;
      s.log.push(detail);
    }

    handName(index) {
      const player = this.state.players[index];
      if (!player || player.out || player.cards.length < 2) return '等待发牌';
      const cards = [...player.cards, ...this.state.board];
      if (cards.length >= 5) return evaluate(cards).name;
      return cards[0].rank === cards[1].rank ? '一对' : '高牌';
    }

    botAction() {
      const s = this.state;
      const playerIndex = s.actor;
      if (playerIndex === null || playerIndex === 0) return s;
      const copyCard = ({ rank, suit }) => ({ rank, suit });
      // White-list snapshots only: no other hole cards, no deck, no engine or
      // state object references are given to a strategy implementation.
      const context = {
        playerIndex,
        players: s.players.map(({ name, style, stack, bet, folded, out, lastAction }) => ({ name, style, stack, bet, folded, out, lastAction })),
        holeCards: s.players[playerIndex].cards.map(copyCard),
        board: s.board.map(copyCard),
        pot: s.pot, currentBet: s.currentBet, minRaise: s.minRaise,
        legal: this.legalActions(playerIndex), dealer: s.dealer, phase: s.phase,
      };
      let decision = { action: 'call' };
      if (this.botPolicy) {
        try {
          // An unbound call also keeps `this` from exposing the engine to a bot.
          const policy = this.botPolicy;
          decision = policy(context, () => this._random());
        } catch (_) { decision = { action: 'call' }; }
      }
      // Strategy errors cannot leave a legal game stuck or introduce an illegal
      // bet; unsupported output degrades to a check/call.
      const legal = this.legalActions(playerIndex);
      if (!decision || !['call', 'fold', 'raise'].includes(decision.action)) decision = { action: 'call' };
      if (decision.action === 'raise' && (!legal.canRaise || !Number.isInteger(decision.raiseTo) || decision.raiseTo < legal.minRaiseTo || decision.raiseTo > legal.maxRaiseTo)) decision = { action: 'call' };
      return this.act(playerIndex, decision.action, decision.raiseTo);
    }
  }

  PokerEngine.evaluate = evaluate;
  PokerEngine.compare = compare;
  root.PokerEngine = PokerEngine;
  if (typeof module === 'object' && module.exports) module.exports = PokerEngine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
