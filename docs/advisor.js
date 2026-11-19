(function (root) {
  'use strict';

  // Advice is computed locally from the human player's own cards and public
  // state. It never executes an action and never consumes the game's RNG.
  const SUITS = ['s', 'h', 'd', 'c'];
  const SAMPLES = 2048;
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const nonnegative = value => Math.max(0, finite(value));
  const validCard = card => card && Number.isInteger(card.rank) && card.rank >= 2 && card.rank <= 14 && SUITS.includes(card.suit);
  const copyCard = card => ({ rank: card.rank, suit: card.suit });

  function publicContext(raw) {
    if (!raw || raw.playerIndex !== 0 || !Array.isArray(raw.players)) return null;
    const phase = raw.phase;
    if (!['preflop', 'flop', 'turn', 'river'].includes(phase)) return null;
    const source = raw.legal || {};
    const legal = {
      canFold: !!source.canFold, canCheck: !!source.canCheck, canCall: !!source.canCall, canRaise: !!source.canRaise,
      callAmount: nonnegative(source.callAmount), minRaiseTo: finite(source.minRaiseTo), maxRaiseTo: finite(source.maxRaiseTo)
    };
    if (!legal.canCheck && !legal.canCall && !legal.canRaise) return null;
    // Explicit field copies only: no spread, Object.assign, or serialization of
    // raw inputs. Opponents' cards, hidden deck, RNG, and extra getters stay unread.
    const players = raw.players.map((player, index) => ({
      stack: nonnegative(player.stack), bet: nonnegative(player.bet),
      folded: !!player.folded, out: !!player.out,
      lastAction: typeof player.lastAction === 'string' ? player.lastAction : '',
      // Hand-total chip contributions are public accounting, not hole cards.
      contributed: Number.isFinite(player.contributed) && player.contributed >= 0 ? player.contributed : null
    }));
    const hero = players[0];
    if (!hero || hero.folded || hero.out || hero.stack <= 0) return null;
    const hole = raw.holeCards;
    const board = raw.board;
    const expectedBoardLength = { preflop: 0, flop: 3, turn: 4, river: 5 }[phase];
    if (!Array.isArray(hole) || hole.length !== 2 || !hole.every(validCard) || !Array.isArray(board) || board.length !== expectedBoardLength || !board.every(validCard)) return null;
    const holeCards = hole.map(copyCard).sort((a, b) => a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
    const boardCards = board.map(copyCard);
    if (new Set(holeCards.concat(boardCards).map(card => `${card.rank}${card.suit}`)).size !== 2 + boardCards.length) return null;
    return {
      playerIndex: 0, players, holeCards, board: boardCards,
      pot: nonnegative(raw.pot), currentBet: nonnegative(raw.currentBet), minRaise: Math.max(1, finite(raw.minRaise, 1)),
      legal, dealer: finite(raw.dealer), phase
    };
  }

  function deterministicRandom(context) {
    // Only the newly constructed whitelist snapshot is serialized. Fixed field
    // order makes repeated renders and input property order irrelevant.
    const text = JSON.stringify(context);
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0;
    return () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  const code = card => SUITS.indexOf(card.suit) * 13 + card.rank - 2;
  const weights = [759375, 50625, 3375, 225, 15, 1];
  function packed(category, ranks) {
    let score = category * weights[0];
    for (let i = 0; i < ranks.length && i < 5; i++) score += ranks[i] * weights[i + 1];
    return score;
  }
  function straight(mask) {
    for (let high = 14; high >= 6; high--) if ((mask & (31 << (high - 4))) === (31 << (high - 4))) return high;
    return (mask & 16444) === 16444 ? 5 : 0; // A, 5, 4, 3, 2.
  }
  function highest(mask, count) {
    const ranks = [];
    for (let rank = 14; rank >= 2 && ranks.length < count; rank--) if (mask & (1 << rank)) ranks.push(rank);
    return ranks;
  }
  // Exact 5–7 card evaluator. Rank multiplicities and suit bitmasks avoid the
  // 21 five-card combinations; independently checked against PokerEngine.
  function evaluateCodes(cards) {
    const counts = new Uint8Array(15), suitCounts = new Uint8Array(4), suitMasks = new Uint16Array(4);
    let mask = 0;
    for (const card of cards) {
      const rank = card % 13 + 2, suit = Math.floor(card / 13);
      counts[rank]++; suitCounts[suit]++; suitMasks[suit] |= 1 << rank; mask |= 1 << rank;
    }
    let flushMask = 0;
    for (let suit = 0; suit < 4; suit++) if (suitCounts[suit] >= 5) flushMask = suitMasks[suit];
    const straightFlush = flushMask ? straight(flushMask) : 0;
    if (straightFlush) return packed(8, [straightFlush]);
    let quad = 0, trip = 0, pair = 0;
    for (let rank = 14; rank >= 2; rank--) {
      if (counts[rank] === 4) quad = rank;
      if (!trip && counts[rank] >= 3) trip = rank;
    }
    if (quad) return packed(7, [quad, ...highest(mask & ~(1 << quad), 1)]);
    if (trip) for (let rank = 14; rank >= 2; rank--) if (rank !== trip && counts[rank] >= 2) { pair = rank; break; }
    if (trip && pair) return packed(6, [trip, pair]);
    if (flushMask) return packed(5, highest(flushMask, 5));
    const run = straight(mask);
    if (run) return packed(4, [run]);
    if (trip) return packed(3, [trip, ...highest(mask & ~(1 << trip), 2)]);
    const pairs = [];
    for (let rank = 14; rank >= 2; rank--) if (counts[rank] >= 2) pairs.push(rank);
    if (pairs.length >= 2) return packed(2, [pairs[0], pairs[1], ...highest(mask & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1)]);
    if (pairs.length) return packed(1, [pairs[0], ...highest(mask & ~(1 << pairs[0]), 3)]);
    return packed(0, highest(mask, 5));
  }

  function contestablePots(context, rivals) {
    const cost = context.legal.callAmount, players = context.players;
    const provided = players.every(p => p.contributed !== null && p.contributed >= p.bet);
    const contributionTotal = provided ? players.reduce((sum, p) => sum + p.contributed, 0) : -1;
    const exact = provided && Math.abs(contributionTotal - context.pot) < .001;
    if (!exact) return { exact: false, effectivePot: context.pot, contestablePot: context.pot + cost, excludedPot: 0,
      layers: [{ amount: context.pot + cost, eligible: rivals.map(p => p.index) }] };
    const heroCap = players[0].contributed + cost;
    const paid = players.map((p, index) => Math.min(heroCap, p.contributed + (index === 0 ? cost : 0)));
    const levels = [...new Set(paid.filter(amount => amount > 0))].sort((a, b) => a - b);
    const layers = []; let previous = 0;
    for (const level of levels) {
      const amount = (level - previous) * paid.filter(total => total >= level).length;
      // All-in opponents contest only their funded layers. Live opponents are
      // conservatively assumed to continue up to their available coverage;
      // their as-yet-unpaid calls are NOT added to the present pot.
      const eligible = rivals.filter(p => p.contributed + p.stack >= level).map(p => p.index);
      if (amount > 0) layers.push({ amount, eligible });
      previous = level;
    }
    const contestablePot = layers.reduce((sum, pot) => sum + pot.amount, 0);
    return { exact: true, effectivePot: Math.max(0, contestablePot - cost), contestablePot,
      excludedPot: Math.max(0, context.pot + cost - contestablePot), layers };
  }

  function simulate(context, rivals, pots) {
    const own = context.holeCards.map(code), publicBoard = context.board.map(code);
    const known = new Set(own.concat(publicBoard));
    const unknown = Array.from({ length: 52 }, (_, i) => i).filter(card => !known.has(card));
    const rng = deterministicRandom(context);
    let sum = 0, squared = 0;
    for (let sample = 0; sample < SAMPLES; sample++) {
      const pool = unknown.slice();
      const draw = () => { const i = Math.floor(rng() * pool.length), card = pool[i]; pool[i] = pool[pool.length - 1]; pool.pop(); return card; };
      const board = publicBoard.slice(); while (board.length < 5) board.push(draw());
      const hero = evaluateCodes(own.concat(board));
      const scores = new Array(context.players.length);
      for (const rival of rivals) scores[rival.index] = evaluateCodes([draw(), draw(), ...board]);
      let payout = 0;
      for (const pot of pots.layers) {
        let tied = 1, lost = false;
        for (const index of pot.eligible) {
          if (scores[index] > hero) { lost = true; break; }
          if (scores[index] === hero) tied++;
        }
        if (!lost) payout += pot.amount / tied;
      }
      const share = pots.contestablePot > 0 ? payout / pots.contestablePot : 1;
      sum += share; squared += share * share;
    }
    const equity = sum / SAMPLES;
    const standardError = Math.sqrt(Math.max(0, squared / SAMPLES - equity * equity) / SAMPLES);
    // Hoeffding's bounded-mean interval is conservative and remains meaningful
    // even when all sampled outcomes are wins or identical fractional ties.
    const marginOfError = Math.sqrt(Math.log(40) / (2 * SAMPLES));
    return { equity, standardError, marginOfError, equityLow: Math.max(0, equity - marginOfError), equityHigh: Math.min(1, equity + marginOfError) };
  }

  function valueRaise(context, pots, equity) {
    const legal = context.legal;
    if (!legal.canRaise) return null;
    const low = Math.max(Math.ceil(legal.minRaiseTo), Math.floor(context.currentBet) + 1), high = Math.floor(legal.maxRaiseTo);
    if (low > high) return null;
    let target = Math.round(context.currentBet + Math.max(context.minRaise, pots.contestablePot * .6));
    target = Math.min(high, Math.max(low, target));
    const remaining = context.players[0].stack - target + context.players[0].bet;
    if (equity > .90 && remaining < pots.contestablePot * .15) target = high;
    if (target - context.currentBet < context.minRaise && target !== high) return null;
    return { action: 'raise', raiseTo: target };
  }

  function premiumOpening(context, rivals) {
    if (context.phase !== 'preflop' || !context.legal.canRaise || context.currentBet <= 0 || context.currentBet > context.minRaise) return null;
    if (rivals.some(p => /raise|加注|下注|全下至/i.test(p.lastAction))) return null;
    const limpers = rivals.filter(p => /call|跟注/i.test(p.lastAction) && p.bet >= context.currentBet).length;
    if (limpers > 2) return null;
    const ranks = context.holeCards.map(card => card.rank).sort((a, b) => b - a);
    const premium = (ranks[0] === ranks[1] && ranks[0] >= 12) || (ranks[0] === 14 && ranks[1] === 13);
    if (!premium) return null;
    const legal = context.legal;
    const low = Math.max(Math.ceil(legal.minRaiseTo), Math.floor(context.currentBet) + 1), high = Math.floor(legal.maxRaiseTo);
    if (low > high) return null;
    let target = Math.min(high, Math.max(low, Math.round(context.currentBet * (3 + limpers))));
    // With a short premium stack, avoid committing nearly everything while
    // keeping a meaningless sliver behind; the engine's all-in bound controls it.
    if (high - target <= context.currentBet && high <= context.currentBet * 6) target = high;
    if (target - context.currentBet < context.minRaise && target !== high) return null;
    return { action: 'raise', raiseTo: target };
  }

  function advise(rawContext) {
    const context = publicContext(rawContext);
    if (!context) return null;
    const rivals = context.players.map((p, index) => ({ ...p, index })).filter(p => p.index !== 0 && !p.folded && !p.out);
    if (!rivals.length) return null;
    const pots = contestablePots(context, rivals);
    const estimate = simulate(context, rivals, pots);
    const cost = context.legal.callAmount;
    const potOdds = cost / Math.max(1, pots.contestablePot);
    const allInDecision = cost >= context.players[0].stack || rivals.every(p => p.stack === 0);
    const futureBetting = !allInDecision && context.board.length < 5;
    const uncertain = estimate.equityLow <= potOdds && estimate.equityHigh >= potOdds;
    let decision = { action: 'call' }, reason, decisionBasis = '静态跟注比较';
    const value = estimate.equityLow > Math.max(.60, potOdds + .06);
    const raised = value ? valueRaise(context, pots, estimate.equity) : null;
    const opening = premiumOpening(context, rivals);
    if (opening) {
      decision = opening; decisionBasis = '强起手开池策略';
      reason = '强起手先加注取价值；静态跟注收益不代表加注收益';
    }
    else if (raised) { decision = raised; decisionBasis = '价值加注策略'; reason = '静态权益较高，可价值加注；仍需观察对手响应'; }
    else if (cost === 0 || context.legal.canCheck) reason = '免费过牌保留权益，无需支付跟注成本';
    else if (estimate.equityHigh < potOdds) { decision = { action: 'fold' }; reason = '估算区间低于跟注门槛，建议弃牌'; }
    else if (uncertain) {
      const smallProbe = futureBetting && cost <= context.players[0].stack * .03;
      decision = { action: smallProbe || (allInDecision && estimate.equity >= potOdds) ? 'call' : 'fold' };
      reason = decision.action === 'call' ? '估算与成本接近，谨慎跟注；误差可能改变结论' : '误差区间覆盖成本，保守弃牌，尚无明确优势';
    } else reason = futureBetting ? '静态权益高于成本；后续下注仍需重新估算' : '可争底池权益高于当前跟注成本';
    if (decision.action === 'fold' && !context.legal.canFold) { decision = { action: 'call' }; reason = '当前不能弃牌，仅保留合法跟注选择'; }
    if (decision.action === 'call' && !context.legal.canCheck && !context.legal.canCall) return null;
    let label;
    if (decision.action === 'fold') label = '弃牌';
    else if (decision.action === 'raise') label = `${context.currentBet > 0 ? '加注至' : '下注'} ${decision.raiseTo}`;
    else if (context.legal.canCheck || cost === 0) label = '过牌';
    else label = `${cost >= context.players[0].stack ? '全下跟注' : '跟注'} ${cost}`;
    return {
      ...decision, label, reason, ...estimate, potOdds, method: '随机模拟', samples: SAMPLES,
      effectivePot: pots.effectivePot, contestablePot: pots.contestablePot, excludedPot: pots.excludedPot,
      potExact: pots.exact, potBasis: pots.exact ? '累计投入分层' : '总底池近似',
      callEV: estimate.equity * pots.contestablePot - cost,
      callEVLow: estimate.equityLow * pots.contestablePot - cost,
      callEVHigh: estimate.equityHigh * pots.contestablePot - cost,
      confidenceLevel: .95, confidenceScope: '仅抽样误差，不含对手范围与后续行为偏差',
      allInDecision, futureBetting, uncertain, decisionBasis,
      raiseAssumption: opening ? '仅首入或至多两人跟入，选QQ以上对子或AK；加注价值依赖跟入范围和弃牌率，未由静态跟注EV证明' : raised ? '按当前权益做价值加注启发，不把跟注EV当作加注EV' : '',
      rangeAssumption: '各存活对手从未知牌等概率取两张，不使用真实底牌',
      modelScope: '按现有可争底池估算，假设存活对手继续参与；不计未来投入或弃牌收益',
      caution: pots.exact ? '训练参考，非最优策略或收益保证' : '缺少完整累计投入，边池资格仅能近似'
    };
  }

  function evaluate(cards) {
    if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7 || !cards.every(validCard)) throw new Error('评估需要 5 至 7 张有效牌');
    return evaluateCodes(cards.map(code));
  }
  const api = Object.freeze({ advise, evaluate });
  root.PokerAdvisor = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
