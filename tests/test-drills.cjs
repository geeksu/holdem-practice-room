'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { QUESTIONS, createSession, makeRandom } = require('../docs/drills.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log(`✓ ${name}`); }
function finishRound(session, wrongFirst = false) {
  while (session.view().status !== 'complete') {
    let current = session.view();
    if (wrongFirst) {
      session.answer(current.question.choices.find(c => c.id !== current.question.correctId).id);
      session.retry();
      current = session.view();
    }
    session.answer(current.question.correctId);
    session.next();
  }
}

test('12道独立题、四个不重复选项、完整条件和解释', () => {
  assert.equal(QUESTIONS.length, 12);
  assert.equal(new Set(QUESTIONS.map(q => q.id)).size, 12);
  for (const q of QUESTIONS) {
    assert.equal(q.choices.length, 4);
    assert.equal(new Set(q.choices.map(c => c.id)).size, 4);
    assert.equal(new Set(q.choices.map(c => c.text)).size, 4);
    assert.ok(q.choices.some(c => c.id === q.correctId));
    for (const key of ['topic', 'prompt', 'assumptions', 'calculation', 'explanation']) assert.ok(q[key].length > 5);
    assert.ok(Object.isFrozen(q) && Object.isFrozen(q.choices));
  }
});

test('跟注分母、河牌EV、单张和两张outs计算独立复核', () => {
  const answer = id => QUESTIONS.find(q => q.id === id).choices[0].text;
  assert.ok(answer('call-after-bet').includes((100 / 400 * 100).toFixed(1)));
  assert.ok(answer('call-before-bet').includes((150 / 500 * 100).toFixed(1)));
  assert.equal(0.35 * 300 - 0.65 * 100, 40);
  assert.ok(Math.abs(0.35 * 180 - 0.65 * 120 + 15) < 1e-10);
  assert.ok(answer('river-positive-ev').includes('+40'));
  assert.ok(answer('river-negative-ev').includes('−15'));
  assert.ok(answer('turn-one-card').includes((9 / 46 * 100).toFixed(1)));
  assert.ok(answer('flop-next-card').includes((8 / 47 * 100).toFixed(1)));
  assert.ok(answer('flop-two-cards').includes(((1 - 38 / 47 * 37 / 46) * 100).toFixed(1)));
  assert.ok(answer('clean-outs').includes((7 / 46 * 100).toFixed(1)));
  assert.ok(answer('side-pot-eligible').includes((100 / 300 * 100).toFixed(1)));
  assert.ok(answer('range-combinations').includes(String(20 / 80 * 100)));
});

test('独立种子可重现，题序和正确答案位置都打乱', () => {
  function arrangement(seed) {
    const session = createSession(seed);
    const result = [];
    while (session.view().status !== 'complete') {
      const q = session.view().question;
      result.push([q.id, q.choices.map(c => c.id).join(','), q.choices.findIndex(c => c.id === q.correctId)]);
      session.answer(q.correctId); session.next();
    }
    return result;
  }
  assert.deepEqual(arrangement(418), arrangement(418));
  assert.notDeepEqual(arrangement(418), arrangement(419));
  assert.equal(new Set(arrangement(418).map(item => item[0])).size, 12);
  assert.ok(new Set(arrangement(418).map(item => item[2])).size >= 3);
  const random = makeRandom(0);
  for (let i = 0; i < 1000; i++) { const n = random(); assert.ok(n >= 0 && n < 1); }
});

test('答错再试只计一个首答，订正不刷首次掌握数', () => {
  const session = createSession(4);
  const q = session.view().question;
  session.answer(q.choices.find(c => c.id !== q.correctId).id);
  assert.equal(session.view().status, 'wrong');
  assert.equal(session.view().firstAnswered, 1);
  assert.equal(session.view().firstCorrect, 0);
  assert.throws(() => session.next());
  session.retry();
  session.answer(q.correctId);
  assert.equal(session.view().firstAnswered, 1);
  assert.equal(session.view().firstCorrect, 0);
  assert.equal(session.view().corrected, 1);
  assert.equal(session.view().attempts, 2);
  assert.equal(session.view().roundCompleted, 1);
});

test('未答不能下一题、非法选项和重复提交不改变记录', () => {
  const session = createSession(7);
  assert.throws(() => session.next());
  assert.throws(() => session.retry());
  assert.throws(() => session.again());
  assert.throws(() => session.answer('not-a-choice'));
  assert.equal(session.view().firstAnswered, 0);
  session.answer(session.view().question.correctId);
  const before = session.view();
  assert.throws(() => session.answer(before.question.correctId));
  assert.deepEqual(session.view(), before);
});

test('整轮重练保留每题首次记录，不会靠重复题刷正确率', () => {
  const session = createSession(16);
  finishRound(session, true);
  assert.equal(session.view().firstCorrect, 0);
  assert.equal(session.view().firstAnswered, 12);
  assert.equal(session.view().corrected, 12);
  assert.equal(session.view().review.length, 12);
  session.again();
  assert.equal(session.view().round, 2);
  assert.equal(session.view().roundCompleted, 0);
  finishRound(session);
  assert.equal(session.view().firstCorrect, 0);
  assert.equal(session.view().firstAnswered, 12);
  assert.equal(session.view().roundCompleted, 12);
  const mastered = createSession(20);
  finishRound(mastered);
  mastered.again();
  finishRound(mastered, true);
  assert.equal(mastered.view().firstCorrect, 12);
  assert.equal(mastered.view().review.length, 0);
});

test('返回快照不能篡改题库或内部首答记录', () => {
  const session = createSession(21);
  const view = session.view();
  const id = view.question.id;
  view.question.correctId = 'c99';
  view.question.choices[0].text = 'changed';
  view.firstCorrect = 999;
  assert.equal(session.view().question.id, id);
  assert.equal(session.view().question.correctId, 'c0');
  assert.notEqual(session.view().question.choices[0].text, 'changed');
  assert.equal(session.view().firstCorrect, 0);
});

class TestElement {
  constructor(tag, document) {
    this.tagName = tag;
    this.document = document;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.attributes = {};
    this.listeners = {};
    this.disabled = false;
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  focus() { this.document.activeElement = this; }
  click() { if (!this.disabled && this.listeners.click) this.listeners.click(); }
}
function browserHarness({ rootPresent = true, cryptoPresent = true } = {}) {
  const document = {
    activeElement: null,
    createElement(tag) { return new TestElement(tag, this); },
    getElementById(id) { return id === 'drills-root' && rootPresent ? host : null; },
  };
  const host = new TestElement('section', document);
  const gameNode = new TestElement('main', document);
  gameNode.textContent = '游戏筹码与页面保持原状';
  let gameRandomCalls = 0;
  const isolatedMath = Object.create(Math);
  isolatedMath.random = () => { gameRandomCalls++; throw new Error('小测消耗了游戏随机数'); };
  const context = { document, Math: isolatedMath, Date: { now: () => 42 }, Uint32Array };
  if (cryptoPresent) context.crypto = { getRandomValues(values) { values[0] = 42; return values; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/drills.js'), 'utf8'), context);
  function all(className) {
    const result = [];
    function walk(node) {
      if (node.className.split(' ').includes(className)) result.push(node);
      node.children.forEach(walk);
    }
    walk(host);
    return result;
  }
  return { context, host, document, gameNode, all, gameRandomCalls: () => gameRandomCalls };
}

test('DOM流程：打开、答错、重试、下一题、关闭重开续做及最终复习', () => {
  const browser = browserHarness();
  const expected = createSession(42);
  assert.equal(browser.host.children.length, 0); // Registration never changes the game page.
  assert.equal(browser.context.PokerDrills.start(), true);
  assert.equal(browser.all('drill-options')[0].tagName, 'fieldset');
  assert.equal(browser.all('drill-option').length, 4);
  assert.equal(browser.all('drill-progress-bar')[0].tagName, 'progress');
  assert.equal(browser.all('drill-progress-bar')[0].attributes['aria-label'], '本轮已完成题数');
  const q = expected.view().question;
  const wrong = q.choices.find(c => c.id !== q.correctId);
  browser.all('drill-option').find(button => button.textContent.endsWith(wrong.text)).click();
  expected.answer(wrong.id);
  assert.equal(browser.all('drill-retry').length, 1);
  assert.equal(browser.all('drill-calculation').length, 1);
  assert.ok(browser.all('drill-option').every(button => button.disabled));
  assert.equal(browser.document.activeElement.className, 'drill-feedback-title');
  browser.all('drill-retry')[0].click();
  expected.retry();
  const currentTitle = browser.all('drill-question-title')[0].textContent;
  browser.context.PokerDrills.start();
  assert.equal(browser.all('drill-question-title')[0].textContent, currentTitle);
  while (expected.view().status !== 'complete') {
    const question = expected.view().question;
    const correct = question.choices.find(choice => choice.id === question.correctId);
    browser.all('drill-option').find(button => button.textContent.endsWith(correct.text)).click();
    expected.answer(question.correctId);
    assert.equal(browser.all('drill-next').length, 1);
    browser.all('drill-next')[0].click();
    expected.next();
  }
  assert.equal(browser.all('drill-summary').length, 1);
  assert.equal(browser.all('drill-review-item').length, 1);
  assert.equal(browser.all('drill-review-item')[0].tagName, 'details');
  assert.ok(browser.all('drill-summary-score')[0].textContent.includes('11 / 12'));
  browser.all('drill-again')[0].click();
  assert.equal(browser.all('drill-option').length, 4);
  assert.equal(browser.all('drill-progress-bar')[0].value, 0);
  assert.ok(browser.all('drill-score')[0].textContent.includes('11 / 12'));
  assert.equal(browser.gameNode.textContent, '游戏筹码与页面保持原状');
  assert.equal(browser.gameRandomCalls(), 0);
});

test('没有crypto时仍独立随机；缺少挂载节点时安全返回', () => {
  const fallback = browserHarness({ cryptoPresent: false });
  assert.equal(fallback.context.PokerDrills.start(), true);
  assert.equal(fallback.all('drill-option').length, 4);
  assert.equal(fallback.gameRandomCalls(), 0);
  const missing = browserHarness({ rootPresent: false });
  assert.equal(missing.context.PokerDrills.start(), false);
  assert.equal(missing.host.children.length, 0);
  assert.equal(missing.gameRandomCalls(), 0);
});

console.log(`\n全部 ${passed} 项小测测试通过；12道题、首答锁定与DOM交互均已验证。`);
