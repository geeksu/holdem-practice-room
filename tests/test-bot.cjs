'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const Bot = require('../docs/bot-ai.js');
const Engine = require('../docs/engine.js');
const fs = require('node:fs');
const vm = require('node:vm');
const card = (rank, suit) => ({ rank, suit });
const seeded = seed => () => {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
};
function context(style = 'balanced', extra = {}) {
  return {
    playerIndex: 1, dealer: 1, phase: 'preflop',
    players: [
      { name: '你', style: 'human', stack: 1000, bet: 0, folded: false, out: false, lastAction: '' },
      { name: '电脑', style, stack: 1000, bet: 0, folded: false, out: false, lastAction: '' },
      { name: '电脑二', style: 'tag', stack: 990, bet: 10, folded: false, out: false, lastAction: '' },
      { name: '电脑三', style: 'lag', stack: 980, bet: 20, folded: false, out: false, lastAction: '' },
      { name: '狙击', style: 'nit', stack: 1000, bet: 0, folded: false, out: false, lastAction: '' },
      { name: '暗影', style: 'trap', stack: 1000, bet: 0, folded: false, out: false, lastAction: '' },
      { name: '疾风', style: 'pressure', stack: 1000, bet: 0, folded: false, out: false, lastAction: '' },
      { name: '铁壁', style: 'defend', stack: 1000, bet: 0, folded: false, out: false, lastAction: '' }
    ],
    holeCards: [card(14, 's'), card(13, 's')], board: [], pot: 30, currentBet: 20, minRaise: 20,
    legal: { canFold: true, canCheck: false, canCall: true, callAmount: 20, canRaise: true, minRaiseTo: 40, maxRaiseTo: 1000 },
    ...extra
  };
}
function legal(action, c) {
  assert.ok(['call', 'raise', 'fold'].includes(action.action));
  if (action.action === 'raise') {
    assert.ok(c.legal.canRaise);
    assert.ok(Number.isInteger(action.raiseTo));
    assert.ok(action.raiseTo >= c.legal.minRaiseTo);
    assert.ok(action.raiseTo <= c.legal.maxRaiseTo);
    assert.ok(action.raiseTo > c.currentBet);
  } else if (action.action === 'fold') {
    assert.ok(c.legal.canFold);
    assert.ok(c.legal.callAmount > 0, 'Never fold a free check.');
  } else assert.ok(c.legal.canCall || c.legal.canCheck);
}
const tests = [];
function test(name, run) { run(); tests.push(name); }

test('CommonJS and plain-script globals', () => {
  assert.equal(globalThis.PokerBot, Bot);
  const sandbox = { PokerEngine: Engine };
  vm.runInNewContext(fs.readFileSync(require.resolve('../docs/bot-ai.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.PokerBot.chooseAction, 'function');
  assert.equal(sandbox.PokerBot.chooseAction(context(), seeded(3)).action, Bot.chooseAction(context(), seeded(3)).action);
});

test('Preflop hand ordering and distinct style frequencies', () => {
  assert.ok(Bot.startingStrength([card(14, 's'), card(14, 'h')]) > Bot.startingStrength([card(14, 's'), card(13, 's')]));
  assert.ok(Bot.startingStrength([card(9, 's'), card(8, 's')]) > Bot.startingStrength([card(9, 's'), card(8, 'h')]));
  const counts = {};
  for (const style of Object.keys(Bot.profiles)) {
    counts[style] = { raise: 0, call: 0, fold: 0 };
    for (let seed = 1; seed <= 180; seed++) {
      const c = context(style, { holeCards: [card(9, 's'), card(8, 's')] });
      const action = Bot.chooseAction(c, seeded(seed * 7919));
      legal(action, c);
      counts[style][action.action]++;
    }
  }
  assert.ok(counts.lag.raise > counts.balanced.raise, JSON.stringify(counts));
  assert.ok(counts.balanced.raise > counts.tag.raise, JSON.stringify(counts));
  const rangeCounts = {};
  for (const style of Object.keys(Bot.profiles)) {
    rangeCounts[style] = 0;
    for (let high = 4; high <= 13; high++) {
      for (let low = 2; low < high; low++) {
        const c = context(style, { holeCards: [card(high, 's'), card(low, 's')] });
        if (Bot.chooseAction(c, () => .3).action === 'raise') rangeCounts[style]++;
      }
    }
  }
  assert.ok(rangeCounts.lag > rangeCounts.balanced && rangeCounts.balanced > rangeCounts.tag, JSON.stringify(rangeCounts));
  console.log('Style frequencies with 98s on button:', counts);
  console.log('Distinct suited-hand opening ranges:', rangeCounts);
});

test('Strong preflop hands get value; expensive weak hands fold', () => {
  for (const style of Object.keys(Bot.profiles)) {
    const premium = Bot.chooseAction(context(style, { holeCards: [card(14, 's'), card(14, 'h')] }), seeded(7)).action;
    if (style === 'trap') assert.ok(['call', 'raise'].includes(premium));
    else assert.equal(premium, 'raise');
    const c = context(style, { holeCards: [card(7, 's'), card(2, 'h')], pot: 1200, currentBet: 900, minRaise: 880,
      legal: { canFold: true, canCall: true, canCheck: false, callAmount: 900, canRaise: false, minRaiseTo: 1000, maxRaiseTo: 1000 } });
    assert.equal(Bot.chooseAction(c, seeded(19)).action, 'fold');
  }
});

test('Legal bounds, short all-in raises, no-raise rights, and free checks', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const style = Object.keys(Bot.profiles)[seed % Object.keys(Bot.profiles).length];
    const c = context(style, { holeCards: seed % 2 ? [card(14, 's'), card(14, 'h')] : [card(7, 's'), card(2, 'h')] });
    if (seed % 3 === 0) c.legal.canRaise = false;
    if (seed % 5 === 0) { c.legal.minRaiseTo = 27; c.legal.maxRaiseTo = 27; c.players[1].stack = 27; }
    if (seed % 7 === 0) { c.legal.callAmount = 0; c.legal.canCall = false; c.legal.canCheck = true; c.players[1].bet = 20; }
    legal(Bot.chooseAction(c, seeded(seed)), c);
  }
});

test('Monte Carlo values nuts and accounts for multiway ties', () => {
  const nuts = context('tag', { phase: 'river', holeCards: [card(14, 's'), card(13, 's')],
    board: [card(12, 's'), card(11, 's'), card(10, 's'), card(2, 'h'), card(3, 'd')], pot: 300, currentBet: 40,
    legal: { canFold: true, canCall: true, canCheck: false, callAmount: 40, canRaise: true, minRaiseTo: 60, maxRaiseTo: 1000 } });
  const report = Bot.explain(nuts, seeded(13));
  assert.equal(report.estimate.equity, 1);
  assert.equal(report.decision.action, 'raise');
  legal(report.decision, nuts);
  const shared = context('lag', { phase: 'river', holeCards: [card(2, 'd'), card(3, 'c')],
    board: [card(14, 's'), card(13, 's'), card(12, 's'), card(11, 's'), card(10, 's')],
    legal: { canFold: true, canCall: false, canCheck: true, callAmount: 0, canRaise: false, minRaiseTo: 40, maxRaiseTo: 1000 } });
  const estimate = Bot.estimate(shared, seeded(11));
  assert.equal(estimate.equity, .125);
  assert.equal(estimate.tieRate, 1);
  assert.equal(estimate.opponents, 7);
  assert.equal(Bot.chooseAction(shared, seeded(11)).action, 'call');
});

test('Weak expensive river folds; free weak river checks', () => {
  for (const style of Object.keys(Bot.profiles)) {
    const c = context(style, { phase: 'river', holeCards: [card(3, 's'), card(2, 'h')],
      board: [card(14, 'c'), card(13, 'c'), card(12, 'c'), card(9, 'd'), card(8, 'h')], pot: 1100, currentBet: 900, minRaise: 900,
      legal: { canFold: true, canCall: true, canCheck: false, callAmount: 900, canRaise: false, minRaiseTo: 1000, maxRaiseTo: 1000 } });
    assert.equal(Bot.chooseAction(c, seeded(77)).action, 'fold');
    c.legal.callAmount = 0; c.legal.canCall = false; c.legal.canCheck = true;
    assert.equal(Bot.chooseAction(c, seeded(77)).action, 'call');
  }
});

test('Never reads private fields and leaves input unchanged', () => {
  const c = context('balanced', { phase: 'flop', board: [card(10, 's'), card(8, 'h'), card(2, 'd')] });
  const before = JSON.stringify(c);
  const deny = { get() { throw new Error('Private field was read'); }, enumerable: true };
  for (const p of c.players) {
    Object.defineProperty(p, 'cards', deny);
    Object.defineProperty(p, 'holeCards', deny);
    Object.freeze(p);
  }
  Object.defineProperty(c, 'deck', deny);
  Object.defineProperty(c, '_deck', deny);
  Object.freeze(c.players); Object.freeze(c.holeCards); Object.freeze(c.board); Object.freeze(c.legal); Object.freeze(c);
  const action = Bot.chooseAction(c, seeded(77));
  legal(action, c);
  const visible = {
    playerIndex: c.playerIndex, dealer: c.dealer, phase: c.phase,
    players: c.players.map(p => ({ name: p.name, style: p.style, stack: p.stack, bet: p.bet, folded: p.folded, out: p.out, lastAction: p.lastAction })),
    holeCards: c.holeCards, board: c.board, pot: c.pot, currentBet: c.currentBet, minRaise: c.minRaise, legal: c.legal
  };
  assert.equal(JSON.stringify(visible), before);
});

test('Sampling bounds, deterministic seeds, and performance budget', () => {
  const c = context('balanced', { phase: 'turn', board: [card(10, 's'), card(8, 'h'), card(2, 'd'), card(4, 'c')] });
  c.players.forEach((p, i) => { if (i !== c.playerIndex) { p.lastAction = 'raise'; p.bet = 60; } });
  assert.equal(Bot.estimate(c, seeded(90), { samples: 2 }).samples, 40);
  assert.equal(Bot.estimate(c, seeded(90), { samples: 200 }).samples, 80);
  assert.deepEqual(Bot.explain(c, seeded(91)), Bot.explain(c, seeded(91)));
  const durations = [];
  for (let seed = 0; seed < 10; seed++) {
    const start = performance.now();
    legal(Bot.chooseAction(c, seeded(100 + seed)), c);
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const average = durations.reduce((a, b) => a + b, 0) / durations.length;
  console.log(`Seven-opponent Monte Carlo timing: mean ${average.toFixed(1)} ms, max ${durations[durations.length - 1].toFixed(1)} ms`);
  assert.ok(durations[durations.length - 1] < 250, 'Unexpectedly slow local Monte Carlo');
});

test('Engine integration: complete hands, legal decisions, conserved chips', () => {
  let completed = 0, decisions = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const rng = seeded(seed * 101);
    const game = new Engine({ startingStack: 1000, rng, botPolicy: (c, r) => {
      const action = Bot.chooseAction(c, r);
      legal(action, c); decisions++;
      return action;
    } });
    assert.equal(game.state.players.length, 8, 'Final integration requires the new eight-seat engine');
    assert.deepEqual(game.state.players.slice(1).map(p => p.style), Object.keys(Bot.profiles));
    for (let hand = 0; hand < 5; hand++) {
      if (game.state.players.filter(p => p.stack > 0).length < 2) break;
      game.startHand();
      let actions = 0;
      while (game.state.phase !== 'complete') {
        assert.ok(++actions < 250, 'Game failed to complete a hand');
        const actor = game.state.actor;
        if (actor === 0) {
          const l = game.legalActions(actor);
          if (l.canRaise && rng() < .15) game.act(actor, 'raise', l.minRaiseTo);
          else if (l.canCall && rng() < .15) game.act(actor, 'fold');
          else game.act(actor, 'call');
        } else game.botAction();
      }
      assert.equal(game.state.players.reduce((sum, p) => sum + p.stack, 0), 8000);
      completed++;
    }
  }
  assert.ok(completed >= 80, 'Insufficient complete-hand coverage');
  assert.ok(decisions >= 300);
  console.log(`Engine integration: ${completed} complete hands, ${decisions} validated bot decisions`);
});

test('Seven distinct profiles: nit range, trap slowplay, position pressure, and defense', () => {
  const styles = Object.keys(Bot.profiles);
  assert.deepEqual(styles, ['tag', 'lag', 'balanced', 'nit', 'trap', 'pressure', 'defend']);
  assert.equal(new Set(styles.map(style => {
    const p = Bot.profiles[style];
    return [p.open, p.defense, p.value, p.aggression, p.bluff, p.size, p.positionBonus, p.slowPlay, p.rangeTightness].join(',');
  })).size, 7);
  assert.ok(Bot.profiles.nit.open > Math.max(...styles.filter(s => s !== 'nit').map(s => Bot.profiles[s].open)));
  assert.ok(Bot.profiles.pressure.positionBonus > Bot.profiles.tag.positionBonus * 2);
  const marginal = { holeCards: [card(8, 's'), card(7, 's')] };
  assert.equal(Bot.chooseAction(context('tag', marginal), () => .5).action, 'fold');
  assert.equal(Bot.chooseAction(context('nit', marginal), () => .5).action, 'fold');
  assert.equal(Bot.chooseAction(context('defend', marginal), () => .5).action, 'call');
  const button = context('pressure', { holeCards: [card(9, 's'), card(8, 's')] });
  const early = context('pressure', { dealer: 0, holeCards: [card(9, 's'), card(8, 's')] });
  assert.equal(Bot.chooseAction(button, () => .5).action, 'raise');
  assert.notEqual(Bot.chooseAction(early, () => .5).action, 'raise');
  let calls = 0, raises = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const c = context('trap', { phase: 'turn', holeCards: [card(14, 's'), card(14, 'h')],
      board: [card(14, 'd'), card(14, 'c'), card(2, 's'), card(3, 'h')], pot: 300, currentBet: 0,
      legal: { canFold: true, canCall: false, canCheck: true, callAmount: 0, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000 } });
    const action = Bot.chooseAction(c, seeded(seed * 31));
    legal(action, c);
    if (action.action === 'call') calls++;
    if (action.action === 'raise') raises++;
  }
  assert.ok(calls >= 5 && raises >= 5, `Trap should mix slowplay and value: ${calls}/${raises}`);
  console.log(`Trap safe-board nuts: ${calls} slowplays / ${raises} value raises`);
});

console.log(`PASS: ${tests.length} bot suites — ${tests.join('; ')}`);
