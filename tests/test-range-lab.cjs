'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Lab = require('../docs/range-lab.js');
const Advisor = require('../docs/advisor.js');
const Engine = require('../docs/engine.js');
const { SCENARIOS, analyzeRange, createSession, parseCard } = Lab;
let passed = 0;
function test(name, run) { run(); passed++; console.log('✓ ' + name); }
function input(scene, opponent = scene.opponents[0]) {
  return { hero: scene.hero, board: scene.board, potAfterBet: scene.potAfterBet, callAmount: scene.callAmount,
    combos: scene.candidates.map(item => ({ ...item, weight: opponent.preset[item.id] })) };
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('三个具体河牌场景、合法实体组合、公开下注历史及三个独立预设', () => {
  assert.equal(SCENARIOS.length, 3);
  for (const scene of SCENARIOS) {
    assert.equal(scene.hero.length, 2); assert.equal(scene.board.length, 5);
    assert.equal(scene.history.length, 4); assert.equal(scene.opponents.length, 3);
    assert.ok(scene.history[3].includes(String(scene.potAfterBet)) && scene.history[3].includes(String(scene.callAmount)));
    assert.ok(scene.opponents.every(item => item.clue.includes('训练设定')));
    const result = analyzeRange({ ...input(scene), combos: scene.candidates.map(item => ({ ...item, weight: 100 })) });
    assert.equal(result.excluded.length, 0);
    assert.equal(result.totalCombos, scene.candidates.length);
    assert.equal(new Set(scene.candidates.map(item => item.id)).size, scene.candidates.length);
    assert.ok(Object.isFrozen(scene) && Object.isFrozen(scene.candidates) && Object.isFrozen(scene.opponents[0].preset));
  }
});

test('同一手牌换对手，保守预设弃牌、积极预设跟注；保持真实牌与价格不变', () => {
  for (const scene of SCENARIOS) {
    const careful = analyzeRange(input(scene, scene.opponents[0]));
    const active = analyzeRange(input(scene, scene.opponents[1]));
    assert.equal(careful.preferred, 'fold'); assert.ok(careful.callEV < 0);
    assert.equal(active.preferred, 'call'); assert.ok(active.callEV > 0);
    assert.equal(careful.potOdds, active.potOdds);
    assert.ok(active.equity > careful.equity + .25);
    console.log(`  ${scene.id}: 权益 ${(careful.equity*100).toFixed(1)}% → ${(active.equity*100).toFixed(1)}%，跟注EV ${careful.callEV.toFixed(1)} → ${active.callEV.toFixed(1)}`);
  }
});

test('逐组合胜平负与既有引擎独立核对，标签不会决定结果', () => {
  for (const scene of SCENARIOS) {
    const full = analyzeRange({ ...input(scene), combos: scene.candidates.map(item => ({ ...item, kind: 'bluff', weight: 1 })) });
    const hero = Engine.evaluate(scene.hero.concat(scene.board).map(parseCard));
    for (const row of full.rows) {
      const opponent = Engine.evaluate(row.cards.concat(scene.board.map(parseCard)));
      const comparison = Engine.compare(hero, opponent);
      assert.equal(row.outcome, comparison > 0 ? 'win' : comparison < 0 ? 'loss' : 'tie');
    }
  }
  const first = analyzeRange({ ...input(SCENARIOS[0]), combos: [SCENARIOS[0].candidates.find(item => item.id === '64')] });
  assert.equal(first.rows[0].outcome, 'loss'); // The missed flush is actually a straight.
  const third = SCENARIOS[2];
  const ties = analyzeRange({ ...input(third), combos: third.candidates.filter(item => item.kind === 'thin') });
  assert.equal(ties.tieRate, 1); assert.equal(ties.equity, .5);
});

test('按权重算权益、平局半份额、精确EV和保本线，不把标签类别当50/50', () => {
  const scene = SCENARIOS[2];
  const result = analyzeRange({ ...input(scene), combos: [
    { ...scene.candidates.find(item => item.kind === 'value'), weight: 2 },
    { ...scene.candidates.find(item => item.kind === 'bluff'), weight: 3 },
    { ...scene.candidates.find(item => item.kind === 'thin'), weight: 5 }
  ] });
  assert.equal(result.winRate, .3); assert.equal(result.tieRate, .5); assert.equal(result.lossRate, .2);
  assert.equal(result.equity, .55); assert.equal(result.potOdds, .375); assert.ok(Math.abs(result.callEV - 140) < 1e-9); assert.equal(result.foldEV, 0);
  const first = SCENARIOS[0];
  const equal = analyzeRange({ ...input(first), combos: [
    { ...first.candidates.find(item => item.kind === 'value'), weight: 3 },
    { ...first.candidates.find(item => item.kind === 'bluff'), weight: 1 }
  ] });
  assert.equal(equal.equity, .25); assert.equal(equal.callEV, 0); assert.equal(equal.preferred, 'either');
});

test('组合去重、已知牌阻断、无效牌与零权重，避免重复扩大诈唬比例', () => {
  const scene = SCENARIOS[0], valid = scene.candidates.find(item => item.kind === 'bluff');
  const result = analyzeRange({ ...input(scene), combos: [
    { ...valid, weight: 1 }, { id: 'reversed', cards: valid.cards.slice().reverse(), weight: 100 },
    { id: 'hero-blocked', cards: ['Ad','Ac'], weight: 100 }, { id: 'board-blocked', cards: ['Jh','Js'], weight: 100 },
    { id: 'self-duplicate', cards: ['Qc','Qc'], weight: 100 }, { id: 'zero', cards: ['Kh','Kd'], weight: 0 }
  ] });
  assert.equal(result.totalCombos, 1); assert.equal(result.totalWeight, 1); assert.equal(result.excluded.length, 4);
  assert.equal(result.equity, 1); assert.equal(result.callEV, 300);
  assert.throws(() => analyzeRange({ ...input(scene), combos: [{cards:['Ad','Ac'],weight:100}] }), /至少保留/);
  assert.throws(() => analyzeRange({ ...input(scene), combos: [{cards:['As','Ks'],weight:-1}] }), /非负/);
  assert.throws(() => analyzeRange({ ...input(scene), board: ['Jh','Jh','5s','2d','3c'] }), /不能重复/);
  assert.throws(() => parseCard('Xx'));
  assert.deepEqual(parseCard('10H'), {rank:10,suit:'h'});
});

test('确定性、输入不变、额外秘密字段不读取，不消费任何随机数', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('range lab consumed randomness'); };
  try {
    const value = input(SCENARIOS[1], SCENARIOS[1].opponents[1]);
    const before = JSON.stringify(value), expected = analyzeRange(freeze(value));
    for (let i = 0; i < 5; i++) assert.deepEqual(analyzeRange(value), expected);
    assert.equal(JSON.stringify(value), before);
    const poisoned = input(SCENARIOS[1], SCENARIOS[1].opponents[1]);
    for (const key of ['deck','_deck','opponentCards','game','rng','toJSON']) Object.defineProperty(poisoned, key, { get() { throw new Error('Private field read'); } });
    assert.deepEqual(analyzeRange(poisoned), expected);
    const session = createSession(); session.answer('fold'); session.selectOpponent('active'); session.answer('call');
    assert.equal(session.view().history.length, 2);
  } finally { Math.random = original; }
});

test('先回答才反馈；更换对手或修改范围必须重新回答，重复提交不计新记录', () => {
  const session = createSession();
  const initial = session.view(); assert.equal(initial.feedback, null); assert.deepEqual(initial.history, []);
  assert.throws(() => session.answer('raise'));
  session.answer('fold'); const answered = session.view(); assert.equal(answered.status,'answered'); assert.equal(answered.feedback.matches,true);
  assert.throws(() => session.answer('call')); assert.equal(session.view().history.length,1);
  session.selectOpponent('active'); const changed=session.view();assert.equal(changed.feedback,null);assert.deepEqual(changed.history,[]);
  assert.deepEqual(changed.scenario.hero,initial.scenario.hero);assert.deepEqual(changed.scenario.board,initial.scenario.board);
  assert.equal(changed.scenario.potAfterBet,initial.scenario.potAfterBet);
  session.answer('call');assert.equal(session.view().feedback.matches,true);assert.equal(session.view().history.length,2);
  session.setWeight(changed.scenario.candidates[0].id,5);assert.equal(session.view().feedback,null);
  session.answer('fold');assert.equal(session.view().feedback.custom,true);
  session.resetRange();assert.equal(session.view().feedback,null);assert.equal(session.view().weights[changed.scenario.candidates[0].id],70);
  for(const item of session.view().scenario.candidates)session.setWeight(item.id,0);
  assert.throws(()=>session.answer('fold'),/至少保留/);assert.equal(session.view().feedback,null);
  session.selectScenario(SCENARIOS[2].id);assert.equal(session.view().scenario.id,SCENARIOS[2].id);assert.deepEqual(session.view().history,[]);
});

test('返回的训练快照与计算结果不泄漏可修改的内部状态',()=>{
  const session=createSession();const view=session.view();view.scenario.hero[0]='2h';view.weights.jj=0;
  assert.equal(session.view().scenario.hero[0],'Ad');assert.equal(session.view().weights.jj,100);
  session.answer('fold');const response=session.view();response.feedback.equity=1;response.history[0].callEV=999;
  assert.notEqual(session.view().feedback.equity,1);assert.notEqual(session.view().history[0].callEV,999);
});

class TestElement {
  constructor(tag, document) { this.tagName=tag;this.document=document;this.children=[];this.className='';this.textContent='';this.attributes={};this.listeners={};this.disabled=false;this.id=''; }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(name,handler){this.listeners[name]=handler;}
  focus(){this.document.activeElement=this;}
  click(){if(!this.disabled&&this.listeners.click)this.listeners.click();}
  change(value){if(this.type==='checkbox')this.checked=value;else this.value=value;if(!this.disabled&&this.listeners.change)this.listeners.change();}
  set innerHTML(_){throw new Error('Range lab must use textContent/native DOM');}
}
function browserHarness(present=true){
  let host;
  const document={activeElement:null,createElement(tag){return new TestElement(tag,this);},getElementById(id){
    if(id==='range-root')return present?host:null;
    const find=node=>node.id===id?node:node.children.map(find).find(Boolean);return find(host)||null;
  }};
  host=new TestElement('section',document);host.id='range-root';
  const math=Object.create(Math);let calls=0;math.random=()=>{calls++;throw new Error('game RNG consumed');};
  const context={document,Math:math,PokerAdvisor:Advisor};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/range-lab.js'),'utf8'),context);
  const all=className=>{const result=[];const visit=node=>{if(node.className.split(' ').includes(className))result.push(node);node.children.forEach(visit);};visit(host);return result;};
  return {context,document,host,all,randomCalls:()=>calls};
}

test('DOM交互先作答后揭示，换对手保持牌面；修改组合会收起旧结果',()=>{
  const browser=browserHarness();assert.equal(browser.host.children.length,0);assert.equal(browser.context.PokerRangeLab.start(),true);
  assert.equal(browser.all('range-feedback').length,0);assert.equal(browser.all('range-metrics').length,0);
  assert.equal(browser.all('range-editor-disclosure')[0].tagName,'details');assert.equal(browser.all('range-editor-disclosure')[0].open,false);
  assert.equal(browser.all('range-editor-summary')[0].textContent,'调整范围 · 已选 7 个组合');
  assert.equal(browser.all('range-editor')[0].tagName,'fieldset');assert.equal(browser.all('range-scenario-select')[0].tagName,'select');
  assert.ok(browser.all('range-combo-check').every(node=>node.tagName==='input'&&node.type==='checkbox'));
  const known=browser.all('range-card').map(node=>node.textContent);
  browser.all('range-answer-fold')[0].click();
  assert.equal(browser.all('range-feedback').length,1);assert.equal(browser.all('range-metric').length,4);assert.equal(browser.all('range-results-table')[0].tagName,'table');
  assert.equal(browser.document.activeElement.id,'range-feedback-title');assert.ok(browser.all('range-answer').every(node=>node.disabled));
  browser.all('range-next-opponent')[0].click();assert.equal(browser.all('range-feedback').length,0);assert.equal(browser.all('range-comparison').length,0);
  assert.equal(browser.all('range-editor-disclosure')[0].open,false);
  assert.deepEqual(browser.all('range-card').map(node=>node.textContent),known);
  browser.all('range-answer-call')[0].click();assert.equal(browser.all('range-comparison-item').length,2);
  const input=browser.all('range-weight')[0];input.change('5');assert.equal(browser.all('range-feedback').length,0);
  assert.equal(browser.all('range-editor-disclosure')[0].open,true);
  assert.equal(browser.document.activeElement.id,input.id);assert.equal(browser.all('range-answer-call')[0].disabled,false);
  browser.all('range-answer-call')[0].click();assert.ok(browser.all('range-comparison-item').some(node=>node.textContent.includes('自定范围')));
  browser.context.PokerRangeLab.start();assert.equal(browser.all('range-feedback').length,1); // Dialog reopen resumes.
  browser.all('range-scenario-select')[0].change(SCENARIOS[2].id);assert.equal(browser.all('range-feedback').length,0);
  assert.equal(browser.all('range-editor-disclosure')[0].open,false);
  assert.equal(browser.all('range-combo-check').length,12);assert.equal(browser.randomCalls(),0);
});

test('DOM空范围不可提交、原生控件标签和焦点可用、缺少容器安全返回',()=>{
  const browser=browserHarness();browser.context.PokerRangeLab.start();
  const ids=browser.all('range-combo-check').filter(node=>node.checked).map(node=>node.id);
  ids.forEach(id=>browser.document.getElementById(id).change(false));
  assert.equal(browser.all('range-editor-disclosure')[0].open,true);assert.equal(browser.all('range-editor-summary')[0].textContent,'调整范围 · 已选 0 个组合');
  assert.ok(browser.all('range-answer').every(node=>node.disabled));assert.equal(browser.all('range-feedback').length,0);
  const first=browser.all('range-combo-check')[0];first.change(true);assert.equal(browser.all('range-answer-call')[0].disabled,false);
  const weight=browser.all('range-weight')[0];assert.ok(weight.attributes['aria-label'].includes('相对权重'));weight.change('200');assert.equal(weight.value,'100');
  assert.ok(browser.all('range-opponent').every(node=>node.tagName==='button'&&node.type==='button'&&['true','false'].includes(node.attributes['aria-pressed'])));
  const missing=browserHarness(false);assert.equal(missing.context.PokerRangeLab.start(),false);assert.equal(missing.host.children.length,0);
});

console.log(`\n全部 ${passed} 项范围训练测试通过；真实组合枚举、先答后揭示与DOM流程均已验证。`);
