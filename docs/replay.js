(function (root) {
  'use strict';

  const SUITS = ['s', 'h', 'd', 'c'];
  const SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const PHASES = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
  const RANGE_NAMES = { uniform: '组合均匀', value: '价值偏多', bluff: '诈唬偏多' };
  const SIZE_NAMES = { original: '原下注', half: '半池下注', pot: '满池下注' };
  const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const chips = value => finite(value) && value >= 0 && Number.isInteger(value);
  const percent = value => `${(value * 100).toFixed(1)}%`;
  const amount = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  const signed = value => `${value > 0 ? '+' : ''}${amount(value)}`;
  const cardKey = card => `${card.rank}${card.suit}`;
  const validCard = card => card && Number.isInteger(card.rank) && card.rank >= 2 && card.rank <= 14 && SUITS.includes(card.suit);
  const copyCard = card => ({ rank: card.rank, suit: card.suit });
  const cardText = cards => cards.map(c => `${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[c.rank] || c.rank}${SYMBOLS[c.suit]}`).join(' ');

  function copyContext(raw) {
    if (!raw || !Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 8) return null;
    const playerIndex = raw.playerIndex;
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= raw.players.length || !PHASES[raw.phase]) return null;
    const players = [];
    for (let i = 0; i < raw.players.length; i++) {
      const p = raw.players[i];
      if (!p || !chips(p.stack) || !chips(p.bet)) return null;
      // A whitelist, not a spread/serialization of raw input: hidden cards,
      // deck/state references and unrelated getters are never touched.
      players.push({ name: text(p.name, `玩家 ${i + 1}`), style: text(p.style), stack: p.stack, bet: p.bet,
        folded: !!p.folded, out: !!p.out, lastAction: text(p.lastAction),
        contributed: chips(p.contributed) && p.contributed >= p.bet ? p.contributed : null });
    }
    const hero = players[playerIndex], source = raw.legal;
    if (hero.folded || hero.out || hero.stack <= 0 || !source || !chips(raw.pot) || !chips(raw.currentBet) || !chips(raw.minRaise) || raw.minRaise < 1) return null;
    const hole = raw.holeCards, board = raw.board;
    if (!Array.isArray(hole) || hole.length !== 2 || !hole.every(validCard) || !Array.isArray(board) || board.length !== ({ preflop: 0, flop: 3, turn: 4, river: 5 })[raw.phase] || !board.every(validCard)) return null;
    if (new Set(hole.concat(board).map(cardKey)).size !== hole.length + board.length) return null;
    const legal = { canFold: !!source.canFold, canCheck: !!source.canCheck, canCall: !!source.canCall, canRaise: !!source.canRaise,
      callAmount: source.callAmount, minRaiseTo: source.minRaiseTo, maxRaiseTo: source.maxRaiseTo };
    if (!chips(legal.callAmount) || legal.callAmount !== Math.min(hero.stack, Math.max(0, raw.currentBet - hero.bet))) return null;
    if (legal.canCheck !== (legal.callAmount === 0) || legal.canCall !== (legal.callAmount > 0)) return null;
    if (legal.canRaise && (!chips(legal.minRaiseTo) || !chips(legal.maxRaiseTo) || legal.minRaiseTo <= raw.currentBet || legal.minRaiseTo > legal.maxRaiseTo || legal.maxRaiseTo > hero.stack + hero.bet)) return null;
    if (!legal.canRaise) { legal.minRaiseTo = chips(legal.minRaiseTo) ? legal.minRaiseTo : 0; legal.maxRaiseTo = chips(legal.maxRaiseTo) ? legal.maxRaiseTo : hero.stack + hero.bet; }
    return { playerIndex, players, holeCards: hole.map(copyCard), board: board.map(copyCard), pot: raw.pot,
      currentBet: raw.currentBet, minRaise: raw.minRaise, legal,
      dealer: Number.isInteger(raw.dealer) && raw.dealer >= 0 && raw.dealer < players.length ? raw.dealer : 0,
      bigBlind: chips(raw.bigBlind) && raw.bigBlind > 0 ? raw.bigBlind : 20, phase: raw.phase };
  }

  function normalizeMove(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('缺少可重练的历史行动。');
    const context = copyContext(raw.context);
    return { context, position: text(raw.position), phase: text(raw.phase), own: text(raw.own), board: text(raw.board),
      pot: chips(raw.pot) ? raw.pot : context ? context.pot : 0,
      cost: chips(raw.cost) ? raw.cost : context ? context.legal.callAmount : null,
      opponents: chips(raw.opponents) ? raw.opponents : null,
      publicLog: Array.isArray(raw.publicLog) ? raw.publicLog.filter(line => typeof line === 'string').slice(-120) : [],
      // These fields are kept private until an alternative action is submitted.
      actual: text(raw.actual), action: ['fold', 'call', 'raise'].includes(raw.action) ? raw.action : null,
      raiseTo: chips(raw.raiseTo) ? raw.raiseTo : null,
      reference: text(raw.reference), reason: text(raw.reason),
      equity: finite(raw.equity) ? raw.equity : null, price: finite(raw.price) ? raw.price : null,
      contestable: chips(raw.contestable) ? raw.contestable : null };
  }

  function liveRivals(context) {
    return context.players.map((p, index) => ({ ...p, index })).filter(p => p.index !== context.playerIndex && !p.folded && !p.out);
  }

  function exactAccounting(context) {
    return context.players.every(p => p.contributed !== null) && context.players.reduce((sum, p) => sum + p.contributed, 0) === context.pot;
  }

  function sizeCapability(context) {
    if (!context || context.phase === 'preflop' || !context.legal.canCall || context.players[context.playerIndex].bet !== 0 || !exactAccounting(context)) return null;
    const funded = context.players.map((p, index) => ({ ...p, index })).filter(p => p.bet > 0);
    if (funded.length !== 1) return null;
    const bettor = funded[0];
    if (bettor.index === context.playerIndex || bettor.folded || bettor.out || bettor.bet !== context.currentBet || context.minRaise !== Math.max(context.bigBlind, bettor.bet)) return null;
    const potBefore = context.pot - bettor.bet;
    if (potBefore <= 0) return null;
    return { index: bettor.index, oldBet: bettor.bet, available: bettor.bet + bettor.stack, potBefore };
  }

  function resizeBet(original, size) {
    if (!SIZE_NAMES[size]) throw new Error('未知下注尺度。');
    const context = copyContext(original);
    if (!context) throw new Error('缺少可靠的公开状态。');
    if (size === 'original') return { context, note: '' };
    const capability = sizeCapability(context);
    if (!capability) throw new Error('这一步无法可靠重建下注尺度变式。');
    const desired = Math.max(1, Math.round(capability.potBefore * (size === 'half' ? 0.5 : 1)));
    const bet = Math.min(capability.available, Math.max(context.bigBlind, desired));
    const bettor = context.players[capability.index], hero = context.players[context.playerIndex];
    bettor.stack += capability.oldBet - bet;
    bettor.bet = bet;
    bettor.contributed += bet - capability.oldBet;
    bettor.lastAction = `训练变式下注 ${bet}`;
    context.pot += bet - capability.oldBet;
    context.currentBet = bet;
    context.minRaise = Math.max(context.bigBlind, bet);
    const maxRaiseTo = hero.stack + hero.bet;
    const canRespond = context.players.some((p, i) => i !== context.playerIndex && !p.out && !p.folded && p.stack > 0 && p.stack + p.bet > bet);
    // With hero.bet === 0, hero either checked or has not yet acted. A full
    // opening bet reopens either case; a short all-in preserves captured rights.
    const raiseRights = bet >= context.bigBlind || original.legal.canRaise;
    context.legal = { canFold: original.legal.canFold, canCheck: false, canCall: true,
      callAmount: Math.min(hero.stack, bet), canRaise: raiseRights && canRespond && maxRaiseTo > bet,
      minRaiseTo: Math.min(maxRaiseTo, bet + context.minRaise), maxRaiseTo };
    const constrained = bet !== desired ? `，受最小下注或剩余筹码限制，实际为 ${bet}` : '';
    return { context, note: `训练变式：只把${bettor.name}本街的 ${capability.oldBet} 改为${SIZE_NAMES[size]} ${desired}${constrained}；其余公开事实保持不变。下方历史仍为原始记录。` };
  }

  function compareScores(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b);
    const left = a.score, right = b.score;
    for (let i = 0; i < Math.max(left.length, right.length); i++) if ((left[i] || 0) !== (right[i] || 0)) return Math.sign((left[i] || 0) - (right[i] || 0));
    return 0;
  }

  function evaluator() {
    if (root.PokerAdvisor && typeof root.PokerAdvisor.evaluate === 'function') return cards => root.PokerAdvisor.evaluate(cards);
    if (root.PokerEngine && typeof root.PokerEngine.evaluate === 'function') return cards => root.PokerEngine.evaluate(cards);
    return null;
  }

  function enumerateRiver(context) {
    const evaluate = evaluator();
    if (!context || context.phase !== 'river' || liveRivals(context).length !== 1 || !evaluate) return null;
    const known = new Set(context.holeCards.concat(context.board).map(cardKey));
    const unknown = SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit }))).filter(card => !known.has(cardKey(card)));
    const heroScore = evaluate(context.holeCards.concat(context.board));
    const result = { win: 0, lose: 0, tie: 0, total: 0, examples: { win: [], lose: [], tie: [] } };
    for (let a = 0; a < unknown.length - 1; a++) for (let b = a + 1; b < unknown.length; b++) {
      const hand = [unknown[a], unknown[b]];
      const comparison = compareScores(heroScore, evaluate(hand.concat(context.board)));
      const group = comparison > 0 ? 'win' : comparison < 0 ? 'lose' : 'tie';
      result[group]++; result.total++;
      if (result.examples[group].length < 2) result.examples[group].push(cardText(hand));
    }
    return result;
  }

  function weightedRange(counts, mode) {
    if (!RANGE_NAMES[mode]) throw new Error('未知对手范围。');
    const requested = mode === 'uniform' ? { win: counts.win, lose: counts.lose, tie: counts.tie }
      : mode === 'value' ? { win: 0.15, lose: 0.80, tie: 0.05 } : { win: 0.70, lose: 0.25, tie: 0.05 };
    const total = ['win', 'lose', 'tie'].reduce((sum, key) => sum + (counts[key] ? requested[key] : 0), 0);
    const weights = {};
    for (const key of ['win', 'lose', 'tie']) weights[key] = counts[key] ? requested[key] / total : 0;
    return { ...weights, equity: weights.win + weights.tie / 2 };
  }

  function riverPots(context) {
    if (!exactAccounting(context) || liveRivals(context).length !== 1) return null;
    const heroIndex = context.playerIndex, rivalIndex = liveRivals(context)[0].index, cost = context.legal.callAmount;
    const cap = context.players[heroIndex].contributed + cost;
    const paid = context.players.map((p, i) => Math.min(cap, p.contributed + (i === heroIndex ? cost : 0)));
    const levels = [...new Set(paid.filter(n => n > 0))].sort((a, b) => a - b);
    const layers = []; let previous = 0;
    for (const level of levels) {
      const value = (level - previous) * paid.filter(n => n >= level).length;
      const shared = paid[rivalIndex] >= level;
      const last = layers[layers.length - 1];
      if (last && last.shared === shared) last.amount += value;
      else layers.push({ amount: value, shared });
      previous = level;
    }
    const n = context.players.length;
    const distance = seat => (seat - context.dealer + n - 1) % n;
    const heroGetsOdd = distance(heroIndex) < distance(rivalIndex);
    let winPayout = 0, tiePayout = 0, losePayout = 0;
    for (const layer of layers) {
      winPayout += layer.amount;
      if (layer.shared) tiePayout += Math.floor(layer.amount / 2) + (heroGetsOdd ? layer.amount % 2 : 0);
      else { tiePayout += layer.amount; losePayout += layer.amount; }
    }
    return { layers, cost, contestable: winPayout, winPayout, tiePayout, losePayout,
      excluded: Math.max(0, context.pot + cost - winPayout), price: winPayout ? cost / winPayout : 0 };
  }

  function exactRiver(context, mode, counts) {
    const combinations = counts || enumerateRiver(context);
    if (!combinations) return null;
    const weights = weightedRange(combinations, mode);
    const pots = riverPots(context);
    const callEV = pots ? weights.win * pots.winPayout + weights.tie * pots.tiePayout + weights.lose * pots.losePayout - pots.cost : null;
    return { counts: combinations, weights, pots, callEV, mode, equity: weights.equity };
  }

  function position(context) {
    const n = context.players.length, hero = context.playerIndex;
    const order = Array.from({ length: n }, (_, i) => (context.dealer + i + 1) % n).filter(i => !context.players[i].out);
    if (hero === context.dealer) return order.length === 2 ? '庄家 / 小盲位' : '庄家位 BTN';
    const sb = order.length === 2 ? context.dealer : order[0];
    const bb = order.length === 2 ? order[0] : order[1];
    if (hero === sb) return '小盲位 SB';
    if (hero === bb) return '大盲位 BB';
    return `距庄家顺时针 ${order.indexOf(hero) + 1} 个在座席位`;
  }

  function actionLabel(action, raiseTo, legal, currentBet) {
    if (action === 'fold') return '弃牌';
    if (action === 'raise') return `${currentBet > 0 ? '加注至' : '下注'} ${amount(raiseTo)}`;
    return legal.canCheck ? '过牌' : `跟注 ${amount(legal.callAmount)}`;
  }

  function analyze(context, range, decision, cachedCounts) {
    const result = { kind: 'public-only', title: '本次选择与依据', facts: [], lines: [], exact: null };
    if (!context) return result;
    const exact = exactRiver(context, range, cachedCounts);
    if (exact) {
      result.kind = 'exact-river'; result.exact = exact;
      result.facts.push({ label: '范围模型', value: `${RANGE_NAMES[range]} · ${exact.counts.total} 个合法未知组合逐一摊牌` },
        { label: '模型下权益', value: `${percent(exact.equity)}（平局按半份权益；筹码 EV 单独处理奇数筹码）` },
        { label: '组合分组', value: `你赢 ${exact.counts.win} / 你输 ${exact.counts.lose} / 平局 ${exact.counts.tie}` },
        { label: '实际概率质量', value: `你赢 ${percent(exact.weights.win)} / 你输 ${percent(exact.weights.lose)} / 平局 ${percent(exact.weights.tie)}` });
      if (exact.pots) {
        result.facts.push({ label: '跟注后可争底池', value: `${amount(exact.pots.contestable)}；已排除 ${amount(exact.pots.excluded)} 无资格金额` },
          { label: '跟注价格', value: `${amount(exact.pots.cost)} ÷ ${amount(exact.pots.contestable)} = ${percent(exact.pots.price)}` },
          { label: '模型下跟注 EV', value: `${signed(exact.callEV)} 筹码；弃牌的本次 EV 为 0` });
        if (decision.action === 'raise') result.title = '已记录加注；跟注 EV 不能证明加注更优';
        else if (context.legal.canCheck) result.title = decision.action === 'fold' ? '这里可以免费过牌；弃牌会放弃争池机会' : '免费过牌保留争池机会';
        else if (Math.abs(exact.callEV) < 1e-9) result.title = '此假设下，跟注与弃牌的本次 EV 相同';
        else {
          const preferred = exact.callEV > 0 ? 'call' : 'fold';
          result.title = decision.action === preferred ? '你的选择符合本轮范围下的跟注 / 弃牌比较' : `本轮范围下，${preferred === 'call' ? '跟注' : '弃牌'}的静态 EV 更高`;
        }
      } else result.lines.push('缺少可核对的累计投入，未生成精确可争底池或跟注 EV。牌型枚举不等于底池账目完整。');
      result.lines.push(range === 'uniform' ? '每个合法未知组合等权；这是均匀分布假设，不是对历史对手范围的识别结果。'
        : `${RANGE_NAMES[range]}是人为训练分布：价值侧定义为摊牌能赢你的合法组合，诈唬侧定义为摊牌输给你的组合。目标质量${range === 'value' ? '为你输 80%、你赢 15%、平局 5%' : '为你输 25%、你赢 70%、平局 5%'}；每类内部等权，若某类不存在则将其余质量归一，不虚构不可能的牌。`);
      result.lines.push('只枚举你的底牌和公共牌之外的候选组合，不读取对手真牌。训练分布不是对手知道你手牌或一定采用某策略的断言。');
    } else {
      let advice = null;
      try { if (root.PokerAdvisor && typeof root.PokerAdvisor.advise === 'function') advice = root.PokerAdvisor.advise(context); } catch (_) { /* Public facts remain usable without a coach. */ }
      if (advice) {
        result.kind = 'sampled';
        result.facts.push({ label: '静态基线', value: `${advice.samples} 次固定抽样 · 各存活对手均匀未知范围` },
          { label: '估算权益', value: `${percent(advice.equity)}；抽样区间约 ${percent(advice.equityLow)} 至 ${percent(advice.equityHigh)}` });
        if (advice.potExact) result.facts.push({ label: '跟注后可争底池', value: `${amount(advice.contestablePot)}；门槛 ${percent(advice.potOdds)}` },
          { label: '静态跟注 EV 参考', value: `${signed(Math.round(advice.callEV))}；仅抽样误差区间约 ${signed(Math.floor(advice.callEVLow))} 至 ${signed(Math.ceil(advice.callEVHigh))}` });
        else result.lines.push('累计投入不能核对；不展示近似边池金额或据此计算的精确跟注门槛。');
        result.lines.push('此处不是精确策略求解：均匀未知范围未利用对手真实底牌，也没有从历史动作推断其下注范围。区间只包含抽样误差，不包括范围假设错误。');
        if (context.phase !== 'river') result.lines.push('尚有公共牌或后续下注：到摊牌的静态权益不等于当前跟注能实现的收益，不能直接据此给你的选择判对错。');
        if (liveRivals(context).length > 1) result.lines.push('多人局按当前可争底池作静态比较，其他玩家后续是否跟注、加注或弃牌都可能改变结论。');
      } else result.lines.push('没有可用的牌型/教练计算器。本轮只记录合法选择和原行动对照，不生成胜率或策略结论。');
      if (decision.action === 'fold' && context.legal.canCheck) result.lines.push('本局面允许免费过牌；弃牌将立即放弃继续争池的机会。');
    }
    result.lines.push(decision.action === 'raise'
      ? `你选择加注至 ${amount(decision.raiseTo)}。未建立对手面对该尺度的跟入、再加注和弃牌分布，因此没有计算加注 EV，也不把跟注 EV 当作加注收益。`
      : '以上依据只适用于注明的模型与当前公开信息；不同于原动作本身不构成错误，历史结果也不用于倒推选择质量。');
    return result;
  }

  function createSession(rawMove) {
    const move = normalizeMove(rawMove);
    const supportsRange = !!move.context && move.context.phase === 'river' && liveRivals(move.context).length === 1 && !!evaluator();
    const supportsSize = !!sizeCapability(move.context);
    let size = 'original', range = 'uniform', decision = null, feedback = null, counts = null;
    let current = move.context ? resizeBet(move.context, size) : { context: null, note: '' };
    const oldLegal = { canFold: move.cost !== null, canCheck: move.cost === 0, canCall: move.cost !== null && move.cost > 0,
      canRaise: false, callAmount: move.cost || 0, minRaiseTo: 0, maxRaiseTo: 0 };
    function originalLabel() {
      if (move.actual) return move.actual;
      if (!move.action) return '原行动未记录';
      if (move.action === 'raise' && move.raiseTo === null) return '加注（原金额未记录）';
      return actionLabel(move.action, move.raiseTo, move.context ? move.context.legal : oldLegal, move.context ? move.context.currentBet : move.cost || 0);
    }
    function view() {
      const c = current.context;
      return { phase: c ? PHASES[c.phase] : move.phase || '历史局面', position: move.position || (c ? position(c) : '位置未记录'),
        own: c ? cardText(c.holeCards) : move.own || '手牌未记录', board: c ? cardText(c.board) : move.board,
        pot: c ? c.pot : move.pot, cost: c ? c.legal.callAmount : move.cost,
        players: c ? c.players.map((p, index) => ({ name: p.name, stack: p.stack, bet: p.bet, folded: p.folded, out: p.out, hero: index === c.playerIndex })) : [],
        publicLog: move.publicLog.slice(), legal: { ...(c ? c.legal : oldLegal) },
        size, range, supportsRange, supportsSize, legacy: !c, variantNote: current.note,
        revealed: !!decision, decision: decision ? { ...decision } : null,
        choiceLabel: decision ? actionLabel(decision.action, decision.raiseTo, c ? c.legal : oldLegal, c ? c.currentBet : move.cost || 0) : null,
        originalAction: decision ? originalLabel() : null,
        feedback: feedback ? JSON.parse(JSON.stringify(feedback)) : null };
    }
    function setVariant(next) {
      const newSize = next.size === undefined ? size : next.size, newRange = next.range === undefined ? range : next.range;
      if (!SIZE_NAMES[newSize] || !RANGE_NAMES[newRange]) throw new Error('未知训练变式。');
      if (newSize !== 'original' && !supportsSize) throw new Error('这条历史无法可靠重建下注尺度。');
      if (newRange !== 'uniform' && !supportsRange) throw new Error('范围精算变式仅开放给可完整枚举的单挑河牌。');
      const rebuilt = move.context ? resizeBet(move.context, newSize) : { context: null, note: '' };
      size = newSize; range = newRange; current = rebuilt; decision = null; feedback = null;
      return view();
    }
    function choose(action, raiseTo) {
      if (decision) throw new Error('请先开始另一轮重练。');
      const legal = current.context ? current.context.legal : oldLegal;
      if (action === 'fold' ? !legal.canFold : action === 'call' ? !legal.canCheck && !legal.canCall : action === 'raise' ? !legal.canRaise || !Number.isInteger(raiseTo) || raiseTo < legal.minRaiseTo || raiseTo > legal.maxRaiseTo : true) throw new Error('请选择当前允许的动作和加注总额。');
      decision = { action, ...(action === 'raise' ? { raiseTo } : {}) };
      if (supportsRange && !counts) counts = enumerateRiver(move.context);
      feedback = analyze(current.context, range, decision, counts);
      if (!current.context) {
        feedback.kind = 'legacy'; feedback.title = '旧摘要：先决策，再与原选择对照';
        feedback.lines.push('这条旧记录没有完整公开状态与加注界限，无法恢复精确合法加注、下注尺度或对手范围变式。本次仅练习跟注 / 过牌与弃牌的选择。');
        if (move.reference) feedback.facts.push({ label: '旧记录中的教练参考（未重算）', value: move.reference });
        if (move.reason) feedback.lines.push(`当时记录的理由：${move.reason}`);
        if (move.price !== null) feedback.facts.push({ label: '旧记录跟注门槛（未重算）', value: percent(move.price) });
      }
      if (size !== 'original' || range !== 'uniform') feedback.lines.push('原动作属于原始局面，不是当前变式的标准答案；本轮反馈已经按所选尺度 / 范围重新计算。');
      return view();
    }
    function again() { decision = null; feedback = null; return view(); }
    function changeOpponent() {
      if (supportsRange) return setVariant({ range: ({ uniform: 'value', value: 'bluff', bluff: 'uniform' })[range] });
      if (supportsSize) return setVariant({ size: ({ original: 'half', half: 'pot', pot: 'original' })[size] });
      return again();
    }
    return { view, choose, setVariant, again, changeOpponent };
  }

  let active = null;
  function node(tag, className, content) {
    const el = root.document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
  }
  function button(label, className, handler) {
    const el = node('button', className, label); el.type = 'button'; el.addEventListener('click', handler); return el;
  }
  function render(focusFeedback) {
    const host = root.document && root.document.getElementById('replay-root');
    if (!host || !active) return false;
    const state = active.view(), app = node('div', 'replay-app');
    const heading = node('h2', 'replay-title', `${state.phase} · ${state.position}`); heading.tabIndex = -1;
    app.append(heading, node('p', 'replay-intro', '先选动作，再看依据与原选择。此练习不会推进或修改正在进行的牌局。'));
    const snapshot = node('section', 'replay-snapshot');
    snapshot.append(node('p', 'replay-cards', `你的手牌：${state.own}`), node('p', 'replay-board', `公共牌：${state.board || '尚未发出'}`),
      node('p', 'replay-pot', `底池 ${amount(state.pot)} · 当前需跟 ${state.cost === null ? '未记录' : amount(state.cost)}`));
    if (state.players.length) {
      const players = node('ul', 'replay-players');
      state.players.forEach(p => { if (!p.out) players.append(node('li', 'replay-player', `${p.name}${p.hero ? '（你）' : ''} · 剩余 ${amount(p.stack)} · 本街投入 ${amount(p.bet)}${p.folded ? ' · 已弃牌' : p.stack === 0 ? ' · 已全下' : ''}`)); });
      const seats = node('details', 'replay-seats');
      seats.append(node('summary', 'replay-seats-title', '查看座位与筹码'), players);
      snapshot.append(seats);
    }
    app.append(snapshot);
    if (state.legacy) app.append(node('p', 'replay-limit', '旧摘要缺少完整状态：仅重练弃牌与跟注 / 过牌；无法验证加注金额或重建下注变式。'));
    const variants = node('div', 'replay-variants');
    function select(labelText, id, values, selected, handler) {
      const label = node('label', 'replay-variant-label', labelText); label.htmlFor = id;
      const el = node('select', 'replay-select'); el.id = id;
      Object.entries(values).forEach(([value, title]) => { const option = node('option', '', title); option.value = value; el.append(option); });
      el.value = selected; el.addEventListener('change', () => { handler(el.value); render(false); });
      variants.append(label, el);
    }
    if (state.supportsRange) select('换个对手（训练范围假设）', 'replay-range', RANGE_NAMES, state.range, value => active.setVariant({ range: value }));
    if (state.supportsSize) select('改变本街首次下注', 'replay-size', SIZE_NAMES, state.size, value => active.setVariant({ size: value }));
    if (state.supportsRange || state.supportsSize) {
      variants.append(node('p', 'replay-variant-note', state.variantNote || '变式是基于这手牌的训练假设，不代表历史对手的真实底牌或另一条真实发生过的牌局。'));
      app.append(variants);
    } else if (!state.legacy) app.append(node('p', 'replay-limit', '本轮保留原局面。这里没有可可靠重建的首次下注尺度；范围精算变式仅用于单挑河牌。'));
    const history = node('details', 'replay-history');
    history.append(node('summary', 'replay-history-title', '决定前的公开下注历史'));
    if (state.publicLog.length) { const list = node('ol', 'replay-history-list'); state.publicLog.forEach(line => list.append(node('li', 'replay-history-line', line))); history.append(list); }
    else history.append(node('p', 'replay-limit', '这条记录未保存逐步公开下注历史。'));
    app.append(history);
    let focus = heading;
    if (!state.revealed) {
      const actions = node('section', 'replay-actions'); actions.append(node('h3', 'replay-action-title', '现在由你选择'));
      const error = node('p', 'replay-error'); error.setAttribute('role', 'alert');
      const submit = (action, raiseTo) => { try { active.choose(action, raiseTo); render(true); } catch (e) { error.textContent = e.message; } };
      if (state.legal.canFold) actions.append(button('弃牌', 'replay-fold', () => submit('fold')));
      if (state.legal.canCheck || state.legal.canCall) actions.append(button(state.legal.canCheck ? '过牌' : `跟注 ${amount(state.legal.callAmount)}`, 'replay-call', () => submit('call')));
      if (state.legal.canRaise) {
        const label = node('label', 'replay-raise-label', '加注到（本轮总额）'); label.htmlFor = 'replay-raise-total';
        const input = node('input', 'replay-raise-input'); input.id = 'replay-raise-total'; input.type = 'number'; input.min = state.legal.minRaiseTo; input.max = state.legal.maxRaiseTo; input.step = 1; input.value = state.legal.minRaiseTo;
        input.setAttribute('aria-describedby', 'replay-raise-help');
        const help = node('p', 'replay-raise-help', `合法总额 ${amount(state.legal.minRaiseTo)} 至 ${amount(state.legal.maxRaiseTo)}。`); help.id = 'replay-raise-help';
        actions.append(label, input, button('提交加注', 'replay-raise', () => submit('raise', Number(input.value))), help);
      }
      if (!state.legal.canFold && !state.legal.canCheck && !state.legal.canCall && !state.legal.canRaise) actions.append(node('p', 'replay-limit', '记录缺少跟注金额，无法建立可验证的行动选项。'));
      actions.append(error); app.append(actions);
    } else {
      const feedback = node('section', 'replay-feedback'); feedback.setAttribute('aria-live', 'polite');
      const title = node('h3', 'replay-feedback-title', state.feedback.title); title.tabIndex = -1;
      feedback.append(title, node('p', 'replay-choice', `你的重选：${state.choiceLabel}`), node('p', 'replay-original', `原局面选择：${state.originalAction}`));
      const facts = node('dl', 'replay-facts');
      state.feedback.facts.forEach(fact => facts.append(node('dt', 'replay-fact-label', fact.label), node('dd', 'replay-fact-value', fact.value)));
      feedback.append(facts);
      state.feedback.lines.forEach(line => feedback.append(node('p', 'replay-explanation', line)));
      if (state.feedback.exact) {
        const examples = node('details', 'replay-candidates'); examples.append(node('summary', '', '查看合法候选示例（不是对手真牌）'));
        const groups = { win: '摊牌输给你的候选', lose: '摊牌击败你的候选', tie: '与你平局的候选' };
        for (const key of Object.keys(groups)) examples.append(node('p', 'replay-candidate-line', `${groups[key]}：${state.feedback.exact.counts.examples[key].join(' / ') || '无此类合法组合'}`));
        feedback.append(examples);
      }
      const followup = node('div', 'replay-followup');
      followup.append(button('当前条件再做一次', 'replay-again', () => { active.again(); render(false); }));
      if (state.supportsRange || state.supportsSize) followup.append(button(state.supportsRange ? '换个对手再打' : '换个下注尺度再打', 'replay-change', () => { active.changeOpponent(); render(false); }));
      feedback.append(followup); app.append(feedback); if (focusFeedback) focus = title;
    }
    host.replaceChildren(app);
    if (focus && typeof focus.focus === 'function') focus.focus();
    return true;
  }
  function start(move) {
    if (!root.document || !root.document.getElementById('replay-root')) return false;
    active = createSession(move);
    return render(false);
  }

  root.PokerReplay = Object.freeze({ start });
  if (typeof module === 'object' && module.exports) module.exports = { createSession, copyContext, sizeCapability, resizeBet, enumerateRiver, weightedRange, riverPots, exactRiver };
})(typeof globalThis !== 'undefined' ? globalThis : window);
