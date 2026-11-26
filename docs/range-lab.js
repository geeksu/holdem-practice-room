(function (root) {
  'use strict';

  const dependency = typeof module === 'object' && module.exports ? require('./advisor.js') : null;
  const SUITS = ['s', 'h', 'd', 'c'];
  const SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_NAMES = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
  const KIND_NAMES = { value: '价值候选', bluff: '诈唬候选', thin: '边缘下注候选' };
  const copy = value => JSON.parse(JSON.stringify(value));
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function parseCard(value) {
    if (typeof value === 'string') {
      const match = /^(10|[2-9TJQKA])([shdc])$/i.exec(value.trim());
      if (!match) throw new Error('牌必须写为 As、Td、7h 等形式。');
      const ranks = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
      return { rank: ranks[match[1].toUpperCase()] || Number(match[1]), suit: match[2].toLowerCase() };
    }
    if (!value || !Number.isInteger(value.rank) || value.rank < 2 || value.rank > 14 || !SUITS.includes(value.suit)) throw new Error('无效扑克牌。');
    return { rank: value.rank, suit: value.suit };
  }
  const cardKey = card => `${card.rank}${card.suit}`;
  function cardText(value) {
    const card = parseCard(value);
    return (({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[card.rank] || card.rank) + SYMBOLS[card.suit];
  }
  function combo(id, kind, a, b, note) { return { id, kind, cards: [a, b], note }; }
  function opponents(candidates, clues) {
    const types = [
      { id: 'careful', name: '谨慎的价值下注者', clue: clues[0] },
      { id: 'active', name: '愿意持续施压的对手', clue: clues[1] },
      { id: 'unknown', name: '信息有限的新对手', clue: clues[2] }
    ];
    return types.map((opponent, index) => ({ ...opponent,
      preset: Object.fromEntries(candidates.map((item, i) => [item.id,
        item.kind === 'value' ? (index === 1 ? 70 : 100) : item.kind === 'thin' ? [20, 70, 100][index] :
          index === 0 ? (i === candidates.findIndex(c => c.kind === 'bluff') ? 25 : 0) : index === 1 ? 100 : 35
      ]))
    }));
  }
  function scenario(data, candidates, clues) { return { ...data, candidates, opponents: opponents(candidates, clues) }; }
  const SCENARIOS = freeze([
    scenario({
      id: 'missed-spades', title: '顶对面对河牌下注：未成同花有多少？', hero: ['Ad', 'Jc'], board: ['Jh', '9s', '5s', '2d', '3c'],
      position: '你在大盲，对手在按钮；河牌单挑，比较跟注与弃牌。', potAfterBet: 300, callAmount: 100,
      history: ['翻牌前：按钮加注到 55，你在大盲跟到 55；小盲 10 弃牌。底池 120。',
        '翻牌 J♥ 9♠ 5♠：你过牌，对手下注 40，你跟注。底池 200。',
        '转牌 2♦：双方过牌，底池仍为 200。', '河牌 3♣：你过牌，对手下注 100；当前底池 300，你需跟 100。'],
      lesson: '不能把所有未成同花都当成诈唬：6♠4♠虽然没成同花，却在这个牌面上组成顺子。组合标签只是下注动机假设，胜平负仍由实际牌型比较。'
    }, [
      combo('jj', 'value', 'Js', 'Jd', '暗三条'), combo('99', 'value', '9h', '9d', '暗三条'),
      combo('55', 'value', '5h', '5d', '暗三条'), combo('j9', 'value', 'Js', '9d', '两对'),
      combo('95', 'value', '9h', '5h', '两对'), combo('64', 'value', '6s', '4s', '听牌可能转成价值牌'),
      combo('aks', 'bluff', 'As', 'Ks', '未成同花'), combo('aqs', 'bluff', 'As', 'Qs', '未成同花'),
      combo('kqs', 'bluff', 'Ks', 'Qs', '未成同花'), combo('qts', 'bluff', 'Qs', 'Ts', '未成顺子或同花'),
      combo('t8s', 'bluff', 'Ts', '8s', '未成顺子或同花')
    ], ['训练设定：此前公开的三次河牌下注都展示强牌；样本很小，不能证明从不诈唬。',
      '训练设定：此前公开过两次未成同花的河牌诈唬，也展示过价值牌；你可提高未成听牌权重。',
      '训练设定：没有可靠摊牌记录，只看到这一次下注路线；先建立假设，再测试它是否稳健。']),
    scenario({
      id: 'heart-blocker', title: '拿着 A♥：阻断牌能替你决定吗？', hero: ['Ah', 'Jd'], board: ['Jh', '8h', '4c', '2s', 'Kh'],
      position: '你在按钮，对手在大盲；河牌第三张红桃落地。', potAfterBet: 360, callAmount: 180,
      history: ['翻牌前：你在按钮加注到 45，大盲跟到 45；小盲 10 弃牌。底池 100。',
        '翻牌 J♥ 8♥ 4♣：对手过牌，你下注 40，对手跟注。底池 180。',
        '转牌 2♠：双方过牌，底池仍为 180。', '河牌 K♥：对手领先下注 180；当前底池 360，你需跟 180。'],
      lesson: 'A♥排除了对手所有含 A♥ 的同花组合，但并没有排除其他同花或强牌。阻断牌改变可用组合，不会自动证明对手在诈唬。'
    }, [
      combo('qth', 'value', 'Qh', 'Th', '红桃同花'), combo('q9h', 'value', 'Qh', '9h', '红桃同花'),
      combo('t9h', 'value', 'Th', '9h', '红桃同花'), combo('97h', 'value', '9h', '7h', '红桃同花'),
      combo('88', 'value', '8d', '8c', '暗三条'), combo('kq', 'value', 'Ks', 'Qd', '河牌改善为顶对'),
      combo('qts', 'bluff', 'Qs', 'Ts', '未成顺子'), combo('acqc', 'bluff', 'Ac', 'Qc', '高牌转诈唬'),
      combo('actc', 'bluff', 'Ac', 'Tc', '高牌转诈唬'), combo('97s', 'bluff', '9s', '7s', '未成顺子')
    ], ['训练设定：过去两次第三张同花牌落地后的大下注，都公开了同花；记录尚不足以确定范围。',
      '训练设定：曾在明显完成听牌的河牌用高牌领先大下注，也会同样下注强牌。',
      '训练设定：没有可用摊牌样本；不要只因为自己有 A♥ 就默认对手诈唬多。']),
    scenario({
      id: 'double-paired', title: '双对公共牌：平局也必须算进权益', hero: ['As', 'Qd'], board: ['Kc', '7d', '7s', '2h', '2c'],
      position: '你在大盲，对手在按钮；河牌面对 1.5 倍底池下注。', potAfterBet: 500, callAmount: 300,
      history: ['翻牌前：按钮加注到 45，你在大盲跟到 45；小盲 10 弃牌。底池 100。',
        '翻牌 K♣ 7♦ 7♠：双方过牌，底池 100。',
        '转牌 2♥：你过牌，对手下注 50，你跟注。底池 200。',
        '河牌 2♣：你过牌，对手下注 300；当前底池 500，你需跟 300。'],
      lesson: '在这个牌面上，对手某些 A 高牌会与你平分，并非全部输赢分明。权益应为胜率加一半平局率；EV则以跟注后的整个底池份额计算。'
    }, [
      combo('kq', 'value', 'Kd', 'Qh', 'K 对参与价值下注'), combo('kj', 'value', 'Kh', 'Jd', 'K 对参与价值下注'),
      combo('76', 'value', '7h', '6h', '葫芦'), combo('22', 'value', '2d', '2s', '四条'),
      combo('ak', 'value', 'Ah', 'Kh', 'K 对参与价值下注'), combo('77', 'value', '7c', '7h', '四条'),
      combo('qj', 'bluff', 'Qh', 'Jd', '高牌转诈唬'), combo('t9', 'bluff', 'Ts', '9s', '高牌转诈唬'),
      combo('qt', 'bluff', 'Qc', 'Tc', '高牌转诈唬'), combo('86', 'bluff', '8h', '6h', '高牌转诈唬'),
      combo('aj', 'thin', 'Ah', 'Jc', 'A 高牌下注候选'), combo('at', 'thin', 'Ac', 'Td', 'A 高牌下注候选')
    ], ['训练设定：此前公开过的超池下注偏向葫芦或四条；这是有限样本，不是对手的真实底牌。',
      '训练设定：曾用未改善的高牌做超池下注，也能用同样尺寸下注强牌。',
      '训练设定：没有可靠超池下注记录；把 A 高牌平局候选也纳入你愿意假设的范围。'])
  ]);

  // Exact river heads-up enumeration, conditional on the caller's hypothetical
  // weighted range. No random sampling, real deck, opponent secrets, or game RNG.
  function analyzeRange(input) {
    if (!input || !Array.isArray(input.hero) || input.hero.length !== 2 || !Array.isArray(input.board) || input.board.length !== 5) throw new Error('范围训练需要两张自己的牌和五张河牌公共牌。');
    const hero = input.hero.map(parseCard), board = input.board.map(parseCard);
    const known = new Set(hero.concat(board).map(cardKey));
    if (known.size !== 7) throw new Error('已知底牌与公共牌不能重复。');
    const potAfterBet = input.potAfterBet, callAmount = input.callAmount;
    if (!Number.isFinite(potAfterBet) || potAfterBet < 0 || !Number.isFinite(callAmount) || callAmount <= 0 || !Array.isArray(input.combos)) throw new Error('请提供有效底池、跟注金额和范围组合。');
    const evaluator = dependency || root.PokerAdvisor;
    if (!evaluator || typeof evaluator.evaluate !== 'function') throw new Error('请先加载 PokerAdvisor 的牌型评估器。');
    const heroScore = evaluator.evaluate(hero.concat(board));
    const seen = new Set(), rows = [], excluded = [];
    let totalWeight = 0, winWeight = 0, tieWeight = 0, lossWeight = 0;
    for (let i = 0; i < input.combos.length; i++) {
      const candidate = input.combos[i], weight = candidate.weight === undefined ? 1 : candidate.weight;
      if (!Number.isFinite(weight) || weight < 0) throw new Error('组合权重必须为非负数。');
      if (weight === 0) continue;
      if (!Array.isArray(candidate.cards) || candidate.cards.length !== 2) throw new Error('每个范围组合必须恰好有两张牌。');
      const cards = candidate.cards.map(parseCard);
      const keys = cards.map(cardKey).sort();
      const id = typeof candidate.id === 'string' ? candidate.id : String(i);
      if (keys[0] === keys[1]) { excluded.push({ id, reason: '组合内重复牌' }); continue; }
      if (keys.some(key => known.has(key))) { excluded.push({ id, reason: '被自己的牌或公共牌阻断' }); continue; }
      const key = keys.join('/');
      if (seen.has(key)) { excluded.push({ id, reason: '重复实体组合，仅保留首次非零项' }); continue; }
      seen.add(key);
      const opponentScore = evaluator.evaluate(cards.concat(board));
      const outcome = heroScore > opponentScore ? 'win' : heroScore === opponentScore ? 'tie' : 'loss';
      totalWeight += weight;
      if (outcome === 'win') winWeight += weight;
      else if (outcome === 'tie') tieWeight += weight;
      else lossWeight += weight;
      rows.push({ id, cards, weight, kind: typeof candidate.kind === 'string' ? candidate.kind : 'other', outcome });
    }
    if (!rows.length || totalWeight <= 0) throw new Error('至少保留一个未被已知牌阻断的组合。');
    const equity = (winWeight + tieWeight / 2) / totalWeight;
    const finalPot = potAfterBet + callAmount, potOdds = callAmount / finalPot;
    const callEV = equity * finalPot - callAmount;
    return { equity, winRate: winWeight / totalWeight, tieRate: tieWeight / totalWeight, lossRate: lossWeight / totalWeight,
      winWeight, tieWeight, lossWeight, totalWeight, totalCombos: rows.length, rows, excluded,
      potAfterBet, callAmount, finalPot, potOdds, callEV, foldEV: 0,
      preferred: Math.abs(callEV) < 1e-9 ? 'either' : callEV > 0 ? 'call' : 'fold',
      method: '所选河牌组合精确枚举',
      assumption: '每个实体组合按设定权重到达当前下注；只比较河牌跟注与弃牌，无抽水、无后续下注。范围是假设，不是真实底牌。' };
  }

  function createSession(initialId = SCENARIOS[0].id) {
    let scene, opponent, weights, feedback = null, chosen = null;
    const history = [];
    function setScene(id) {
      const found = SCENARIOS.find(item => item.id === id);
      if (!found) throw new Error('训练场景不存在。');
      scene = found; opponent = scene.opponents[0]; weights = { ...opponent.preset }; feedback = null; chosen = null;
      return view();
    }
    function view() {
      return copy({ status: feedback ? 'answered' : 'question', scenario: scene, opponentId: opponent.id, weights,
        selectedAction: chosen, feedback,
        history: feedback ? history.filter(item => item.scenarioId === scene.id).slice(-6) : [] });
    }
    function selectOpponent(id) {
      const found = scene.opponents.find(item => item.id === id);
      if (!found) throw new Error('对手预设不存在。');
      opponent = found; weights = { ...opponent.preset }; feedback = null; chosen = null;
      return view();
    }
    function setWeight(id, value) {
      if (!scene.candidates.some(item => item.id === id)) throw new Error('范围组合不存在。');
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error('相对权重应在 0 到 100 之间。');
      if (weights[id] !== number) { weights[id] = number; feedback = null; chosen = null; }
      return view();
    }
    function answer(action) {
      if (feedback) throw new Error('先调整范围、换对手或重新作答，再提交判断。');
      if (!['call', 'fold'].includes(action)) throw new Error('请选择跟注或弃牌。');
      const result = analyzeRange({ hero: scene.hero, board: scene.board, potAfterBet: scene.potAfterBet, callAmount: scene.callAmount,
        combos: scene.candidates.map(item => ({ id: item.id, cards: item.cards, kind: item.kind, weight: weights[item.id] })) });
      chosen = action;
      feedback = { ...result, chosenEV: action === 'call' ? result.callEV : 0,
        matches: result.preferred === 'either' || result.preferred === action,
        custom: scene.candidates.some(item => weights[item.id] !== opponent.preset[item.id]) };
      history.push({ scenarioId: scene.id, opponent: opponent.name, custom: feedback.custom, action,
        equity: result.equity, potOdds: result.potOdds, callEV: result.callEV, totalCombos: result.totalCombos });
      return view();
    }
    function retry() { feedback = null; chosen = null; return view(); }
    setScene(initialId);
    return { view, selectScenario: setScene, selectOpponent, setWeight, answer, retry,
      resetRange: () => selectOpponent(opponent.id) };
  }

  let session = null;
  let editorOpen = false;
  const percent = value => (value * 100).toFixed(1) + '%';
  const amount = value => Math.abs(value) < 1e-9 ? '0' : (value > 0 ? '+' : '−') + Math.abs(value).toFixed(1);
  function element(tag, className, text) {
    const node = root.document.createElement(tag); node.className = className || '';
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(className, text, handler) {
    const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node;
  }
  function cards(values, title) {
    const box = element('div', 'range-card-group'); box.append(element('p', 'range-card-label', title));
    const row = element('div', 'range-cards');
    values.forEach(value => {
      const card = parseCard(value), node = element('span', 'range-card' + (['h','d'].includes(card.suit) ? ' red' : ''), cardText(card));
      node.setAttribute('aria-label', SUIT_NAMES[card.suit] + (({11:'J',12:'Q',13:'K',14:'A'})[card.rank] || card.rank)); row.append(node);
    }); box.append(row); return box;
  }
  function render(focusId) {
    const host = root.document.getElementById('range-root'); if (!host) return false;
    const state = session.view(), scene = state.scenario;
    const layout = element('div', 'range-layout');
    layout.append(element('p', 'range-intro', '同一手牌，换个对手再打。先猜范围，再选跟注或弃牌；最后看当前假设下的权益与收益。'));
    const selectLabel = element('label', 'range-scenario-label', '训练牌局');
    const select = element('select', 'range-scenario-select'); select.id = 'range-scenario-select';
    SCENARIOS.forEach(item => { const option = element('option', '', item.title); option.value = item.id; option.selected = item.id === scene.id; select.append(option); });
    select.value = scene.id; select.addEventListener('change', () => { session.selectScenario(select.value); editorOpen = false; render('range-scene-title'); });
    selectLabel.append(select); layout.append(selectLabel);
    const title = element('h3', 'range-scene-title', scene.title); title.id = 'range-scene-title'; title.tabIndex = -1;
    layout.append(title, element('p', 'range-position', scene.position));
    const deal = element('div', 'range-deal'); deal.append(cards(scene.hero, '你的底牌'), cards(scene.board, '公共牌 · 河牌')); layout.append(deal);
    layout.append(element('p', 'range-pot-summary', `对手下注前底池 ${scene.potAfterBet - scene.callAmount}，本次下注 ${scene.callAmount}。当前池 ${scene.potAfterBet} 已含对手下注；你需跟 ${scene.callAmount}。`));
    const history = element('ol', 'range-history'); scene.history.forEach(line => history.append(element('li', '', line))); layout.append(history);
    const opponentsBox = element('fieldset', 'range-opponent-grid'); opponentsBox.append(element('legend', '', '换一位对手，保持底牌、牌面与下注金额不变'));
    scene.opponents.forEach(opponent => {
      const control = button('range-opponent' + (opponent.id === state.opponentId ? ' selected' : ''), opponent.name,
        () => { session.selectOpponent(opponent.id); editorOpen = false; render('range-opponent-' + opponent.id); });
      control.id = 'range-opponent-' + opponent.id; control.setAttribute('aria-pressed', String(opponent.id === state.opponentId)); opponentsBox.append(control);
    }); layout.append(opponentsBox);
    const opponent = scene.opponents.find(item => item.id === state.opponentId);
    layout.append(element('p', 'range-clue', opponent.clue), element('p', 'range-assumption', '下面只是可修改的范围假设，不代表对手真实底牌。每个组合独立按相对权重计算；100 不是“对手有这手牌的概率”。'));
    const selectedCount = scene.candidates.filter(item => state.weights[item.id] > 0).length;
    const disclosure = element('details', 'range-editor-disclosure'); disclosure.id = 'range-editor-disclosure'; disclosure.open = editorOpen;
    disclosure.addEventListener('toggle', () => { if (root.document.getElementById(disclosure.id) === disclosure) editorOpen = disclosure.open; });
    disclosure.append(element('summary', 'range-editor-summary', `调整范围 · 已选 ${selectedCount} 个组合`));
    const editor = element('fieldset', 'range-editor'); editor.append(element('legend', '', '① 选择你认为会下注的组合，并调整相对权重'));
    ['value','bluff','thin'].forEach(kind => {
      const candidates = scene.candidates.filter(item => item.kind === kind); if (!candidates.length) return;
      const group = element('fieldset', 'range-group'); group.append(element('legend', '', KIND_NAMES[kind]));
      candidates.forEach(item => {
        const row = element('div', 'range-combo'), cardLabel = item.cards.map(cardText).join(' '), weight = state.weights[item.id];
        const label = element('label', 'range-combo-choice');
        const check = element('input', 'range-combo-check'); check.type = 'checkbox'; check.checked = weight > 0; check.id = 'range-check-' + item.id;
        check.addEventListener('change', () => { session.setWeight(item.id, check.checked ? 100 : 0); editorOpen = true; render(check.id); });
        label.append(check, element('span', 'range-combo-cards', cardLabel), element('span', 'range-combo-note', item.note));
        const weightLabel = element('label', 'range-weight-label', '权重');
        const input = element('input', 'range-weight'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '5'; input.value = String(weight); input.disabled = weight === 0; input.id = 'range-weight-' + item.id;
        input.setAttribute('aria-label', cardLabel + ' 到达当前下注的相对权重');
        input.addEventListener('change', () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || value < 0 || value > 100) { input.value = String(session.view().weights[item.id]); return; }
          session.setWeight(item.id, value); editorOpen = true; render(input.id);
        });
        weightLabel.append(input); row.append(label, weightLabel); group.append(row);
      }); editor.append(group);
    }); disclosure.append(editor); layout.append(disclosure);
    const status = element('p', 'range-status', `${selectedCount} 个组合已纳入假设。` + (state.status === 'question' ? '请先选择行动，提交后才显示计算结果。' : '调整任意组合或换对手后，需要重新作答。'));
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); layout.append(status);
    const actions = element('fieldset', 'range-actions'); actions.append(element('legend', '', '② 你会怎么做？这里只提交训练判断，不操作牌桌'));
    const call = button('range-answer range-answer-call', '我选择跟注 ' + scene.callAmount, () => { session.answer('call'); render('range-feedback-title'); });
    const fold = button('range-answer range-answer-fold', '我选择弃牌', () => { session.answer('fold'); render('range-feedback-title'); });
    call.disabled = fold.disabled = state.status === 'answered' || selectedCount === 0; actions.append(call, fold); layout.append(actions);
    if (state.feedback) {
      const result = state.feedback, feedback = element('section', 'range-feedback'); feedback.setAttribute('aria-live', 'polite');
      const headline = element('h4', 'range-feedback-title', result.preferred === 'either' ? '在当前范围假设下，两种行动等期望' : result.matches ? '你的选择符合当前范围假设的收益比较' : '换一种范围假设，行动结论也可能改变');
      headline.id = 'range-feedback-title'; headline.tabIndex = -1; feedback.append(headline);
      const metrics = element('dl', 'range-metrics');
      [['当前范围权益',percent(result.equity)],['跟注门槛',percent(result.potOdds)],['跟注 EV',amount(result.callEV)],['弃牌 EV','0']].forEach(([label,value]) => {
        const item = element('div', 'range-metric'); item.append(element('dt','',label),element('dd','',value)); metrics.append(item);
      }); feedback.append(metrics);
      feedback.append(element('p', 'range-outcomes', `按权重：胜 ${percent(result.winRate)} · 平 ${percent(result.tieRate)} · 负 ${percent(result.lossRate)}。权益 = 胜率 + 平局率 ÷ 2。`));
      feedback.append(element('p', 'range-calculation', `跟注 EV = ${percent(result.equity)} × (${scene.potAfterBet} + ${scene.callAmount}) − ${scene.callAmount} = ${amount(result.callEV)}；弃牌 EV = 0。显示百分比已四舍五入，计算用未舍入值。`));
      feedback.append(element('p', 'range-explanation', `你选${state.selectedAction === 'call' ? '跟注' : '弃牌'}，本次行动 EV 为 ${amount(result.chosenEV)}。` +
        (result.preferred === 'either' ? '两种行动在此假设下无差异。' : `只比较这两种行动，${result.preferred === 'call' ? '跟注' : '弃牌'}的期望更高。`)));
      feedback.append(element('p', 'range-lesson', scene.lesson), element('p', 'range-assumption', result.assumption));
      const details = element('details', 'range-combo-results'); details.append(element('summary', '', `查看 ${result.totalCombos} 个组合的实际牌型比较`));
      const table = element('table', 'range-results-table'), caption = element('caption', '', '结果从你的视角计算；“价值/诈唬”标签不代替牌型比较'); table.append(caption);
      const head = element('thead'), headRow = element('tr'); ['对手组合','候选类型','权重','你的结果'].forEach(text => { const cell = element('th','',text); cell.setAttribute('scope','col');headRow.append(cell); }); head.append(headRow); table.append(head);
      const body = element('tbody'); result.rows.forEach(item => { const row = element('tr'); [item.cards.map(cardText).join(' '),KIND_NAMES[item.kind]||'其他',String(item.weight),{win:'胜',tie:'平',loss:'负'}[item.outcome]].forEach(text=>row.append(element('td','',text)));body.append(row); }); table.append(body);details.append(table);feedback.append(details);
      const tools = element('div', 'range-feedback-actions');
      tools.append(button('range-retry','保留范围，重新作答',()=>{session.retry();render('range-scene-title');}),
        button('range-reset','恢复该对手预设',()=>{session.resetRange();editorOpen=false;render('range-scene-title');}),
        button('range-next-opponent','同一手，换下个对手',()=>{const index=scene.opponents.findIndex(item=>item.id===state.opponentId);session.selectOpponent(scene.opponents[(index+1)%scene.opponents.length].id);editorOpen=false;render('range-scene-title');}));
      feedback.append(tools); layout.append(feedback);
      if (state.history.length > 1) {
        const comparison = element('section', 'range-comparison'); comparison.append(element('h4','','同一手牌的已答对照'));
        const list = element('ul'); state.history.forEach(item=>list.append(element('li','range-comparison-item',`${item.opponent}${item.custom?'（自定范围）':''}：${item.totalCombos} 组合，权益 ${percent(item.equity)}，跟注 EV ${amount(item.callEV)}。`)));comparison.append(list);layout.append(comparison);
      }
    }
    host.replaceChildren(layout);
    if (focusId) { const node = root.document.getElementById(focusId); if (node && typeof node.focus === 'function') node.focus(); }
    return true;
  }
  function start() {
    if (!root.document || !root.document.getElementById('range-root')) return false;
    if (!session) session = createSession();
    return render();
  }
  const api = Object.freeze({ SCENARIOS, parseCard, analyzeRange, createSession, start });
  root.PokerRangeLab = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
