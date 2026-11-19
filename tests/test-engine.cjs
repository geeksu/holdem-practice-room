'use strict';
const assert = require('node:assert/strict');
const PokerEngine = require('../docs/engine.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log(`✓ ${name}`); }
function cards(text) {
  return text.split(' ').map(text => ({ rank: ({ T: 10, J: 11, Q: 12, K: 13, A: 14 })[text[0]] || Number(text[0]), suit: text[1] }));
}
function rng(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function game(stacks = [1000, 1000, 1000, 1000], seed = 42, extra = {}) {
  const g = new PokerEngine({ playerCount: stacks.length, rng: rng(seed), ...extra });
  g.state.players.forEach((p, i) => { p.stack = stacks[i]; });
  g.startHand();
  return g;
}
function rig(g, holeTexts, boardText) {
  assert.equal(g.state.phase, 'preflop');
  holeTexts.forEach((text, i) => { g.state.players[i].cards = cards(text); });
  const board = cards(boardText);
  const used = new Set([...board, ...g.state.players.flatMap(p => p.cards)].map(c => `${c.rank}${c.suit}`));
  const rest = ['s', 'h', 'd', 'c'].flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit }))).filter(c => !used.has(`${c.rank}${c.suit}`));
  const burns = rest.splice(0, 3);
  const popOrder = [burns[0], ...board.slice(0, 3), burns[1], board[3], burns[2], board[4]];
  g._deck = [...rest, ...popOrder.reverse()];
}
function checkDown(g) {
  let actions = 0;
  while (g.state.phase !== 'complete') {
    assert.ok(++actions < 100);
    g.act(g.state.actor, 'call');
  }
}
function toFlop(g) {
  let actions = 0;
  while (g.state.phase === 'preflop') {
    assert.ok(++actions < 30);
    g.act(g.state.actor, 'call');
  }
  assert.equal(g.state.phase, 'flop');
}
function assertConserved(g, total) {
  const s = g.state;
  assert.equal(s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot, total);
  for (const p of s.players) {
    assert.ok(Number.isInteger(p.stack) && p.stack >= 0);
    assert.ok(Number.isInteger(p.bet) && p.bet >= 0);
    if (p.out) { assert.equal(p.stack, 0); assert.equal(p.cards.length, 0); }
  }
  const visible = [...s.board, ...s.players.flatMap(p => p.cards)].map(c => `${c.rank}${c.suit}`);
  assert.equal(new Set(visible).size, visible.length);
  if (s.phase === 'complete') {
    assert.equal(s.actor, null);
    assert.equal(s.pot, 0);
    assert.equal(s.result.payouts.reduce((a, b) => a + b, 0), s.result.pots.reduce((a, p) => a + p.amount, 0));
    for (const pot of s.result.pots) for (const winner of pot.winners) {
      assert.ok(pot.eligible.includes(winner));
      assert.equal(s.players[winner].folded, false);
      assert.equal(s.players[winner].out, false);
    }
  } else {
    assert.ok(Number.isInteger(s.actor));
    assert.equal(s.players[s.actor].folded, false);
    assert.equal(s.players[s.actor].out, false);
    assert.ok(s.players[s.actor].stack > 0);
    const legal = g.legalActions(s.actor);
    assert.ok(legal.canCheck || legal.canCall);
  }
}

test('显式四人身份、初始筹码与公开状态回归兼容', () => {
  const g = new PokerEngine({ playerCount: 4 });
  assert.deepEqual(g.state.players.map(p => p.name), ['你', '磐石', '烈焰', '千面']);
  assert.deepEqual(g.state.players.map(p => p.style), ['human', 'tag', 'lag', 'balanced']);
  assert.deepEqual(g.state.players.map(p => p.stack), [1000, 1000, 1000, 1000]);
  assert.throws(() => new PokerEngine({ playerCount: 9 }));
  assert.throws(() => new PokerEngine({ startingStack: 1.5 }));
});

test('牌型回归：A低顺、双三条葫芦、踢脚牌、皇家同花顺', () => {
  const ev = text => PokerEngine.evaluate(cards(text));
  assert.deepEqual(ev('As 2d 3c 4h 5s Kd Qc').score, [4, 5]);
  assert.deepEqual(ev('As Ad Ac Kh Kd Kc 2s').score, [6, 14, 13]);
  assert.equal(PokerEngine.compare(ev('As Ad Kh Qc 9h 7s 2c'), ev('Ah Ac Ks Qd 8h 7c 2s')), 1);
  assert.equal(PokerEngine.compare(ev('2h 3d As Ks Qs Js Ts'), ev('Ah Ac As Ks Qs Js Ts')), 0);
});

test('四人翻牌前大盲左侧先行动，翻牌后庄家左侧先行动', () => {
  const g = game();
  assert.equal(g.state.dealer, 0);
  assert.equal(g.state.smallBlindSeat, 1);
  assert.equal(g.state.bigBlindSeat, 2);
  assert.equal(g.state.actor, 3);
  assert.deepEqual(g.state.players.map(p => p.bet), [0, 10, 20, 0]);
  for (const seat of [3, 0, 1]) { assert.equal(g.state.actor, seat); g.act(seat, 'call'); }
  assert.equal(g.state.actor, 2);
  assert.equal(g.legalActions(2).canCheck, true);
  assert.equal(g.legalActions(2).canRaise, true);
  g.act(2, 'call');
  assert.equal(g.state.phase, 'flop');
  assert.equal(g.state.actor, 1);
  assert.equal(g.state.pot, 80);
});

test('多人主池和两层边池分别由不同玩家获胜', () => {
  const g = game([100, 200, 300, 1000]);
  rig(g, ['As Ah', 'Ks Kh', 'Qs Qh', 'Ts Th'], '2c 3d 7h 9s Jc');
  g.act(3, 'raise', 300);
  g.act(0, 'call'); g.act(1, 'call');
  assert.equal(g.state.players[0].out, false); // An all-in is still a live hand.
  g.act(2, 'call');
  assert.equal(g.state.phase, 'complete');
  assert.deepEqual(g.state.result.payouts, [400, 300, 200, 0]);
  assert.deepEqual(g.state.result.winners, [0, 1, 2]);
  assert.equal(g.state.result.winner, null);
  assert.deepEqual(g.state.result.pots, [
    { amount: 400, eligible: [0, 1, 2, 3], winners: [0] },
    { amount: 300, eligible: [1, 2, 3], winners: [1] },
    { amount: 200, eligible: [2, 3], winners: [2] },
  ]);
  assertConserved(g, 1600);
});

test('弃牌死钱保留在各级底池，弃牌者不能赢，退款不计入payouts', () => {
  const g = game([100, 1000, 1000, 1000]);
  rig(g, ['As Ah', 'Ks Kh', 'Qs Qh', 'Ts Th'], '2c 3d 7h 9s Jc');
  g.act(3, 'raise', 100); g.act(0, 'call'); g.act(1, 'call'); g.act(2, 'call');
  g.act(1, 'raise', 100); g.act(2, 'call'); g.act(3, 'fold');
  g.act(1, 'raise', 100); g.act(2, 'fold');
  assert.deepEqual(g.state.result.pots, [
    { amount: 400, eligible: [0, 1], winners: [0] },
    { amount: 200, eligible: [1], winners: [1] },
  ]);
  assert.deepEqual(g.state.result.payouts, [400, 200, 0, 0]);
  assert.ok(g.state.log.includes('磐石收回无人跟注的 100 筹码。'));
  assert.deepEqual(g.state.result.handNames, ['一对', '一对', null, null]);
  assert.deepEqual(g.state.players.map(p => p.stack), [400, 1000, 800, 900]);
  assertConserved(g, 3100);
});

test('同牌力三人分池，余数按庄家左侧座位顺序派发', () => {
  const g = game([41, 41, 41, 41]);
  rig(g, ['Ah Kd', 'Ad Qd', 'Ac Jd', 'Kh Qh'], '2c 3d 4h 5s 9c');
  g.act(3, 'raise', 41); g.act(0, 'call'); g.act(1, 'call'); g.act(2, 'call');
  assert.deepEqual(g.state.result.payouts, [54, 55, 55, 0]);
  assert.deepEqual(g.state.result.pots[0].winners, [0, 1, 2]);
  assertConserved(g, 164);
});

test('弃牌者投入档位不独立生成边池，相同资格层合并', () => {
  const g = game([100, 1000, 200, 300]);
  rig(g, ['As Ah', 'Ks Kh', 'Qs Qh', 'Ts Th'], '2c 3d 7h 9s Jc');
  g.act(3, 'raise', 100); g.act(0, 'call'); g.act(1, 'fold'); g.act(2, 'call');
  g.act(2, 'raise', 100); g.act(3, 'call');
  assert.deepEqual(g.state.result.pots, [
    { amount: 310, eligible: [0, 2, 3], winners: [0] },
    { amount: 200, eligible: [2, 3], winners: [2] },
  ]);
  assert.deepEqual(g.state.result.payouts, [310, 0, 200, 0]);
  assertConserved(g, 1600);
});

test('奇数底池两人平分，多的一筹码归庄家左侧获胜者', () => {
  const g = game([21, 21, 21]);
  rig(g, ['As Kd', 'Ah Qd', 'Kh Qh'], '2c 3d 4h 5s 9c');
  toFlop(g);
  g.act(1, 'raise', 1); g.act(2, 'call'); g.act(0, 'call');
  assert.equal(g.state.result.pots[0].amount, 63);
  assert.deepEqual(g.state.result.payouts, [31, 32, 0]);
  assertConserved(g, 63);
});

test('最高孤立下注退回，其他层按实际匹配筹码结算', () => {
  const g = game([1000, 200, 300, 100]);
  rig(g, ['As Ah', 'Ks Kh', 'Qs Qh', 'Ts Th'], '2c 3d 7h 9s Jc');
  g.act(3, 'call'); g.act(0, 'raise', 1000);
  g.act(1, 'call'); g.act(2, 'call'); g.act(3, 'call');
  assert.ok(g.state.log.includes('你收回无人跟注的 700 筹码。'));
  assert.deepEqual(g.state.result.pots.map(p => p.amount), [400, 300, 200]);
  assert.deepEqual(g.state.result.payouts, [900, 0, 0, 0]);
  assert.equal(g.state.players[0].stack, 1600);
  assertConserved(g, 1600);
});

test('多人短大盲仍面对完整20；只剩全下对手时不空打', () => {
  const g = game([1000, 1000, 5, 1000]);
  assert.equal(g.state.currentBet, 20);
  assert.equal(g.legalActions(3).callAmount, 20);
  assert.equal(g.legalActions(3).minRaiseTo, 40);
  g.act(3, 'fold'); g.act(0, 'fold');
  assert.equal(g.state.phase, 'complete');
  assert.equal(g.state.board.length, 5);
  assert.ok(g.state.log.includes('磐石收回无人跟注的 5 筹码。'));
  assert.equal(g.state.result.pots[0].amount, 10);
  assertConserved(g, 3005);
  const h = game([1000, 15]);
  assert.equal(h.legalActions(0).callAmount, 5);
  assert.equal(h.legalActions(0).canRaise, false);
  h.act(0, 'call');
  assertConserved(h, 1015);
});

test('单次短全下不重开，累计短全下达到完整增量可重开', () => {
  const g = game([70, 1000, 80, 1000]);
  g.act(3, 'raise', 40); // Full raise by 20.
  g.act(0, 'raise', 70); // Full raise by 30. This fixture is separate below.
  assert.equal(g.state.minRaise, 30);
  const h = game([50, 1000, 60, 1000]);
  h.act(3, 'raise', 40); // Seat 3 last decided at 40, last full raise = 20.
  h.act(0, 'raise', 50); // +10 short all-in.
  h.act(1, 'call');      // Seat 1 last decided at 50.
  h.act(2, 'raise', 60); // Another +10 short all-in.
  assert.equal(h.state.actor, 3);
  assert.equal(h.state.minRaise, 20);
  assert.equal(h.legalActions(3).canRaise, true); // Faces 20 cumulatively.
  assert.equal(h.legalActions(3).minRaiseTo, 80);
  h.act(3, 'call');
  assert.equal(h.state.actor, 1);
  assert.equal(h.legalActions(1).canRaise, false); // Faces only 10 since own call.
  assert.throws(() => h.act(1, 'raise', 80));
  h.act(1, 'call');
  assert.equal(h.state.phase, 'flop');
  checkDown(h);
  assertConserved(h, 2110);
});

test('短开注前已经过牌者，不足完整下注不会重开加注权', () => {
  const g = game([1000, 1000, 30, 1000]);
  toFlop(g);
  g.act(1, 'call'); // Check, at level zero.
  g.act(2, 'raise', 10); // All-in below the 20 minimum opening bet.
  assert.equal(g.legalActions(3).minRaiseTo, 30);
  assert.equal(g.legalActions(3).canRaise, true);
  assert.throws(() => g.act(3, 'raise', 20)); // No "completion" in no-limit.
  g.act(3, 'call'); g.act(0, 'call');
  assert.equal(g.state.actor, 1);
  assert.equal(g.legalActions(1).canRaise, false);
  assert.equal(g.legalActions(1).callAmount, 10);
  g.act(1, 'call');
  checkDown(g);
  assertConserved(g, 3030);
});

test('短开注后未行动玩家可完整加注30，重新开放先过牌者', () => {
  const g = game([1000, 1000, 30, 1000]);
  toFlop(g); g.act(1, 'call'); g.act(2, 'raise', 10);
  g.act(3, 'raise', 30); g.act(0, 'call');
  assert.equal(g.state.actor, 1);
  assert.equal(g.legalActions(1).canRaise, true);
  assert.equal(g.legalActions(1).minRaiseTo, 50);
});

test('淘汰座位下一手跳过，进入heads-up调整庄家避免连续大盲', () => {
  const g = game([1000, 1000, 1000, 1000]);
  checkDown(g);
  g.state.players.forEach((p, i) => { p.stack = i === 1 || i === 2 ? 2000 : 0; });
  g.startHand();
  assert.equal(g.state.dealer, 2); // Seat 2 was previous BB and becomes SB/button.
  assert.equal(g.state.smallBlindSeat, 2);
  assert.equal(g.state.bigBlindSeat, 1);
  assert.equal(g.state.actor, 2);
  assert.deepEqual(g.state.players.map(p => p.out), [true, false, false, true]);
  assert.equal(g.state.players[0].cards.length, 0);
  g.act(2, 'call'); g.act(1, 'call');
  assert.equal(g.state.actor, 1);
  checkDown(g);
  g.startHand();
  assert.equal(g.state.dealer, 1);
  assert.equal(g.state.actor, 1);
  assertConserved(g, 4000);
});

test('两人选项保留heads-up下注顺序和筹码耗尽提示', () => {
  const g = game([1000, 1000]);
  assert.equal(g.state.dealer, 0);
  assert.equal(g.state.actor, 0);
  assert.deepEqual(g.state.players.map(p => p.bet), [10, 20]);
  assert.throws(() => g.startHand());
  g.act(0, 'call');
  assert.equal(g.legalActions(1).canRaise, true);
  g.act(1, 'call');
  assert.equal(g.state.actor, 1);
  checkDown(g);
  g.state.players[0].stack = 0;
  assert.throws(() => g.startHand());
});

test('非法行动不修改游戏；完整加注更新下一次最小增量', () => {
  const g = game();
  const initial = JSON.stringify(g.state);
  assert.throws(() => g.act(0, 'call'));
  assert.throws(() => g.act(3, 'raise', 39));
  assert.throws(() => g.act(3, 'raise', 40.1));
  assert.equal(JSON.stringify(g.state), initial);
  g.act(3, 'raise', 60);
  assert.equal(g.state.minRaise, 40);
  assert.equal(g.legalActions(0).minRaiseTo, 100);
});

test('botPolicy只拿白名单快照，不暴露其他底牌、deck或this引擎', () => {
  let inspected = false;
  const g = game([1000, 1000, 1000, 1000], 42, {
    botPolicy: function (context, random) {
      assert.equal(this, undefined);
      assert.deepEqual(Object.keys(context).sort(), ['playerIndex', 'players', 'holeCards', 'board', 'pot', 'currentBet', 'minRaise', 'legal', 'dealer', 'phase'].sort());
      assert.equal(context.playerIndex, 3);
      for (const p of context.players) assert.deepEqual(Object.keys(p).sort(), ['name', 'style', 'stack', 'bet', 'folded', 'out', 'lastAction'].sort());
      assert.equal(context.holeCards.length, 2);
      assert.ok(random() >= 0 && random() < 1);
      context.players[0].stack = 999999;
      context.holeCards[0].rank = 1;
      inspected = true;
      return { action: 'call' };
    },
  });
  const botFirstRank = g.state.players[3].cards[0].rank;
  g.botAction();
  assert.equal(inspected, true);
  assert.equal(g.state.players[0].stack, 1000);
  assert.equal(g.state.players[3].cards[0].rank, botFirstRank);
  assert.equal(g.state.players[3].bet, 20);
});

test('缺省机器人策略只跟注，非法或抛错策略安全回退', () => {
  for (const botPolicy of [undefined, () => ({ action: 'raise', raiseTo: 2 }), () => null, () => { throw new Error('strategy'); }]) {
    const g = game([1000, 1000, 1000, 1000], 42, { botPolicy });
    g.botAction();
    assert.equal(g.state.players[3].bet, 20);
    assert.equal(g.state.actor, 0);
  }
});

test('极短筹码、多人不完整盲注均能结束并守恒', () => {
  for (const stacks of [[1, 1], [1, 1, 1], [1, 1, 1, 1], [5, 1000, 15, 3], [1000, 1, 1], [10, 20, 30, 40]]) {
    const g = game(stacks);
    const total = stacks.reduce((a, b) => a + b, 0);
    assertConserved(g, total);
    checkDown(g);
    assertConserved(g, total);
  }
});

test('固定种子多桌多手压力测试：主边池、筹码守恒、无死循环', () => {
  let hands = 0, actions = 0, sidePotHands = 0;
  for (let seed = 1; seed <= 480; seed++) {
    const random = rng(seed * 7919);
    const playerCount = 2 + seed % 3;
    const startingStack = 1 + Math.floor(random() * 3000);
    const g = new PokerEngine({ rng: random, startingStack, playerCount });
    for (let hand = 0; hand < 55 && g.state.players.filter(p => p.stack > 0).length > 1; hand++) {
      g.startHand(); hands++;
      let steps = 0;
      while (g.state.phase !== 'complete') {
        assert.ok(++steps < 250, `循环未结束：seed=${seed}, hand=${hand}`);
        assertConserved(g, startingStack * playerCount);
        const index = g.state.actor;
        const legal = g.legalActions(index);
        const roll = random();
        if (roll < 0.17 && legal.canCall) g.act(index, 'fold');
        else if (roll > 0.68 && legal.canRaise) {
          const target = Math.floor(legal.minRaiseTo + random() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
          g.act(index, 'raise', target);
        } else g.act(index, 'call');
        actions++;
      }
      assertConserved(g, startingStack * playerCount);
      if (g.state.result.pots.length > 1) sidePotHands++;
    }
  }
  console.log(`  随机验收：${hands} 手，${actions} 次行动，${sidePotHands} 手包含分层底池。`);
  assert.ok(hands > 700 && actions > 3000 && sidePotHands > 100);
});

test('默认八人身份与2至8人选项，所有座位均正确发牌', () => {
  const g = new PokerEngine();
  assert.deepEqual(g.state.players.map(p => p.name), ['你', '磐石', '烈焰', '千面', '狙击', '暗影', '疾风', '铁壁']);
  assert.deepEqual(g.state.players.map(p => p.style), ['human', 'tag', 'lag', 'balanced', 'nit', 'trap', 'pressure', 'defend']);
  assert.equal(g.state.players.reduce((sum, p) => sum + p.stack, 0), 8000);
  assert.throws(() => new PokerEngine({ playerCount: 1 }));
  assert.throws(() => new PokerEngine({ playerCount: 8.5 }));
  for (let playerCount = 2; playerCount <= 8; playerCount++) {
    for (let seed = 1; seed <= 12; seed++) {
      const h = new PokerEngine({ playerCount, rng: rng(seed) });
      h.startHand();
      assert.equal(h.state.players.length, playerCount);
      assert.equal(h.state.players.flatMap(p => p.cards).length, playerCount * 2);
      assertConserved(h, playerCount * 1000);
      checkDown(h);
      assertConserved(h, playerCount * 1000);
      assert.equal(h._deck.length, 52 - playerCount * 2 - 8);
    }
  }
});

test('八人16张底牌无重复、每轮8次行动、河牌后牌堆仍足够', () => {
  const g = new PokerEngine({ rng: rng(191) });
  g.startHand();
  assert.equal(g.state.dealer, 0);
  assert.equal(g.state.smallBlindSeat, 1);
  assert.equal(g.state.bigBlindSeat, 2);
  assert.equal(g.state.players.flatMap(p => p.cards).length, 16);
  assertConserved(g, 8000);
  for (const [phase, order] of [
    ['preflop', [3, 4, 5, 6, 7, 0, 1, 2]],
    ['flop', [1, 2, 3, 4, 5, 6, 7, 0]],
    ['turn', [1, 2, 3, 4, 5, 6, 7, 0]],
    ['river', [1, 2, 3, 4, 5, 6, 7, 0]],
  ]) {
    assert.equal(g.state.phase, phase);
    for (const seat of order) {
      assert.equal(g.state.actor, seat);
      g.act(seat, 'call');
      assertConserved(g, 8000);
    }
  }
  assert.equal(g.state.phase, 'complete');
  assert.equal(g.state.board.length, 5);
  assert.equal(g._deck.length, 28); // 16 hole cards + 3 burn cards + 5 board cards.
  const remainingAndVisible = [...g._deck, ...g.state.board, ...g.state.players.flatMap(p => p.cards)].map(c => `${c.rank}${c.suit}`);
  assert.equal(remainingAndVisible.length, 49);
  assert.equal(new Set(remainingAndVisible).size, 49);
  assert.equal(g.state.result.pots.length, 1);
  assert.equal(g.state.result.pots[0].amount, 160);
});

test('八人最大七层主边池、七个不同赢家与最高孤立退款', () => {
  const g = game([100, 200, 300, 800, 400, 500, 600, 700]);
  rig(g, ['As Ah', 'Ks Kh', 'Qs Qh', '7s 7h', 'Js Jh', 'Ts Th', '9s 9h', '8s 8h'], '2c 2d 3h 3s 5c');
  g.act(3, 'raise', 800);
  for (const seat of [4, 5, 6, 7, 0, 1, 2]) {
    assert.equal(g.state.actor, seat);
    g.act(seat, 'call');
    assertConserved(g, 3600);
  }
  assert.equal(g.state.phase, 'complete');
  assert.deepEqual(g.state.result.pots.map(p => p.amount), [800, 700, 600, 500, 400, 300, 200]);
  assert.deepEqual(g.state.result.pots.map(p => p.winners), [[0], [1], [2], [4], [5], [6], [7]]);
  assert.deepEqual(g.state.result.pots.map(p => p.eligible.length), [8, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(g.state.result.payouts, [800, 700, 600, 0, 500, 400, 300, 200]);
  assert.deepEqual(g.state.players.map(p => p.stack), [800, 700, 600, 100, 500, 400, 300, 200]);
  assert.ok(g.state.log.includes('千面收回无人跟注的 100 筹码。'));
});

test('八人死钱合并主池、六层实际分池与最末座位退款', () => {
  const g = game([100, 200, 300, 1000, 400, 500, 600, 700]);
  rig(g, ['As Ah', 'Ks Kh', 'Qs Qh', '7s 7h', 'Js Jh', 'Ts Th', '9s 9h', '8s 8h'], '2c 2d 3h 3s 5c');
  g.act(3, 'call'); g.act(4, 'raise', 40); g.act(5, 'call'); g.act(6, 'call');
  g.act(7, 'raise', 700); g.act(0, 'call'); g.act(1, 'call'); g.act(2, 'call');
  g.act(3, 'fold'); g.act(4, 'call'); g.act(5, 'call'); g.act(6, 'call');
  assert.deepEqual(g.state.result.pots.map(p => p.amount), [720, 600, 500, 400, 300, 200]);
  assert.deepEqual(g.state.result.pots.map(p => p.winners), [[0], [1], [2], [4], [5], [6]]);
  assert.deepEqual(g.state.result.payouts, [720, 600, 500, 0, 400, 300, 200, 0]);
  assert.equal(g.state.result.handNames[3], null);
  assert.equal(g.state.players[3].stack, 980);
  assert.equal(g.state.players[7].stack, 100);
  assert.ok(g.state.result.pots.every(p => !p.eligible.includes(3)));
  assertConserved(g, 3800);
});

test('八人短筹码同时淘汰六席，下一手跳空位切换heads-up', () => {
  const g = game([1, 1, 1, 1, 1, 1, 1, 1000]);
  rig(g, ['As Ah', 'Ks Kh', 'Qs Qh', '7s 7h', 'Js Jh', 'Ts Th', '9s 9h', '8s 8h'], '2c 2d 3h 3s 5c');
  checkDown(g);
  assert.deepEqual(g.state.players.map(p => p.stack), [8, 0, 0, 0, 0, 0, 0, 999]);
  assert.ok(g.state.players.every(p => !p.out)); // They were participants in this hand.
  assertConserved(g, 1007);
  g.startHand();
  assert.equal(g.state.dealer, 7);
  assert.equal(g.state.smallBlindSeat, 7);
  assert.equal(g.state.bigBlindSeat, 0);
  assert.deepEqual(g.state.players.map(p => p.out), [false, true, true, true, true, true, true, false]);
  assert.equal(g.state.players.flatMap(p => p.cards).length, 4);
  assert.equal(g.state.phase, 'complete'); // Short BB is all-in; no empty side-pot betting.
  assertConserved(g, 1007);
});

test('八席桌只剩6/7号位时仍按正确顺序行动，玩家0淘汰不阻止引擎', () => {
  const g = game([0, 0, 0, 0, 0, 0, 4000, 4000]);
  assert.equal(g.state.dealer, 6);
  assert.equal(g.state.smallBlindSeat, 6);
  assert.equal(g.state.bigBlindSeat, 7);
  assert.equal(g.state.actor, 6);
  g.botAction(); g.botAction();
  assert.equal(g.state.phase, 'flop');
  assert.equal(g.state.actor, 7);
  checkDown(g);
  assertConserved(g, 8000);
});

test('七个电脑座位的botPolicy隔离契约保持不变', () => {
  const seen = [];
  const g = new PokerEngine({ rng: rng(73), botPolicy: function (context) {
    assert.equal(this, undefined);
    assert.equal(context.players.length, 8);
    assert.equal(context.holeCards.length, 2);
    assert.equal(context.deck, undefined);
    assert.equal(context.state, undefined);
    for (const p of context.players) assert.deepEqual(Object.keys(p).sort(), ['name', 'style', 'stack', 'bet', 'folded', 'out', 'lastAction'].sort());
    seen.push(context.playerIndex);
    context.players[0].stack = -1000;
    return { action: 'call' };
  } });
  g.startHand();
  for (let i = 0; i < 8; i++) {
    if (g.state.actor === 0) g.act(0, 'call');
    else g.botAction();
  }
  assert.equal(g.state.phase, 'flop');
  assert.deepEqual(seen, [3, 4, 5, 6, 7, 1, 2]);
  assertConserved(g, 8000);
});

test('八人多seed比赛：每步8000筹码守恒、淘汰跳过、牌堆与边池不出错', () => {
  let hands = 0, actions = 0, sidePotHands = 0, completedTables = 0;
  for (let seed = 1; seed <= 320; seed++) {
    const random = rng(seed * 104729);
    const g = new PokerEngine({ rng: random });
    for (let hand = 0; hand < 100 && g.state.players.filter(p => p.stack > 0).length > 1; hand++) {
      g.startHand(); hands++;
      let steps = 0;
      while (g.state.phase !== 'complete') {
        assert.ok(++steps < 600, `八人桌循环未结束：seed=${seed}, hand=${hand}`);
        assertConserved(g, 8000);
        const index = g.state.actor;
        const legal = g.legalActions(index);
        const roll = random();
        if (roll < 0.18 && legal.canCall) g.act(index, 'fold');
        else if (roll > 0.70 && legal.canRaise) {
          const target = Math.floor(legal.minRaiseTo + random() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
          g.act(index, 'raise', target);
        } else g.act(index, 'call');
        actions++;
      }
      assertConserved(g, 8000);
      if (g.state.result.pots.length > 1) sidePotHands++;
    }
    if (g.state.players.filter(p => p.stack > 0).length === 1) completedTables++;
  }
  console.log(`  八人随机验收：${hands} 手，${actions} 次行动，${sidePotHands} 手主边池，${completedTables} 桌决出唯一胜者。`);
  assert.ok(hands > 1200 && actions > 8000 && sidePotHands > 200 && completedTables > 100);
});

console.log(`\n全部 ${passed} 项规则测试通过（含旧版四人回归与八人扩展）。`);
