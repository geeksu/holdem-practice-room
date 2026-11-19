(function (root) {
  'use strict';

  // Local, limited-sample opponents. This is a heuristic game AI, not a solver.
  // The caller supplies only public state plus this player's own two cards.
  const dependency = typeof module === 'object' && module.exports ? require('./engine.js') : null;
  const SUITS = ['s', 'h', 'd', 'c'];
  const profiles = Object.freeze({
    tag: Object.freeze({ name: '磐石', label: '紧凶', open: .60, defense: .065, value: .69, aggression: .68, bluff: .025, semiBluff: .14, size: .57, openSize: 2.8, positionBonus: .045, positionAggression: 0, slowPlay: 0, rangeTightness: .65, defendWidth: .065 }),
    lag: Object.freeze({ name: '烈焰', label: '松凶', open: .47, defense: .008, value: .57, aggression: .91, bluff: .12, semiBluff: .34, size: .79, openSize: 3.2, positionBonus: .05, positionAggression: 0, slowPlay: 0, rangeTightness: .22, defendWidth: .065 }),
    balanced: Object.freeze({ name: '千面', label: '均衡', open: .54, defense: .035, value: .63, aggression: .79, bluff: .065, semiBluff: .24, size: .66, openSize: 2.6, positionBonus: .045, positionAggression: 0, slowPlay: 0, rangeTightness: .43, defendWidth: .065 }),
    nit: Object.freeze({ name: '狙击', label: '极紧强攻', open: .70, defense: .095, value: .76, aggression: .78, bluff: .008, semiBluff: .07, size: .66, openSize: 3, positionBonus: .025, positionAggression: 0, slowPlay: 0, rangeTightness: .88, defendWidth: .035 }),
    trap: Object.freeze({ name: '暗影', label: '隐蔽陷阱', open: .61, defense: .045, value: .65, aggression: .48, bluff: .035, semiBluff: .12, size: .70, openSize: 2.4, positionBonus: .04, positionAggression: 0, slowPlay: .52, rangeTightness: .60, defendWidth: .08 }),
    pressure: Object.freeze({ name: '疾风', label: '位置施压', open: .55, defense: .018, value: .60, aggression: .87, bluff: .095, semiBluff: .29, size: .74, openSize: 2.7, positionBonus: .14, positionAggression: .22, slowPlay: 0, rangeTightness: .35, defendWidth: .06 }),
    defend: Object.freeze({ name: '铁壁', label: '稳健防守', open: .58, defense: .025, value: .73, aggression: .48, bluff: .012, semiBluff: .08, size: .54, openSize: 2.5, positionBonus: .04, positionAggression: 0, slowPlay: 0, rangeTightness: .58, defendWidth: .11 })
  });
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const number = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const random = rng => clamp(number(Number(rng())), 0, .999999999999);
  const cardKey = c => `${c.rank}${c.suit}`;
  const isCard = c => c && Number.isInteger(c.rank) && c.rank >= 2 && c.rank <= 14 && SUITS.includes(c.suit);
  const copyCard = c => ({ rank: c.rank, suit: c.suit });

  function engine() {
    const e = dependency || root.PokerEngine;
    if (!e || typeof e.evaluate !== 'function' || typeof e.compare !== 'function') throw new Error('请先加载 PokerEngine，再加载电脑策略。');
    return e;
  }

  function snapshot(context) {
    // Do not spread context/player objects: even accidental private getters must
    // stay untouched. In particular, never read cards, holeCards or deck on peers.
    const players = context.players.map(p => ({
      style: typeof p.style === 'string' ? p.style : 'balanced',
      stack: Math.max(0, number(p.stack)), bet: Math.max(0, number(p.bet)),
      folded: !!p.folded, out: !!p.out,
      lastAction: typeof p.lastAction === 'string' ? p.lastAction : ''
    }));
    const index = number(context.playerIndex, -1);
    if (!players[index]) throw new Error('电脑座位不存在。');
    const own = context.holeCards;
    const board = context.board;
    if (!Array.isArray(own) || own.length !== 2 || !own.every(isCard) || !Array.isArray(board) || ![0, 3, 4, 5].includes(board.length) || !board.every(isCard)) throw new Error('电脑需要两张有效底牌及有效公共牌。');
    if (new Set(own.concat(board).map(cardKey)).size !== own.length + board.length) throw new Error('已知牌不能重复。');
    const l = context.legal || {};
    return {
      players, index, hole: own.map(copyCard), board: board.map(copyCard),
      pot: Math.max(0, number(context.pot)), currentBet: Math.max(0, number(context.currentBet)),
      minRaise: Math.max(1, number(context.minRaise, 1)), dealer: number(context.dealer),
      phase: context.phase,
      legal: { canFold: !!l.canFold, canCheck: !!l.canCheck, canCall: !!l.canCall,
        canRaise: !!l.canRaise, callAmount: Math.max(0, number(l.callAmount)),
        minRaiseTo: number(l.minRaiseTo), maxRaiseTo: number(l.maxRaiseTo) }
    };
  }

  function startingStrength(cards) {
    const high = Math.max(cards[0].rank, cards[1].rank);
    const low = Math.min(cards[0].rank, cards[1].rank);
    if (high === low) return .50 + (high - 2) / 12 * .47;
    const gap = high - low - 1;
    let result = .10 + .38 * (high - 2) / 12 + .25 * (low - 2) / 12;
    if (cards[0].suit === cards[1].suit) result += .065;
    if (gap === 0 && high < 14) result += .05;
    else if (gap === 1) result += .02;
    else if (gap >= 4) result -= .045;
    // A2-A5 also have wheel potential, but are not treated as broadway aces.
    if (high === 14 && low <= 5) result += .012;
    return clamp(result, .08, .92);
  }

  function seatInfo(s) {
    const rivals = s.players.map((p, i) => ({ ...p, index: i })).filter(p => p.index !== s.index && !p.folded && !p.out);
    const order = [];
    for (let d = 1; d <= s.players.length; d++) {
      const i = (s.dealer + d) % s.players.length;
      if (!s.players[i].folded && !s.players[i].out) order.push(i);
    }
    const position = order.length <= 1 ? 1 : Math.max(0, order.indexOf(s.index)) / (order.length - 1);
    return { rivals, count: rivals.length, position, inPosition: order[order.length - 1] === s.index };
  }

  function aggressive(p) { return /raise|bet|all.?in|加注|下注|全下/i.test(p.lastAction); }

  function drawFeatures(s) {
    const cards = s.hole.concat(s.board);
    const suits = Object.fromEntries(SUITS.map(suit => [suit, cards.filter(c => c.suit === suit).length]));
    const boardSuits = Object.fromEntries(SUITS.map(suit => [suit, s.board.filter(c => c.suit === suit).length]));
    let draw = 0;
    if (s.board.length < 5) {
      for (const suit of SUITS) if (s.hole.some(c => c.suit === suit)) {
        if (suits[suit] === 4) draw = Math.max(draw, .18);
        if (suits[suit] === 3 && s.board.length === 3) draw = Math.max(draw, .035);
      }
      const ranks = new Set(cards.map(c => c.rank));
      if (ranks.has(14)) ranks.add(1);
      for (let start = 1; start <= 10; start++) {
        const run = Array.from({ length: 5 }, (_, i) => start + i);
        if (run.filter(r => ranks.has(r)).length === 4 && s.hole.some(c => run.includes(c.rank) || (c.rank === 14 && start === 1))) draw = Math.max(draw, .14);
      }
    }
    const blocker = s.hole.some(c => c.rank === 14 && boardSuits[c.suit] >= 3);
    const wet = Math.max(...Object.values(boardSuits)) >= 2;
    return { draw, blocker, wet };
  }

  function rangeWeight(cards, rival, s, e) {
    const tightness = (profiles[rival.style] || profiles.balanced).rangeTightness;
    let weight = (1 - tightness) + tightness * startingStrength(cards);
    if (aggressive(rival) || rival.stack === 0) {
      // Public aggression skews the sampled range; bluffs retain nonzero mass.
      const hand = e.evaluate(cards.concat(s.board));
      const category = hand.category;
      let boardCategory = 0;
      if (s.board.length === 5) boardCategory = e.evaluate(s.board).category;
      const improvement = Math.max(0, category - boardCategory);
      weight *= .28 + Math.min(.72, improvement * .19 + startingStrength(cards) * .28);
    }
    return clamp(weight, .08, 1);
  }

  function estimateSnapshot(s, rng, options) {
    const seats = seatInfo(s);
    const strength = startingStrength(s.hole);
    if (!seats.count) return { equity: 1, winRate: 1, tieRate: 0, samples: 0, standardError: 0, opponents: 0, startingStrength: strength, method: 'uncontested' };
    if (!s.board.length) {
      // A conservative starting-hand prior; preflop action also uses position
      // and opening/re-raising thresholds directly, rather than false precision.
      const equity = Math.pow(.30 + .58 * strength, 1 + .9 * (seats.count - 1));
      return { equity, winRate: null, tieRate: null, samples: 0, standardError: null, opponents: seats.count, startingStrength: strength, method: 'preflop-prior' };
    }
    const e = engine();
    const samples = Math.round(clamp(number(options && options.samples, seats.count >= 3 ? 48 : 64), 40, 80));
    const known = new Set(s.hole.concat(s.board).map(cardKey));
    const unknown = SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit }))).filter(c => !known.has(cardKey(c)));
    let payout = 0, payoutSquared = 0, wins = 0, ties = 0;
    for (let sample = 0; sample < samples; sample++) {
      const pool = unknown.slice();
      const sampledRivals = [];
      for (const rival of seats.rivals) {
        let a = 0, b = 1;
        for (let attempt = 0; attempt < 4; attempt++) {
          a = Math.floor(random(rng) * pool.length);
          b = Math.floor(random(rng) * (pool.length - 1));
          if (b >= a) b++;
          if (random(rng) <= rangeWeight([pool[a], pool[b]], rival, s, e)) break;
        }
        sampledRivals.push([pool[a], pool[b]]);
        // Remove the larger index first so all virtual cards remain distinct.
        pool.splice(Math.max(a, b), 1);
        pool.splice(Math.min(a, b), 1);
      }
      const board = s.board.slice();
      while (board.length < 5) board.push(pool.splice(Math.floor(random(rng) * pool.length), 1)[0]);
      const hero = e.evaluate(s.hole.concat(board));
      let beat = false, tied = 0;
      for (const cards of sampledRivals) {
        const comparison = e.compare(hero, e.evaluate(cards.concat(board)));
        if (comparison < 0) { beat = true; break; }
        if (comparison === 0) tied++;
      }
      if (!beat) {
        const share = 1 / (tied + 1);
        payout += share;
        payoutSquared += share * share;
        if (tied) ties++;
        else wins++;
      }
    }
    const equity = payout / samples;
    return { equity, winRate: wins / samples, tieRate: ties / samples, samples,
      standardError: Math.sqrt(Math.max(0, payoutSquared / samples - equity * equity) / samples),
      opponents: seats.count, startingStrength: strength, method: 'public-card-monte-carlo' };
  }

  function fallback(s) {
    if (s.legal.canCheck || s.legal.canCall) return { action: 'call' };
    if (s.legal.canFold) return { action: 'fold' };
    return { action: 'call' }; // No action is possible off-turn; caller owns turn scheduling.
  }

  function raise(s, seats, profile, equity, strong, rng) {
    if (!s.legal.canRaise) return fallback(s);
    const minimum = Math.max(Math.ceil(s.legal.minRaiseTo), Math.floor(s.currentBet) + 1);
    const maximum = Math.floor(s.legal.maxRaiseTo);
    if (minimum > maximum) return fallback(s);
    const potAfterCall = s.pot + s.legal.callAmount;
    const jitter = .94 + random(rng) * .12;
    let target;
    if (!s.board.length && s.currentBet <= s.minRaise) {
      const limpers = seats.rivals.filter(p => p.bet === s.currentBet && /call|跟注/i.test(p.lastAction)).length;
      target = Math.max(s.currentBet, s.minRaise) * (profile.openSize + .6 * limpers) * jitter;
    } else {
      const fraction = profile.size + (strong ? .12 : 0) + Math.max(0, seats.count - 1) * .055;
      target = s.currentBet + Math.max(s.minRaise, potAfterCall * fraction * jitter);
    }
    // Avoid wagering more than any live opponent can match, unless the legal
    // minimum itself requires it (the engine returns any unmatched excess).
    const cover = Math.max(s.currentBet, ...seats.rivals.map(p => p.bet + p.stack));
    target = Math.min(target, Math.max(minimum, cover));
    const hero = s.players[s.index];
    const remaining = hero.stack - (target - hero.bet);
    if (equity > .83 && remaining >= 0 && remaining < potAfterCall * .20 && maximum <= cover) target = maximum;
    return { action: 'raise', raiseTo: clamp(Math.round(target), minimum, maximum) };
  }

  function explain(context, rng = Math.random) {
    const s = snapshot(context);
    const seats = seatInfo(s);
    const profile = profiles[s.players[s.index].style] || profiles.balanced;
    const estimate = estimateSnapshot(s, rng);
    const cost = s.legal.callAmount;
    const price = cost / Math.max(1, s.pot + cost);
    const stackShare = cost / Math.max(1, s.players[s.index].stack);
    const position = seats.position;
    const aggression = clamp(profile.aggression + (position - .5) * profile.positionAggression, 0, 1);
    const details = { style: s.players[s.index].style, profile: profile.label, estimate, potOdds: price, position, reason: '' };
    const finish = (decision, reason) => ({ ...details, decision, reason });
    if (!s.legal.canCheck && !s.legal.canCall && !s.legal.canRaise) return finish(fallback(s), '当前无下注选择');
    if (!seats.count) return finish(fallback(s), '已无竞争玩家');
    const roll = random(rng);
    const opening = !s.board.length && s.currentBet <= s.minRaise;
    if (!s.board.length) {
      const strength = estimate.startingStrength;
      // Full tables require a tighter baseline; position-led styles widen most
      // on the button, while all styles loosen as opponents leave the hand.
      const threshold = profile.open - profile.positionBonus * position - .025 * Math.max(0, 3 - seats.count) + .012 * Math.max(0, seats.count - 3);
      const premium = strength >= .85;
      const openValue = strength >= threshold;
      const reraiseValue = strength >= threshold + .14 && (estimate.equity > price + .055 || premium);
      const dangerous = stackShare > .24 || price > .44;
      if (premium && opening && profile.slowPlay > 0 && !dangerous && roll < profile.slowPlay * .65) return finish({ action: 'call' }, '优质起手隐蔽跟注');
      if (s.legal.canRaise && ((opening && openValue) || (!opening && reraiseValue)) && (premium || roll < aggression)) {
        return finish(raise(s, seats, profile, estimate.equity, premium, rng), premium ? '强起手牌价值加注' : opening ? '结合位置主动开池' : '强范围再加注');
      }
      if (cost === 0 || s.legal.canCheck) return finish({ action: 'call' }, '免费查看下一张牌');
      const defend = strength >= threshold - profile.defendWidth && (!dangerous || estimate.equity >= price + profile.defense);
      const cheapSpeculation = strength >= threshold - .12 && price < .18 && stackShare < .045;
      const enoughEquity = !opening && estimate.equity >= price + profile.defense + .035 && strength >= threshold - .10;
      if (premium || defend || cheapSpeculation || enoughEquity) return finish({ action: 'call' }, cheapSpeculation ? '低成本位置防守' : '起手范围与跟注价格可接受');
      return finish(s.legal.canFold ? { action: 'fold' } : fallback(s), '起手牌不足以支付当前价格');
    }

    const features = drawFeatures(s);
    const equity = estimate.equity;
    const realizedEquity = equity * (s.board.length === 5 ? 1 : .93 + .07 * position);
    const required = price + profile.defense + Math.max(0, seats.count - 1) * .012 + (estimate.standardError || 0) * .15 - profile.positionBonus * .4 * position;
    const valueThreshold = profile.value + Math.max(0, seats.count - 1) * .03 + price * .07;
    const strong = equity >= .88;
    const value = equity > valueThreshold && realizedEquity > required + .09;
    if (strong && s.board.length < 5 && !features.wet && stackShare < .16 && roll < profile.slowPlay) return finish({ action: 'call' }, '安全牌面强牌慢打');
    if (s.legal.canRaise && value && (strong || roll < aggression)) return finish(raise(s, seats, profile, equity, strong, rng), '多人胜率支持价值下注');

    const headsUp = seats.count === 1;
    const affordable = cost === 0 || (price < .23 && stackShare < .14);
    const pressureSpot = seats.inPosition || headsUp;
    const canSemiBluff = features.draw >= .13 && s.board.length < 5 && equity > .20;
    const bluffFrequency = canSemiBluff ? profile.semiBluff : profile.bluff;
    const bluffCandidate = (canSemiBluff || features.blocker || (cost === 0 && seats.inPosition)) && equity < valueThreshold && seats.count <= 2;
    // Multiway bluffs are rare; a raise cannot turn a clearly losing expensive
    // river call into an arbitrary gamble. The action budget shrinks as seats grow.
    if (s.legal.canRaise && affordable && pressureSpot && bluffCandidate && roll < bluffFrequency / seats.count) {
      return finish(raise(s, seats, profile, equity, false, rng), canSemiBluff ? '听牌半诈唬' : '有位置或阻断牌的小频率诈唬');
    }
    if (cost === 0 || s.legal.canCheck) return finish({ action: 'call' }, '保留免费摊牌或听牌机会');
    if (realizedEquity >= required || (equity > .82 && price < .80)) return finish({ action: 'call' }, '估算权益覆盖底池赔率');
    return finish(s.legal.canFold ? { action: 'fold' } : fallback(s), '跟注价格超过估算权益');
  }

  const api = Object.freeze({
    chooseAction: (context, rng = Math.random) => explain(context, rng).decision,
    explain,
    estimate: (context, rng = Math.random, options = {}) => estimateSnapshot(snapshot(context), rng, options),
    startingStrength,
    profiles
  });
  root.PokerBot = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
