'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Advisor = require('../docs/advisor.js');
const Engine = require('../docs/engine.js');
const Replay = require('../docs/replay.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log(`✓ ${name}`); }
function cards(value) { return value.split(' ').map(s => ({ rank: ({ T: 10, J: 11, Q: 12, K: 13, A: 14 })[s[0]] || Number(s[0]), suit: s[1] })); }
function context({ phase = 'river', count = 2, bet = 100 } = {}) {
  const board = cards('2c 7d 9h Js Kc').slice(0, ({ preflop: 0, flop: 3, turn: 4, river: 5 })[phase]);
  const players = Array.from({ length: count }, (_, i) => ({ name: i === 0 ? '你' : `对手${i}`, style: 'balanced', stack: 950 - (i === count - 1 ? bet : 0), bet: i === count - 1 ? bet : 0,
    folded: false, out: false, contributed: 50 + (i === count - 1 ? bet : 0), lastAction: i === count - 1 ? `下注 ${bet}` : '过牌' }));
  const result = { playerIndex: 0, players, holeCards: cards('Qd Qh'), board,
    pot: count * 50 + bet, currentBet: bet, minRaise: Math.max(20, bet), bigBlind: 20, dealer: 0, phase,
    legal: { canFold: true, canCall: true, canCheck: false, canRaise: true, callAmount: bet, minRaiseTo: bet + Math.max(20, bet), maxRaiseTo: 950 } };
  if (phase === 'preflop') {
    result.players.forEach((p, i) => { p.bet = i === 1 ? 10 : i === 2 ? 20 : 0; p.contributed = p.bet; p.stack = 1000 - p.bet; p.lastAction = ''; });
    result.pot = 30; result.currentBet = 20; result.minRaise = 20;
    result.legal = { canFold: true, canCall: true, canCheck: false, canRaise: true, callAmount: 20, minRaiseTo: 40, maxRaiseTo: 1000 };
  }
  return result;
}
function move(c = context()) {
  return { context: c, actual: '原动作秘密标记：弃牌', action: 'fold', reference: '提示秘密标记', reason: '不能预先展示的原因',
    phase: '河牌', position: '庄家位', own: 'Q♦ Q♥', board: '2♣ 7♦ 9♥ J♠ K♣', pot: c.pot, cost: c.legal.callAmount,
    publicLog: ['进入河牌。', `对手${c.players.length - 1}下注 ${c.currentBet}。`] };
}
function sumStacksAndPot(c) { return c.players.reduce((sum, p) => sum + p.stack, 0) + c.pot; }

test('公开快照白名单不读取对手底牌、真实牌堆和其他隐藏属性', () => {
  const raw = context();
  for (const p of raw.players) Object.defineProperty(p, 'cards', { get() { throw new Error('读取了对手底牌'); } });
  for (const key of ['deck', 'state', 'rng', 'result', 'private']) Object.defineProperty(raw, key, { get() { throw new Error(`读取了${key}`); } });
  const historical = move(raw);
  Object.defineProperty(historical, 'result', { get() { throw new Error('读取了最终结果'); } });
  const copied = Replay.copyContext(raw);
  assert.ok(copied);
  assert.equal(copied.players[1].cards, undefined);
  assert.equal(copied.deck, undefined);
  const session = Replay.createSession(historical);
  const before = JSON.stringify(session.view());
  assert.ok(!before.includes('秘密标记'));
  assert.ok(!before.includes('不能预先展示'));
  assert.equal(session.view().revealed, false);
  session.choose('call');
  assert.equal(session.view().originalAction, historical.actual);
  assert.equal(session.view().feedback.kind, 'exact-river');
});

test('每条街多人原行动都能重做，未假装多人或非河牌精确求解', () => {
  for (const phase of ['preflop', 'flop', 'turn', 'river']) {
    const session = Replay.createSession(move(context({ phase, count: 3 })));
    assert.equal(session.view().legacy, false);
    assert.equal(session.view().supportsRange, false);
    assert.equal(session.view().revealed, false);
    const after = session.choose('call');
    assert.equal(after.feedback.kind, 'sampled');
    assert.ok(after.feedback.facts.some(f => f.value.includes('固定抽样')));
    assert.ok(after.feedback.lines.some(line => line.includes('多人局')));
    if (phase !== 'river') assert.ok(after.feedback.lines.some(line => line.includes('不能直接据此给你的选择判对错')));
    assert.throws(() => session.setVariant({ range: 'value' }));
  }
});

test('加注必须合法且用本轮总额，错误输入不能提前揭晓', () => {
  const session = Replay.createSession(move());
  for (const invalid of [199, 951, 200.5, NaN]) assert.throws(() => session.choose('raise', invalid));
  assert.throws(() => session.choose('teleport'));
  assert.equal(session.view().revealed, false);
  const result = session.choose('raise', 300);
  assert.equal(result.choiceLabel, '加注至 300');
  assert.ok(result.feedback.title.includes('不能证明加注更优'));
  assert.ok(result.feedback.lines.some(line => line.includes('没有计算加注 EV')));
  assert.throws(() => session.choose('fold'));
  session.again();
  assert.equal(session.view().revealed, false);
});

test('单挑河牌枚举990个合法候选，与旧引擎独立逐组合核对', () => {
  const c = Replay.copyContext(context());
  const enumerated = Replay.enumerateRiver(c);
  const known = new Set(c.holeCards.concat(c.board).map(card => `${card.rank}${card.suit}`));
  const unknown = ['s', 'h', 'd', 'c'].flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit }))).filter(card => !known.has(`${card.rank}${card.suit}`));
  const hero = Engine.evaluate(c.holeCards.concat(c.board));
  const counts = { win: 0, lose: 0, tie: 0 };
  for (let a = 0; a < unknown.length - 1; a++) for (let b = a + 1; b < unknown.length; b++) {
    const comparison = Engine.compare(hero, Engine.evaluate([unknown[a], unknown[b], ...c.board]));
    counts[comparison > 0 ? 'win' : comparison < 0 ? 'lose' : 'tie']++;
  }
  assert.equal(enumerated.total, 990);
  for (const key of Object.keys(counts)) assert.equal(enumerated[key], counts[key]);
  assert.ok(counts.win > 0 && counts.lose > 0 && counts.tie > 0);
  const uniform = Replay.exactRiver(c, 'uniform');
  assert.ok(Math.abs(uniform.equity - (counts.win + counts.tie / 2) / 990) < 1e-12);
});

test('换价值/诈唬分布实际重算概率、EV与反馈，原行动始终隐藏到选择后', () => {
  const session = Replay.createSession(move());
  session.setVariant({ range: 'value' });
  assert.equal(session.view().originalAction, null);
  const value = session.choose('call');
  assert.equal(value.feedback.exact.weights.lose, 0.80);
  assert.ok(value.feedback.exact.callEV < 0);
  assert.ok(value.feedback.title.includes('弃牌'));
  session.changeOpponent();
  assert.equal(session.view().range, 'bluff');
  assert.equal(session.view().revealed, false);
  const bluff = session.choose('call');
  assert.equal(bluff.feedback.exact.weights.win, 0.70);
  assert.ok(bluff.feedback.exact.callEV > 0);
  assert.ok(bluff.feedback.title.includes('符合'));
  assert.notEqual(value.feedback.exact.callEV, bluff.feedback.exact.callEV);
  assert.ok(bluff.feedback.lines.some(line => line.includes('原动作属于原始局面')));
});

test('不存在的价值/诈唬类别不能被虚构，公共牌平局正确分奇数筹码', () => {
  const c = context();
  c.holeCards = cards('2d 3d'); c.board = cards('As Ks Qs Js Ts');
  c.players.push({ name: '已弃牌者', style: '', stack: 999, bet: 0, contributed: 1, folded: true, out: false, lastAction: '弃牌' });
  c.pot = 201; c.dealer = 1;
  const clean = Replay.copyContext(c);
  for (const mode of ['uniform', 'value', 'bluff']) {
    const result = Replay.exactRiver(clean, mode);
    assert.equal(result.counts.win, 0); assert.equal(result.counts.lose, 0); assert.equal(result.counts.tie, 990);
    assert.equal(result.weights.tie, 1);
    assert.equal(result.pots.contestable, 301);
    assert.equal(result.pots.tiePayout, 151); // Hero is first winning seat left of dealer.
    assert.equal(result.callEV, 51);
  }
  clean.dealer = 0;
  assert.equal(Replay.exactRiver(clean, 'uniform').callEV, 50);
});

test('不足额跟注排除不可争金额，缺少投入账目时不伪造精确EV', () => {
  const raw = context();
  raw.players[0].stack = 50;
  raw.legal = { canFold: true, canCall: true, canCheck: false, canRaise: false, callAmount: 50, minRaiseTo: 50, maxRaiseTo: 50 };
  const result = Replay.exactRiver(Replay.copyContext(raw), 'uniform');
  assert.equal(result.pots.contestable, 200);
  assert.equal(result.pots.excluded, 50);
  assert.equal(result.pots.price, 0.25);
  const missing = context(); delete missing.players[1].contributed;
  const session = Replay.createSession(move(missing));
  assert.equal(session.view().supportsSize, false);
  const after = session.choose('call');
  assert.equal(after.feedback.exact.callEV, null);
  assert.ok(after.feedback.lines.some(line => line.includes('未生成精确')));
});

test('八人首次单人下注支持半池/满池变式，重建筹码/总池/合法加注', () => {
  const original = context({ phase: 'flop', count: 8, bet: 100 });
  const originalJSON = JSON.stringify(original);
  const half = Replay.resizeBet(original, 'half').context;
  const full = Replay.resizeBet(original, 'pot').context;
  assert.equal(half.currentBet, 200); assert.equal(half.pot, 600);
  assert.equal(half.players[7].stack, 750); assert.equal(half.players[7].contributed, 250);
  assert.equal(half.legal.callAmount, 200); assert.equal(half.legal.minRaiseTo, 400);
  assert.equal(full.currentBet, 400); assert.equal(full.pot, 800);
  assert.equal(full.players[7].stack, 550); assert.equal(full.legal.minRaiseTo, 800);
  assert.equal(sumStacksAndPot(half), 8000); assert.equal(sumStacksAndPot(full), 8000);
  assert.equal(JSON.stringify(original), originalJSON);
  const session = Replay.createSession(move(original));
  assert.equal(session.view().supportsSize, true);
  session.setVariant({ size: 'half' }); const a = session.choose('call');
  session.setVariant({ size: 'pot' }); const b = session.choose('call');
  assert.equal(a.feedback.kind, 'sampled');
  assert.notDeepEqual(a.feedback.facts, b.feedback.facts);
  assert.ok(b.variantNote.includes('其余公开事实保持不变'));
});

test('多人已有跟注、缺账和翻前盲注不能冒充首笔下注变式', () => {
  const called = context({ phase: 'flop', count: 3 });
  called.players[1].bet = 100; called.players[1].contributed += 100; called.players[1].stack -= 100; called.pot += 100;
  assert.equal(Replay.sizeCapability(Replay.copyContext(called)), null);
  assert.throws(() => Replay.resizeBet(called, 'half'));
  assert.equal(Replay.sizeCapability(Replay.copyContext(context({ phase: 'preflop', count: 3 }))), null);
  const bad = context(); bad.pot++;
  assert.equal(Replay.sizeCapability(Replay.copyContext(bad)), null);
  const short = context({ bet: 100 }); short.players[1].stack = 0;
  assert.equal(Replay.resizeBet(short, 'pot').context.players[1].stack, 0);
});

test('旧V5摘要只能有限重练，先不揭晓，之后诚实标记未重算', () => {
  const legacy = { phase: '翻牌', position: '大盲位', own: 'A♠ Q♠', board: 'J♠ 8♠ 2♦', pot: 300, cost: 100,
    actual: '旧动作秘密：加注至 500', reference: '旧提示秘密', reason: '旧理由秘密', price: .25, equity: .48 };
  const session = Replay.createSession(legacy), before = session.view();
  assert.equal(before.legacy, true);
  assert.equal(before.legal.canRaise, false);
  assert.equal(before.supportsSize, false); assert.equal(before.supportsRange, false);
  assert.ok(!JSON.stringify(before).includes('秘密'));
  assert.throws(() => session.choose('raise', 500));
  const after = session.choose('call');
  assert.equal(after.originalAction, legacy.actual);
  assert.equal(after.feedback.kind, 'legacy');
  assert.ok(after.feedback.facts.some(fact => fact.label.includes('未重算')));
  assert.ok(after.feedback.lines.some(line => line.includes('无法恢复精确合法加注')));
  const free = Replay.createSession({ ...legacy, cost: 0 });
  assert.equal(free.view().legal.canCheck, true);
  assert.equal(free.choose('call').choiceLabel, '过牌');
});

test('不读写storage、不消耗游戏Math.random、不改变原move或公开历史', () => {
  const originalRandom = Math.random;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const raw = move(context({ phase: 'flop', count: 8 }));
  const before = JSON.stringify(raw);
  Math.random = () => { throw new Error('消费了游戏随机源'); };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('访问了storage'); } });
  try {
    const session = Replay.createSession(raw);
    session.choose('call'); session.changeOpponent(); session.choose('call');
    const river = Replay.createSession(move());
    river.choose('call'); river.changeOpponent(); river.choose('call');
    assert.equal(JSON.stringify(raw), before);
  } finally {
    Math.random = originalRandom;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  }
});

class TestElement {
  constructor(tag, document) { this.tagName = tag; this.document = document; this.children = []; this.className = ''; this.textContent = ''; this.attributes = {}; this.listeners = {}; this.disabled = false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.listeners[key] = callback; }
  focus() { this.document.activeElement = this; }
  click() { if (!this.disabled && this.listeners.click) this.listeners.click(); }
  change(value) { this.value = value; if (this.listeners.change) this.listeners.change(); }
}
function browserHarness() {
  const document = { activeElement: null, createElement(tag) { return new TestElement(tag, this); }, getElementById(id) { return id === 'replay-root' ? host : null; } };
  const host = new TestElement('section', document);
  const sandbox = { document, PokerAdvisor: Advisor, PokerEngine: Engine };
  Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('UI读取了storage'); } });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/replay.js'), 'utf8'), sandbox);
  const all = className => {
    const found = [];
    function walk(el) { if (el.className.split(' ').includes(className)) found.push(el); el.children.forEach(walk); }
    walk(host); return found;
  };
  const bodyText = () => { let result = ''; function walk(el) { result += ` ${el.textContent}`; el.children.forEach(walk); } walk(host); return result; };
  return { sandbox, host, document, all, bodyText };
}

test('DOM先行动后揭晓、合法加注校验、范围切换重新隐藏；座位默认折叠', () => {
  const browser = browserHarness(), raw = move();
  assert.equal(browser.host.children.length, 0);
  assert.equal(browser.sandbox.PokerReplay.start(raw), true);
  assert.ok(!browser.bodyText().includes('秘密标记'));
  assert.equal(browser.all('replay-title')[0].textContent, '河牌 · 庄家位');
  assert.equal(browser.all('replay-seats')[0].tagName, 'details');
  assert.ok(!browser.all('replay-seats')[0].open);
  assert.equal(browser.all('replay-seats-title')[0].textContent, '查看座位与筹码');
  assert.equal(browser.all('replay-history-line').length, 2);
  assert.equal(browser.all('replay-fold').length, 1);
  assert.equal(browser.all('replay-call').length, 1);
  const input = browser.all('replay-raise-input')[0];
  assert.equal(input.type, 'number'); assert.equal(input.min, 200);
  input.value = 199; browser.all('replay-raise')[0].click();
  assert.ok(browser.all('replay-error')[0].textContent.includes('允许'));
  assert.equal(browser.all('replay-feedback').length, 0);
  input.value = 300; browser.all('replay-raise')[0].click();
  assert.equal(browser.all('replay-feedback').length, 1);
  assert.ok(browser.bodyText().includes(raw.actual));
  assert.ok(browser.bodyText().includes('没有计算加注 EV'));
  assert.equal(browser.document.activeElement.className, 'replay-feedback-title');
  browser.all('replay-change')[0].click();
  assert.equal(browser.all('replay-feedback').length, 0);
  assert.ok(!browser.bodyText().includes(raw.actual));
  assert.equal(browser.all('replay-select').find(el => el.id === 'replay-range').value, 'value');
  browser.all('replay-call')[0].click();
  assert.ok(browser.bodyText().includes('80.0%'));
  browser.sandbox.PokerReplay.start(raw);
  assert.equal(browser.all('replay-feedback').length, 0); // Start is always an unrevealed round.
});

test('DOM多人变式与旧摘要回退均可操作，既不伪造底牌也不提前提示', () => {
  const browser = browserHarness();
  browser.sandbox.PokerReplay.start(move(context({ phase: 'flop', count: 8 })));
  assert.equal(browser.all('replay-select').length, 1);
  browser.all('replay-select')[0].change('half');
  assert.ok(browser.all('replay-pot')[0].textContent.includes('600'));
  browser.all('replay-call')[0].click();
  assert.equal(browser.all('replay-change')[0].textContent, '换个下注尺度再打');
  browser.sandbox.PokerReplay.start({ phase: '翻牌', own: 'A♠ Q♠', board: 'J♠ 8♠ 2♦', pot: 300, cost: 100, actual: '旧秘密选择', reference: '旧秘密提示' });
  assert.equal(browser.all('replay-raise').length, 0);
  assert.equal(browser.all('replay-select').length, 0);
  assert.ok(!browser.bodyText().includes('旧秘密'));
  browser.all('replay-fold')[0].click();
  assert.ok(browser.bodyText().includes('旧秘密选择'));
  assert.ok(browser.bodyText().includes('未重算'));
});

console.log(`\n全部 ${passed} 项历史重练测试通过；包含990组合对照、所有街、多人与单挑变式、旧摘要和DOM模拟交互。`);
