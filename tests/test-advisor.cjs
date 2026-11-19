'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const Advisor = require('../docs/advisor.js');
const Bot = require('../docs/bot-ai.js');
const Engine = require('../docs/engine.js');
const card = (rank, suit) => ({ rank, suit });
const styles = ['human', 'tag', 'lag', 'balanced', 'nit', 'trap', 'pressure', 'defend'];
const clone = value => JSON.parse(JSON.stringify(value));
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function context(overrides = {}) {
  return {
    playerIndex: 0,
    players: styles.map((style, i) => ({ name: '座位' + i, style, stack: 1000, bet: i === 1 ? 10 : i === 2 ? 20 : 0, contributed: i === 1 ? 10 : i === 2 ? 20 : 0, folded: false, out: false, lastAction: '' })),
    holeCards: [card(14, 's'), card(14, 'h')], board: [], pot: 30, currentBet: 20, minRaise: 20,
    legal: { canFold: true, canCheck: false, canCall: true, callAmount: 20, canRaise: true, minRaiseTo: 40, maxRaiseTo: 1000 },
    dealer: 0, phase: 'preflop', ...overrides
  };
}
function legal(advice, c) {
  assert.ok(advice);
  assert.ok(['fold', 'call', 'raise'].includes(advice.action));
  assert.ok(advice.equity >= 0 && advice.equity <= 1);
  assert.ok(advice.potOdds >= 0 && advice.potOdds <= 1);
  assert.ok(advice.equityLow <= advice.equity && advice.equityHigh >= advice.equity);
  assert.ok(advice.marginOfError > 0 && advice.marginOfError < .04);
  assert.ok(Math.abs(advice.callEV - (advice.equity * advice.contestablePot - c.legal.callAmount)) < 1e-8);
  assert.ok(Math.abs(advice.potOdds - c.legal.callAmount / Math.max(1, advice.contestablePot)) < 1e-8);
  if (c.legal.callAmount > 0 && advice.equityHigh < advice.potOdds && advice.decisionBasis !== '强起手开池策略') assert.equal(advice.action, 'fold');
  assert.ok(typeof advice.reason === 'string' && advice.reason.length <= 35);
  if (advice.action === 'raise') {
    assert.ok(c.legal.canRaise);
    assert.ok(Number.isInteger(advice.raiseTo) && advice.raiseTo >= c.legal.minRaiseTo && advice.raiseTo <= c.legal.maxRaiseTo);
    assert.ok(advice.raiseTo > c.currentBet);
    assert.ok(advice.raiseTo - c.currentBet >= c.minRaise || advice.raiseTo === c.legal.maxRaiseTo);
    assert.equal(advice.label, `${c.currentBet > 0 ? '加注至' : '下注'} ${advice.raiseTo}`);
  } else if (advice.action === 'fold') {
    assert.ok(c.legal.canFold && !c.legal.canCheck && c.legal.callAmount > 0);
    assert.equal(advice.label, '弃牌');
    assert.equal(advice.raiseTo, undefined);
  } else {
    assert.ok(c.legal.canCheck || c.legal.canCall);
    assert.equal(advice.label, c.legal.canCheck || c.legal.callAmount === 0 ? '过牌' : `${c.legal.callAmount >= c.players[0].stack ? '全下跟注' : '跟注'} ${c.legal.callAmount}`);
    assert.equal(advice.raiseTo, undefined);
  }
}
const tests = [];
function test(name, run) { run(); tests.push(name); }
function deepFreeze(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child); return Object.freeze(value); }

test('Browser global and CommonJS contract', () => {
  assert.equal(globalThis.PokerAdvisor, Advisor);
  const sandbox = {};
  Object.defineProperty(sandbox, 'document', { get() { throw new Error('DOM access is forbidden'); } });
  vm.runInNewContext(fs.readFileSync(require.resolve('../docs/advisor.js'), 'utf8'), sandbox);
  const advice = sandbox.PokerAdvisor.advise(context());
  assert.equal(JSON.stringify(advice), JSON.stringify(Advisor.advise(context())));
  assert.equal(advice.method, '随机模拟');
  assert.equal(advice.samples, 2048);
  legal(advice, context());
});

test('No action, off-turn, folded, eliminated or all-in human returns null', () => {
  assert.equal(Advisor.advise(null), null);
  assert.equal(Advisor.advise(context({ phase: 'idle', holeCards: [] })), null);
  assert.equal(Advisor.advise(context({ phase: 'complete' })), null);
  assert.equal(Advisor.advise(context({ playerIndex: 1 })), null);
  assert.equal(Advisor.advise(context({ legal: { canFold: false, canCheck: false, canCall: false, canRaise: false } })), null);
  for (const change of [{ folded: true }, { out: true }, { stack: 0 }]) {
    const c = context(); Object.assign(c.players[0], change);
    assert.equal(Advisor.advise(c), null);
  }
  assert.equal(Advisor.advise(context({ holeCards: [] })), null);
});

test('Deterministic public states, immutable input, and zero Math.random usage', () => {
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Advisor consumed global randomness'); };
  try {
    const boards = [[], [card(10, 's'), card(8, 'h'), card(2, 'd')], [card(10, 's'), card(8, 'h'), card(2, 'd'), card(4, 'c')], [card(10, 's'), card(8, 'h'), card(2, 'd'), card(4, 'c'), card(6, 'h')]];
    const phases = ['preflop', 'flop', 'turn', 'river'];
    for (let i = 0; i < boards.length; i++) {
      const c = context({ board: boards[i], phase: phases[i] });
      const before = JSON.stringify(c);
      const frozen = deepFreeze(c);
      const expected = Advisor.advise(frozen);
      legal(expected, c);
      for (let repeat = 0; repeat < 8; repeat++) assert.deepEqual(Advisor.advise(frozen), expected);
      const reordered = Object.fromEntries(Object.entries(clone(c)).reverse());
      reordered.holeCards.reverse();
      assert.deepEqual(Advisor.advise(reordered), expected);
      assert.equal(JSON.stringify(c), before);
      assert.equal(expected.method, '随机模拟'); assert.equal(expected.samples, 2048);
    }
  } finally { Math.random = originalRandom; }
});

test('Private fields and raw toJSON are never touched; changed secrets cannot change advice', () => {
  const c = context({ phase: 'flop', board: [card(10, 's'), card(8, 'h'), card(2, 'd')] });
  const expected = Advisor.advise(c);
  const poison = { enumerable: true, get() { throw new Error('Private field accessed'); } };
  for (const key of ['cards', 'deck', '_deck', 'state', 'engine', 'rng', 'toJSON', 'unrevealedBoard']) Object.defineProperty(c, key, poison);
  for (const p of c.players) for (const key of ['cards', 'holeCards', 'deck', 'private', 'toJSON']) Object.defineProperty(p, key, poison);
  for (const card of c.holeCards.concat(c.board)) Object.defineProperty(card, 'private', poison);
  assert.deepEqual(Advisor.advise(c), expected);
  const different = context({ phase: 'flop', board: [card(10, 's'), card(8, 'h'), card(2, 'd')] });
  different.deck = [card(14, 'd'), card(14, 'c')];
  different._deck = [card(2, 's')];
  different.players.forEach((p, i) => { p.cards = [card(2 + i, 'c'), card(3 + i, 'h')]; p.holeCards = [card(13, 'h'), card(12, 'h')]; });
  assert.deepEqual(Advisor.advise(different), expected);
});

test('Free check, expensive fold, call and all-in call labels', () => {
  const free = context({ holeCards: [card(7, 's'), card(2, 'h')],
    legal: { canFold: true, canCheck: true, canCall: false, callAmount: 0, canRaise: false, minRaiseTo: 40, maxRaiseTo: 1000 } });
  assert.equal(Advisor.advise(free).label, '过牌');
  const expensive = context({ holeCards: [card(7, 's'), card(2, 'h')], pot: 1200, currentBet: 900, minRaise: 880,
    legal: { canFold: true, canCheck: false, canCall: true, callAmount: 900, canRaise: false, minRaiseTo: 1000, maxRaiseTo: 1000 } });
  assert.equal(Advisor.advise(expensive).action, 'fold');
  const call = context(); call.legal.canRaise = false; call.players = call.players.slice(0, 2); call.players[1].bet = 30; call.players[1].contributed = 30;
  assert.equal(Advisor.advise(call).label, '跟注 20');
  call.players[0].stack = 20;
  assert.equal(Advisor.advise(call).label, '全下跟注 20');
  for (const c of [free, expensive, call]) legal(Advisor.advise(c), c);
});

test('Value raises use street totals, short all-in bound, and opening bet label', () => {
  const c = context({ phase: 'river', holeCards: [card(14, 's'), card(13, 's')],
    board: [card(12, 's'), card(11, 's'), card(10, 's'), card(2, 'h'), card(3, 'd')], pot: 500, currentBet: 100, minRaise: 80,
    legal: { canFold: true, canCheck: false, canCall: true, callAmount: 30, canRaise: true, minRaiseTo: 150, maxRaiseTo: 150 } });
  c.players[0].bet = 70; c.players[0].stack = 80;
  const advice = Advisor.advise(c);
  legal(advice, c);
  assert.equal(advice.equity, 1);
  assert.equal(advice.action, 'raise');
  assert.equal(advice.raiseTo, 150);
  assert.equal(advice.label, '加注至 150');
  c.currentBet = 0; c.minRaise = 20; c.players[0].bet = 0; c.players[0].stack = 1000;
  c.legal = { canFold: true, canCheck: true, canCall: false, callAmount: 0, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000 };
  const opening = Advisor.advise(c); legal(opening, c);
  assert.equal(opening.action, 'raise'); assert.match(opening.label, /^下注 /);
});

test('Only opponents all-in: no empty-side-pot raise and split equity is fractional', () => {
  const c = context({ phase: 'river', holeCards: [card(2, 'd'), card(3, 'c')],
    board: [card(14, 's'), card(13, 's'), card(12, 's'), card(11, 's'), card(10, 's')], pot: 700, currentBet: 100,
    legal: { canFold: true, canCheck: false, canCall: true, callAmount: 100, canRaise: false, minRaiseTo: 120, maxRaiseTo: 1000 } });
  c.players.slice(1).forEach(p => { p.stack = 0; p.bet = 100; p.lastAction = '全下'; });
  const advice = Advisor.advise(c); legal(advice, c);
  assert.notEqual(advice.action, 'raise'); assert.equal(advice.equity, 1 / 8);
  c.legal.callAmount = 0; c.legal.canCall = false; c.legal.canCheck = true;
  assert.equal(Advisor.advise(c).action, 'call');
});

test('Live engine integration: advice preserves state and RNG, actions legal', () => {
  let completed = 0, recommendations = 0, maxDuration = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const rng = seeded(seed * 1337); let randomCalls = 0;
    const game = new Engine({ rng: () => { randomCalls++; return rng(); }, botPolicy: Bot.chooseAction });
    for (let hand = 0; hand < 3; hand++) {
      if (game.state.players.filter(p => p.stack > 0).length < 2) break;
      game.startHand(); let actions = 0;
      while (game.state.phase !== 'complete') {
        assert.ok(actions++ < 300);
        if (game.state.actor === 0) {
          const s = game.state;
          const c = { playerIndex: 0,
            players: s.players.map(({ name, style, stack, bet, folded, out, lastAction }, index) => ({ name, style, stack, bet, folded, out, lastAction, contributed: game._contributions[index] })),
            holeCards: s.players[0].cards.map(({ rank, suit }) => ({ rank, suit })), board: s.board.map(({ rank, suit }) => ({ rank, suit })),
            pot: s.pot, currentBet: s.currentBet, minRaise: s.minRaise, legal: game.legalActions(0), dealer: s.dealer, phase: s.phase };
          const before = JSON.stringify(game.state), randomBefore = randomCalls, start = performance.now();
          const advice = Advisor.advise(c);
          maxDuration = Math.max(maxDuration, performance.now() - start);
          assert.equal(randomCalls, randomBefore); assert.equal(JSON.stringify(game.state), before);
          legal(advice, c); assert.equal(advice.potExact, true); recommendations++;
          game.act(0, advice.action, advice.raiseTo);
        } else game.botAction();
      }
      assert.equal(game.state.players.reduce((sum, p) => sum + p.stack, 0), 8000); completed++;
    }
  }
  assert.ok(completed >= 25 && recommendations >= 25);
  assert.ok(maxDuration < 500);
  console.log(`Integration: ${completed} complete hands, ${recommendations} legal human recommendations; max ${maxDuration.toFixed(1)} ms`);
});

test('Fast exact evaluator agrees with reference engine on 3000 hands and boundaries', () => {
  const rng = seeded(1123), suits = ['s', 'h', 'd', 'c'];
  const packReference = cards => {
    const score = Engine.evaluate(cards).score;
    let value = 0; for (let i = 0; i < 6; i++) value = value * 15 + (score[i] || 0);
    return value;
  };
  const fixtures = [
    [card(14,'s'),card(5,'s'),card(4,'s'),card(3,'s'),card(2,'s'),card(13,'h'),card(12,'d')],
    [card(14,'s'),card(14,'h'),card(14,'d'),card(13,'s'),card(13,'h'),card(13,'d'),card(2,'c')],
    [card(14,'s'),card(14,'h'),card(13,'s'),card(13,'h'),card(12,'s'),card(12,'h'),card(2,'c')],
    [card(14,'s'),card(12,'s'),card(10,'s'),card(8,'s'),card(6,'s'),card(4,'s'),card(2,'s')]
  ];
  for (const cards of fixtures) assert.equal(Advisor.evaluate(cards), packReference(cards));
  for (let i = 0; i < 3000; i++) {
    const deck = Array.from({length:52}, (_, k) => card(k % 13 + 2, suits[Math.floor(k / 13)]));
    const cards = []; for (let k = 0; k < 5 + i % 3; k++) cards.push(deck.splice(Math.floor(rng() * deck.length), 1)[0]);
    assert.equal(Advisor.evaluate(cards), packReference(cards));
  }
});

test('Preflop is sampled: AA vs 72, heads-up versus seven opponents, bounded error', () => {
  const aa = context(), weak = context({ holeCards: [card(7,'s'), card(2,'h')] });
  const a = Advisor.advise(aa), b = Advisor.advise(weak);
  assert.ok(a.equity > .30 && a.equity < .46, `AA eight-handed equity ${a.equity}`);
  assert.ok(b.equity > .03 && b.equity < .16, `72 eight-handed equity ${b.equity}`);
  assert.ok(a.equity > b.equity + .20);
  aa.players = aa.players.slice(0, 2);
  aa.players[1].contributed = aa.players[1].bet = 30;
  const headsUp = Advisor.advise(aa);
  assert.ok(headsUp.equity > .80 && headsUp.equity < .91, `AA heads-up equity ${headsUp.equity}`);
  assert.equal(a.samples, 2048); assert.equal(a.method, '随机模拟');
  assert.equal(a.confidenceLevel, .95);
  assert.ok(Math.abs(a.marginOfError - Math.sqrt(Math.log(40) / 4096)) < 1e-12);
  console.log(`Preflop equities: AA/7 rivals ${(a.equity*100).toFixed(1)}%, 72/7 rivals ${(b.equity*100).toFixed(1)}%, AA/1 rival ${(headsUp.equity*100).toFixed(1)}%`);
});

test('Regression: 25% equity below 38% price cannot be described as affordable', () => {
  const c = context({ phase: 'river', holeCards: [card(2,'h'),card(3,'d')],
    board: [card(14,'s'),card(13,'s'),card(12,'s'),card(11,'s'),card(10,'s')], pot: 160, currentBet: 100,
    legal: { canFold:true,canCall:true,canCheck:false,callAmount:100,canRaise:false,minRaiseTo:200,maxRaiseTo:1000 } });
  c.players = c.players.slice(0,4); c.players.forEach(p => { p.contributed = null; });
  const advice = Advisor.advise(c); legal(advice,c);
  assert.equal(advice.equity,.25); assert.equal(advice.potOdds,100/260); assert.equal(advice.action,'fold');
  assert.match(advice.reason,/低于/); assert.doesNotMatch(advice.reason,/可接受|高于成本/);
  assert.ok(advice.callEV < 0);
});

test('Short stack eligible pots, weighted side-pot ties, and missing-accounting disclosure', () => {
  const board = [card(14,'s'),card(13,'s'),card(12,'s'),card(11,'s'),card(10,'s')];
  const short = context({ phase:'river',holeCards:[card(2,'h'),card(3,'d')],board,pot:2100,currentBet:1000,
    legal:{canFold:true,canCheck:false,canCall:true,callAmount:100,canRaise:false,minRaiseTo:200,maxRaiseTo:200} });
  short.players = short.players.slice(0,3);
  Object.assign(short.players[0],{stack:100,bet:100,contributed:100});
  short.players.slice(1).forEach(p=>Object.assign(p,{stack:0,bet:1000,contributed:1000}));
  const a = Advisor.advise(short); legal(a,short);
  assert.equal(a.effectivePot,500);assert.equal(a.contestablePot,600);assert.equal(a.excludedPot,1600);
  assert.equal(a.potOdds,1/6);assert.ok(Math.abs(a.equity-1/3)<1e-12);assert.equal(a.potExact,true);
  assert.equal(a.allInDecision,true);assert.equal(a.futureBetting,false);
  const covered = clone(short); covered.pot=1000;covered.currentBet=500;
  Object.assign(covered.players[0],{stack:1000,bet:400,contributed:400});
  Object.assign(covered.players[1],{stack:0,bet:100,contributed:100});
  Object.assign(covered.players[2],{stack:0,bet:500,contributed:500});
  covered.legal.maxRaiseTo=1400;covered.legal.minRaiseTo=600;
  const b=Advisor.advise(covered);legal(b,covered);
  assert.equal(b.contestablePot,1100);assert.ok(Math.abs(b.equity-500/1100)<1e-12);
  assert.ok(Math.abs(b.callEV-400)<1e-8);
  const missing=clone(short);delete missing.players[0].contributed;
  const fallback=Advisor.advise(missing);assert.equal(fallback.potExact,false);assert.match(fallback.caution,/累计投入/);
});

test('Near-threshold uncertainty is explicit; all-in and future rounds are distinguished', () => {
  const c=context({phase:'river',holeCards:[card(2,'h'),card(3,'d')],
    board:[card(14,'s'),card(13,'s'),card(12,'s'),card(11,'s'),card(10,'s')],pot:300,currentBet:100,
    legal:{canFold:true,canCheck:false,canCall:true,callAmount:100,canRaise:false,minRaiseTo:200,maxRaiseTo:1000}});
  c.players=c.players.slice(0,4);c.players.forEach((p,i)=>Object.assign(p,{contributed:i?100:0,bet:i?100:0,stack:i?0:1000}));
  const advice=Advisor.advise(c);assert.equal(advice.equity,.25);assert.equal(advice.potOdds,.25);assert.equal(advice.uncertain,true);
  assert.match(advice.reason,/误差|接近/);assert.equal(advice.allInDecision,true);
  assert.equal(Advisor.advise(context()).futureBetting,true);
});

test('AA/KK open for value; limp isolation differs from static call math; re-raises stay bounded', () => {
  for (const rank of [14,13]) {
    const c=context({holeCards:[card(rank,'s'),card(rank,'h')]});
    const advice=Advisor.advise(c);legal(advice,c);
    assert.equal(advice.action,'raise');assert.equal(advice.raiseTo,60);assert.equal(advice.decisionBasis,'强起手开池策略');
    assert.match(advice.reason,/跟注收益不代表加注收益/);assert.match(advice.raiseAssumption,/弃牌率/);
    c.players[3].bet=20;c.players[3].contributed=20;c.players[3].lastAction='跟注 20';c.pot+=20;
    const isolation=Advisor.advise(c);legal(isolation,c);assert.equal(isolation.action,'raise');assert.equal(isolation.raiseTo,80);
    c.currentBet=500;c.minRaise=300;c.pot=1150;c.legal={canFold:true,canCheck:false,canCall:true,callAmount:500,canRaise:true,minRaiseTo:800,maxRaiseTo:1000};
    c.players[1].bet=500;c.players[1].contributed=500;c.players[1].lastAction='加注至 500';
    c.players[2].bet=500;c.players[2].contributed=500;c.players[2].lastAction='加注至 500';
    c.players[3].bet=150;c.players[3].contributed=150;
    const pressure=Advisor.advise(c);legal(pressure,c);assert.notEqual(pressure.decisionBasis,'强起手开池策略');
  }
  const weak=context({holeCards:[card(7,'s'),card(2,'h')]});
  assert.notEqual(Advisor.advise(weak).decisionBasis,'强起手开池策略');
});

test('Free public boards never fold; shared river nuts split from two through eight players', () => {
  const shared=[card(14,'s'),card(13,'s'),card(12,'s'),card(11,'s'),card(10,'s')];
  for(let players=2;players<=8;players++) {
    const c=context({phase:'river',holeCards:[card(2,'h'),card(3,'d')],board:shared,pot:players*100,currentBet:0,
      legal:{canFold:true,canCheck:true,canCall:false,callAmount:0,canRaise:false,minRaiseTo:20,maxRaiseTo:1000}});
    c.players=c.players.slice(0,players);c.players.forEach(p=>{p.bet=0;p.contributed=100;});
    const advice=Advisor.advise(c);legal(advice,c);assert.equal(advice.action,'call');assert.ok(Math.abs(advice.equity-1/players)<1e-12);
  }
  for(const [phase,board] of [['flop',[card(14,'s'),card(12,'h'),card(9,'c')]],['turn',[card(14,'s'),card(12,'h'),card(9,'c'),card(6,'d')]]]) {
    const c=context({phase,board,holeCards:[card(3,'s'),card(2,'h')],currentBet:0,
      legal:{canFold:true,canCheck:true,canCall:false,callAmount:0,canRaise:true,minRaiseTo:20,maxRaiseTo:1000}});
    const advice=Advisor.advise(c);legal(advice,c);assert.notEqual(advice.action,'fold');
  }
});

console.log(`PASS: ${tests.length} advisor suites — ${tests.join('; ')}`);
