(() => {
'use strict';
const $=id=>document.getElementById(id), n=value=>Number(value||0).toLocaleString('zh-CN');
const makeGame=()=>new PokerEngine({playerCount:8,botPolicy:PokerBot.chooseAction});
let game=makeGame(),timer=null,fast=false,played=0,won=0,counted=0,rangeKey='',rendered={};
let adviceKey = '', currentAdvice = null, revealed = false;
let decisions = [], initialStack = 1000;
const historyKey = 'holdem-practice:reviews:v1';
let reviews = [];
try {
 const saved = JSON.parse(localStorage.getItem(historyKey) || '[]');
 if (Array.isArray(saved)) reviews = saved.filter(hand => hand && Array.isArray(hand.decisions)).slice(0, 30);
 $('auto-hints').checked = localStorage.getItem('holdem-practice:auto-hints') === 'yes';
} catch (_) { /* In-memory practice also works when storage is unavailable. */ }
const percent = value => (100 * value).toFixed(1) + '%';
const suits={s:'♠',h:'♥',d:'♦',c:'♣'},suitNames={s:'黑桃',h:'红桃',d:'方块',c:'梅花'};
const phases=['preflop','flop','turn','river','complete'];
const phaseNames={preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌'};
const profileHints=['','精选起手','主动施压','灵活变招','耐心狙击','隐藏强牌','后位施压','重视赔率'];
function mountSeats(){
 const labels={tag:'稳健紧凶',lag:'压迫激进',balanced:'均衡多变',nit:'极紧强攻',trap:'隐蔽陷阱',pressure:'位置施压',defend:'稳健防守'};
 const marks=['','♠','♦','♣','♠','♣','♦','♥'];
 $('opponents').replaceChildren(...game.state.players.slice(1).map((p,offset)=>{
  const i=offset+1,el=document.createElement('div');el.className='bot-position';el.id='seat-wrap-'+i;el.dataset.seat=i;
  el.innerHTML='<div class="bot-combo"><div class="seat-info" id="seat-'+i+'"><span class="avatar" aria-hidden="true">'+marks[i]+'</span><div><div class="name-line"><b>'+p.name+'</b><span class="dealer" id="dealer-'+i+'">D</span></div><span class="profile">'+labels[p.style]+'</span><div class="stack" id="stack-'+i+'">1,000</div></div></div><div class="cards small-cards" id="cards-'+i+'" aria-label="'+p.name+'的手牌"></div></div><div class="seat-action" id="status-'+i+'"></div><span class="seat-bet" id="bet-'+i+'"></span>';
  return el;
 }));
}
function drawCards(id,list,count,hidden=false){
 const key=JSON.stringify([list,count,hidden]);if(rendered[id]===key)return;rendered[id]=key;
 $(id).replaceChildren(...Array.from({length:count},(_,i)=>{
  const el=document.createElement('div'),c=list[i];
  if(c&&hidden){el.className='card back';el.setAttribute('aria-label','未公开的底牌');}
  else if(!c){el.className='card placeholder';el.setAttribute('aria-label','等待发牌');}
  else{const r=({11:'J',12:'Q',13:'K',14:'A'})[c.rank]||c.rank;el.className='card'+(['h','d'].includes(c.suit)?' red':'');el.setAttribute('aria-label',suitNames[c.suit]+r);el.innerHTML='<span class="corner">'+r+'<small>'+suits[c.suit]+'</small></span><span class="suit" aria-hidden="true">'+suits[c.suit]+'</span>';}
  return el;
 }));
}
function legal(){return game.legalActions(0);}
function updateRaise(){const s=game.state,value=Number($('raise-range').value);$('raise-value').textContent=n(value);$('raise').textContent=(s.currentBet===0?'下注 ':'加注至 ')+n(value);$('raise-cost').textContent='再投入 '+n(Math.max(0,value-s.players[0].bet));}
function matchFinished(){const s=game.state;return s.phase==='complete'&&(s.players[0].stack===0||s.players.filter(p=>p.stack>0).length===1);}
function adviceContext(){
 const s=game.state,copyCard=({rank,suit})=>({rank,suit});
 // The coach receives the human's cards and public facts only. Never pass
 // the engine, its deck, raw state, or any opponent's card objects.
 return {playerIndex:0,players:s.players.map(({name,style,stack,bet,folded,out,lastAction},index)=>({name,style,stack,bet,folded,out,lastAction,contributed:game._contributions[index]})),
  holeCards:s.players[0].cards.map(copyCard),board:s.board.map(copyCard),pot:s.pot,currentBet:s.currentBet,minRaise:s.minRaise,
  legal:game.legalActions(0),dealer:s.dealer,phase:s.phase};
}
function renderAdvice(mine){
 const s=game.state,hero=s.players[0];
 $('advice-panel').classList.toggle('is-ready',mine);
 $('advice-body').hidden=true; $('advice-fill').hidden=true; $('advice-reveal').hidden=true;
 if(!mine){
  currentAdvice=null;adviceKey='';
  $('advice-action').textContent=s.phase==='idle'?'发牌后提供建议':s.phase==='complete'?'本手已结束':hero.folded?'已弃牌，等待下一手':hero.stack===0?'已全下，等待结算':'等待你的回合';
  return;
 }
 try{
  const context=adviceContext(),key=JSON.stringify(context);
  if(key!==adviceKey){currentAdvice=PokerAdvisor.advise(context);adviceKey=key;revealed=false;}
  if(!currentAdvice){$('advice-action').textContent='当前无需行动';$('advice-body').hidden=true;return;}
  if (!$('auto-hints').checked && !revealed) {
   $('advice-action').textContent = context.legal.callAmount ? '先估一下跟注门槛' : '可以过牌，要主动下注吗？';
   $('advice-reveal').hidden = false;
   return;
  }
  revealed = true;
  $('advice-body').hidden = false;
  const info = currentAdvice;
  $('advice-action').textContent=info.label;
  $('advice-reason').textContent=info.reason;
  $('advice-equity').textContent=percent(info.equity);
  $('advice-equity').title='随机范围下的抽样区间约 ' + percent(info.equityLow) + ' 至 ' + percent(info.equityHigh);
  $('advice-price').textContent=percent(info.potOdds);
  $('advice-method').textContent=info.samples.toLocaleString('zh-CN')+' 次模拟 · 随机对手范围';
  $('advice-fill').hidden=info.action!=='raise';
 }catch(_){currentAdvice=null;adviceKey='';$('advice-action').textContent='暂时无法生成建议';$('advice-body').hidden=true;}
}
function cardText(cards) {
 return cards.map(card => (({11:'J',12:'Q',13:'K',14:'A'})[card.rank] || card.rank) + suits[card.suit]).join(' ');
}
function captureDecision(type, amount) {
 if (!currentAdvice) return null;
 const s = game.state, legalMove = legal(), coach = currentAdvice;
 const actual = type === 'raise' ? (s.currentBet ? '加注至 ' : '下注 ') + n(amount)
   : type === 'fold' ? '弃牌' : legalMove.canCheck ? '过牌' : '跟注 ' + n(legalMove.callAmount);
 const position = s.dealer === 0 ? '庄家位' : s.bigBlindSeat === 0 ? '大盲位' : s.smallBlindSeat === 0 ? '小盲位' : '距庄家顺时针 ' + ((s.players.length - s.dealer) % s.players.length) + ' 席';
 let question = '';
 if (type === 'fold' && legalMove.canCheck) question = '这一步可以免费过牌。过牌保留争池机会，弃牌会立即放弃底池。';
 else if (legalMove.callAmount && type !== coach.action) question = '复盘时可以试着缩窄对手范围。假设对方只用强牌下注，你还愿意付这个价格吗？';
 else if (type === 'raise') question = '想一想这次加注的目标：哪些更弱的牌会跟，哪些更强的牌可能弃？';
 return { position, question, phase:phaseNames[s.phase], board:cardText(s.board), own:cardText(s.players[0].cards),
  opponents:s.players.filter((p,index) => index && !p.folded && !p.out).length,
  pot:s.pot, cost:legalMove.callAmount, actual, reference:coach.label, reason:coach.reason,
  equity:coach.equity, price:coach.potOdds, contestable:coach.contestablePot,
  margin:coach.marginOfError, shown:revealed };
}
function saveReview() {
 const s = game.state;
 reviews.unshift({ number:s.handNo, at:Date.now(), delta:s.players[0].stack-initialStack, decisions });
 reviews = reviews.slice(0,30);
 try { localStorage.setItem(historyKey, JSON.stringify(reviews)); } catch (_) { /* Keep this session's records. */ }
}
function noteElement(parent, tag, content, className) {
 const element = document.createElement(tag);
 element.textContent = content;
 if (className) element.className = className;
 parent.append(element);
 return element;
}
function displayReview(index) {
 const hand = reviews[index], list = $('review-decisions');
 list.replaceChildren();
 $('hand-choice').hidden = !hand;
 if (!hand) { $('review-outcome').textContent = '打完第一手后，就能在这里回看自己的决策。'; return; }
 const independent = hand.decisions.filter(move => !move.shown).length;
 $('review-outcome').textContent = '净筹码 ' + (hand.delta > 0 ? '+' : '') + n(hand.delta) + ' · 独立决策 ' + independent + ' / ' + hand.decisions.length + ' 次';
 if (!hand.decisions.length) noteElement(list,'p','本手在轮到你之前就已结束。');
 hand.decisions.forEach(move => {
  const article = document.createElement('article');
  article.className = 'review-step';
  noteElement(article,'h3',move.phase + ' · ' + move.actual);
  noteElement(article,'p',(move.position ? move.position + '　' : '') + '手牌 ' + move.own + (move.board ? '　公共牌 ' + move.board : '') + '　对手 ' + move.opponents + ' 人','review-state');
  noteElement(article,'p','底池 ' + n(move.pot) + '　需跟注 ' + n(move.cost));
  if (move.cost) noteElement(article,'p','跟注门槛 = ' + n(move.cost) + ' ÷ ' + n(move.contestable) + ' = ' + percent(move.price) + '（分母为跟注后可争底池）');
  noteElement(article,'p','估算权益 ' + percent(move.equity) + ' · 教练参考 ' + move.reference + (move.shown ? ' · 已看提示' : ' · 独立选择'),'review-reference');
  noteElement(article,'p',move.reason);
  if (move.question) noteElement(article,'p',move.question,'review-prompt');
  list.append(article);
 });
}
function openReview() {
 const select = $('review-select');
 select.replaceChildren();
 reviews.forEach((hand,index) => {
  const option = document.createElement('option');
  option.value = index;
  option.textContent = new Date(hand.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' · 第 ' + hand.number + ' 手';
  select.append(option);
 });
 displayReview(0);
 $('review-dialog').showModal();
}
function render(){
 const s=game.state,idle=s.phase==='idle',done=s.phase==='complete',hero=s.players[0],mine=!idle&&!done&&s.actor===0,thinking=!idle&&!done&&s.actor>0;
 const result=s.result||{},payouts=result.payouts||[];
 if(done&&counted!==s.handNo){saveReview();counted=s.handNo;played++;if(payouts[0]>0)won++;}
 $('played').innerHTML=played+'<span> 手</span>';$('won').innerHTML=won+'<span> 手</span>';
 $('hand-number').textContent=s.handNo?'第 '+String(s.handNo).padStart(2,'0')+' 手':'准备入座';
 $('pot-label').textContent=done?'已分配':'底池';$('pot').textContent=n(done?(result.pots||[]).reduce((sum,p)=>sum+p.amount,0):s.pot);
 $('control-stack').textContent='筹码 '+n(hero.stack);$('player-stack').textContent=n(hero.stack);$('player-dealer').hidden=idle||s.dealer!==0;
 $('player-seat').classList.toggle('is-active',mine);$('player-seat').classList.toggle('folded',hero.folded);
 $('player-bet').textContent=!idle&&!done?(hero.folded?'已弃牌':hero.stack===0?'已全下':hero.bet?'本轮 '+n(hero.bet):''):'';
 drawCards('board',s.board,5);drawCards('player-cards',hero.cards,2);
 $('hand-strength').textContent=idle?'等待发牌':hero.folded?'已弃牌':(result.handNames?.[0]||game.handName(0));
 for(let i=1;i<s.players.length;i++){
  const p=s.players[i],active=thinking&&s.actor===i;
  $('stack-'+i).textContent=n(p.stack);$('dealer-'+i).hidden=idle||s.dealer!==i;
  $('seat-'+i).classList.toggle('is-active',active);$('seat-wrap-'+i).classList.toggle('is-active',active);
  $('seat-wrap-'+i).classList.toggle('folded',p.folded&&!p.out);$('seat-wrap-'+i).classList.toggle('eliminated',p.out||(done&&p.stack===0));
  drawCards('cards-'+i,p.cards,2,!(done&&result.showdown&&!p.folded&&!p.out));
  $('status-'+i).textContent=idle?profileHints[i]:p.out?'已淘汰 · 离席':done?(p.stack===0?'本手淘汰':p.folded?'已弃牌':result.handNames?.[i]||'赢得底池'):p.folded?'已弃牌':p.stack===0?'已全下':active?'思考中…':p.lastAction||'等待行动';
  $('bet-'+i).textContent=done?(payouts[i]>0?'获池 '+n(payouts[i]):''):p.bet?'本轮 '+n(p.bet):'';
 }
 document.querySelectorAll('[data-stage]').forEach(el=>{el.classList.toggle('active',el.dataset.stage===s.phase);el.classList.toggle('passed',phases.indexOf(el.dataset.stage)<phases.indexOf(s.phase));});
 document.querySelector('[data-stage="complete"]').textContent=done&&!result.showdown?'结束':'摊牌';
 $('table-message').textContent=idle?'七位高手已就位，准备好迎接挑战了吗？':done?(result.showdown?'摊牌完成 · 各底池分别结算':'其余玩家弃牌，本手结束'):(phaseNames[s.phase]+' · '+s.players.filter(p=>!p.folded&&!p.out).length+' 人争池');
 $('turn-marker').classList.toggle('thinking',thinking);document.querySelector('.turn-status').classList.toggle('is-complete',done);
 const a=legal();
 $('turn-title').textContent=idle?'七位高手，已经就位。':done?result.title:mine?'轮到你了':s.players[s.actor].name+' 正在思考…';
 $('turn-detail').textContent=idle?'每人 1,000 筹码，打到最后一人。':done?result.detail:hero.folded?'你已弃牌，等待本手结算。':hero.stack===0?'你已全下，等待其余玩家行动。':mine?(a.canCheck?'可以过牌，也可以主动下注。':'跟注 '+n(a.callAmount)+'，或选择加注、弃牌。'):'观察对手的下注节奏';
 if(matchFinished())$('turn-title').textContent=hero.stack>0?'你赢下了整桌！':'你已淘汰，再来挑战一次。';
 $('action-controls').hidden=idle||done||hero.folded||hero.stack===0;
 $('fold').disabled=!mine||!a.canFold;$('call').disabled=!mine||!(a.canCall||a.canCheck);$('raise').disabled=!mine||!a.canRaise;
 $('call').textContent=!mine?'等待行动':a.canCheck?'过牌':(a.callAmount>=hero.stack?'全下跟注 ':'跟注 ')+n(a.callAmount);
 $('raise-range').disabled=!mine||!a.canRaise;document.querySelectorAll('[data-raise]').forEach(el=>el.disabled=!mine||!a.canRaise);
 const key=[s.handNo,s.phase,s.actor,s.currentBet,hero.stack,hero.bet].join('|');
 if(rangeKey!==key){rangeKey=key;const min=a.canRaise?a.minRaiseTo:s.currentBet||20,max=a.canRaise?a.maxRaiseTo:min;$('raise-range').min=min;$('raise-range').max=max;$('raise-range').value=min;}
 updateRaise();
 renderAdvice(mine);
 $('next').hidden=!(idle||done);$('next').innerHTML=(idle?'挑战高手':matchFinished()?'再挑战一场':'下一手')+' <span aria-hidden="true">♠</span>';
 $('review-hand').hidden=!done;
 $('settlement').hidden=!done||!(result.pots?.length);if(!done)$('settlement').open=false;
 if(done&&result.pots){$('pot-list').replaceChildren(...result.pots.map((pot,i)=>{const li=document.createElement('li');li.textContent=(i===0?'主池':'边池 '+i)+' '+n(pot.amount)+'：'+pot.winners.map(j=>s.players[j].name).join('、')+(pot.winners.length>1?' 平分':' 获得');return li;}));}
 $('history-list').replaceChildren(...s.log.slice(-9).map(msg=>{const li=document.createElement('li');li.textContent=msg;return li;}));
 $('tip-text').textContent=idle?'七位对手各有打法。观察行动顺序与下注尺度，更多人数意味着更多竞争。':s.phase==='preflop'?'多人底池里，起手牌选择和位置更重要。庄家每手轮换，留意先后手。':done?'主池与边池各自比较牌型。短筹码全下玩家，无法赢取自己未参与的边池。':'电脑会估算未知牌的胜率、比较跟注成本，再结合各自的打法决策。';
 if(thinking&&!timer){timer=setTimeout(()=>{timer=null;try{game.botAction();render();}catch(e){showError(e);}},fast?100:420);}
}
function showError(e){$('error').textContent='操作未完成：'+e.message;$('error').hidden=false;}
function action(type) {
 if (game.state.actor !== 0) return;
 try {
  $('error').hidden = true;
  const amount = type === 'raise' ? Number($('raise-range').value) : undefined;
  const decision = captureDecision(type,amount);
  game.act(0,type,amount);
  if (decision) decisions.push(decision);
  render();
 } catch (error) { showError(error); }
}
function reset(){if(timer)clearTimeout(timer);timer=null;game=makeGame();played=0;won=0;counted=0;rangeKey='';adviceKey='';currentAdvice=null;rendered={};$('error').hidden=true;render();}
$('fold').addEventListener('click',()=>action('fold'));$('call').addEventListener('click',()=>action('call'));$('raise').addEventListener('click',()=>action('raise'));
$('next').addEventListener('click',()=>{try{if(matchFinished())reset();decisions=[];initialStack=game.state.players[0].stack;game.startHand();$('error').hidden=true;render();}catch(e){showError(e);}});
$('raise-range').addEventListener('input',updateRaise);
$('advice-fill').addEventListener('click',()=>{
 const a=legal();
 if(game.state.actor!==0||!a.canRaise||currentAdvice?.action!=='raise')return;
 const value=currentAdvice.raiseTo;
 if(!Number.isInteger(value)||value<a.minRaiseTo||value>a.maxRaiseTo)return;
 $('raise-range').value=value;updateRaise();
 $('raise').focus();
});
for(const el of document.querySelectorAll('[data-raise]'))el.addEventListener('click',()=>{const a=legal(),s=game.state;let value=a.minRaiseTo;if(el.dataset.raise==='all')value=a.maxRaiseTo;else if(el.dataset.raise==='half')value=s.currentBet+Math.floor((s.pot+a.callAmount)/2);else if(el.dataset.raise==='pot')value=s.currentBet+s.pot+a.callAmount;$('raise-range').value=Math.max(a.minRaiseTo,Math.min(a.maxRaiseTo,value));updateRaise();});
$('speed').addEventListener('click',()=>{fast=!fast;$('speed').textContent=fast?'快速出牌':'正常速度';$('speed').setAttribute('aria-pressed',String(fast));});
for(const id of ['help','ranking'])$(id).addEventListener('click',()=>$('help-dialog').showModal());
for(const id of ['close-help','got-it'])$(id).addEventListener('click',()=>$('help-dialog').close());
$('reset').addEventListener('click',()=>$('reset-dialog').showModal());$('cancel-reset').addEventListener('click',()=>$('reset-dialog').close());$('confirm-reset').addEventListener('click',()=>{$('reset-dialog').close();reset();});
$('advice-reveal').addEventListener('click', () => { revealed = true; renderAdvice(game.state.actor === 0); });
$('auto-hints').addEventListener('change', () => {
 try { localStorage.setItem('holdem-practice:auto-hints',$('auto-hints').checked ? 'yes' : 'no'); } catch (_) {}
 renderAdvice(game.state.actor === 0);
});
$('open-drills').addEventListener('click', () => { $('drills-dialog').showModal(); PokerDrills.start(); });
$('open-reviews').addEventListener('click',openReview);
$('review-hand').addEventListener('click',openReview);
$('review-select').addEventListener('change',event => displayReview(Number(event.target.value)));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click',() => $(button.dataset.close).close());
mountSeats();
render();
})();
