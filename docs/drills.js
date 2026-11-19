(function (root) {
  'use strict';

  function question(id, topic, prompt, assumptions, correct, distractors, calculation, explanation) {
    return Object.freeze({
      id, topic, prompt, assumptions, correctId: 'c0', calculation, explanation,
      choices: Object.freeze([correct, ...distractors].map((text, i) => Object.freeze({ id: `c${i}`, text }))),
    });
  }

  const QUESTIONS = Object.freeze([
    question('call-after-bet', '跟注门槛 · 下注后底池',
      '对手下注后，桌面底池已有 300 筹码。你需要再跟 100。至少需要多少胜率，跟注才能保本？',
      '300 已含对手本次下注，但不含你的跟注；不计抽水、平局和后续下注。',
      '25.0%', ['33.3%', '50.0%', '20.0%'],
      '跟注门槛 = 100 ÷ (300 + 100) = 25.0%。',
      '分母是跟注完成后的总底池。也可写成 EV = 胜率 × 300 − (1 − 胜率) × 100；保本时 EV = 0。已经投入的筹码不再作为本次新增成本。'),
    question('call-before-bet', '跟注门槛 · 下注前底池',
      '对手下注前底池为 200；对手下注 150，你也需要跟 150。正确的保本胜率是多少？',
      '200 尚未包含对手这次下注；不计抽水、平局和后续下注。',
      '30.0%', ['42.9%', '75.0%', '25.0%'],
      '跟注后总池 = 200 + 150 + 150 = 500；门槛 = 150 ÷ 500 = 30.0%。',
      '看到底池数字时，先确认它是否包含对手当前下注。这里不能只把自己的 150 加到原底池 200 上。'),
    question('river-positive-ev', '河牌单挑 · 正期望跟注',
      '河牌单挑：对手下注后底池是 300，跟注需 100。你对其当前下注范围有 35% 胜率。跟注相对弃牌的期望净收益是多少？',
      '无平局、无抽水、无后续下注；35% 是针对其整个下注范围的胜率；弃牌的本次 EV 记为 0。',
      '+40 筹码', ['+105 筹码', '−65 筹码', '+5 筹码'],
      'EV(跟注) = 0.35 × 300 − 0.65 × 100 = 105 − 65 = +40。',
      '赢时净赚当前底池的 300，输时损失新跟入的 100。不能只算赢的时候，也不能把收回自己的跟注额当成额外利润。'),
    question('river-negative-ev', '河牌单挑 · 识别亏损跟注',
      '河牌单挑：对手下注后底池为 180，你需跟 120；对其下注范围有 35% 胜率。只比较跟注与弃牌，哪项判断正确？',
      '无平局、无抽水、无后续下注；胜率已给定，不讨论加注。',
      '弃牌更好；跟注 EV 为 −15', ['跟注更好；EV 为 +15', '跟注更好；EV 为 +63', '两者一样；35% 已达到门槛'],
      '门槛 = 120 ÷ (180 + 120) = 40%；跟注 EV = 0.35 × 180 − 0.65 × 120 = −15。',
      '35% 低于 40% 保本线。能赢一部分牌局不等于这次跟注有正期望；弃牌的本次 EV 为 0，高于 −15。'),
    question('turn-one-card', '听牌概率 · 只剩河牌',
      '转牌已经发完，你有 9 张干净 outs。只看下一张河牌，命中概率约为多少？',
      '已知 2 张底牌和 4 张公共牌，未见牌为 46 张；各张未见牌等可能出现，9 张 outs 均有效。',
      '19.6%', ['35.0%', '9.0%', '39.1%'],
      '命中概率 = 9 ÷ 46 ≈ 19.6%。',
      '这里只剩一张牌，不能套用翻牌看到河牌的两张牌概率。“outs × 2”只是近似；明确未见牌数量时可以直接计算。'),
    question('flop-next-card', '听牌概率 · 翻牌到转牌',
      '翻牌后你有 8 张干净 outs。只问下一张转牌命中，不问到河牌，概率约为多少？',
      '已知 2 张底牌和 3 张公共牌，未见牌为 47 张；8 张 outs 均有效且未见牌等可能出现。',
      '17.0%', ['31.5%', '34.8%', '8.0%'],
      '下一张命中概率 = 8 ÷ 47 ≈ 17.0%。',
      '“下一张”与“到河牌还有两张”是两种事件。先确认购买的是一张牌的机会，还是能够确定看完两张牌。'),
    question('flop-two-cards', '听牌概率 · 确定看到河牌',
      '翻牌已全下，你有 9 张干净 outs，并且确定会看到转牌与河牌。至少命中一张的概率约为多少？',
      '未见牌 47 张；这 9 张 outs 一直有效，命中后不会再被反超；两张牌之间不用再付筹码。',
      '35.0%', ['19.1%', '38.3%', '18.0%'],
      '至少中一次 = 1 − 两次都不中 = 1 − (38 ÷ 47) × (37 ÷ 46) ≈ 35.0%。',
      '第二张是在第一张抽走后从 46 张中抽取，不能直接把两次单张概率相加。若不是全下，还必须考虑后续下注和 outs 失效。'),
    question('one-street-is-not-two', '概率边界 · 下一街仍可能收费',
      '翻牌有 8 张干净 outs。你当前这次跟注只保证看到转牌，对手转牌仍可下注。应怎样理解约 31.5% 的“到河牌命中率”？',
      '不保证免费看到河牌；没有给出转牌下注策略或隐含收益。',
      '不能直接拿 31.5% 作为这次跟注的胜率；还需考虑下一街成本',
      ['31.5% 可直接用于本次跟注，后续下注不影响', '当前跟注后就一定能免费看到河牌', '只要有 8 张 outs，就应该跟任何金额'],
      '下一张约 8 ÷ 47 = 17.0%；两张至少命中约 1 − (39 ÷ 47) × (38 ÷ 46) = 31.5%。',
      '两张牌概率描述的是能看完两张的事件。当前跟注的实际 EV 还取决于转牌决策、再付筹码及胜率实现，不能用一个命中率自动给出跟注结论。'),
    question('clean-outs', '干净 outs · 不能见到就算赢',
      '只剩河牌。你原先数了 9 张改善牌，但已确认其中 2 张出现也不会让你赢，其余 7 张命中即胜。按这个简化模型，命中获胜概率是多少？',
      '46 张未见牌等可能出现；不命中这 7 张就输，无平局；“改善牌”不一定是获胜 outs。',
      '7 ÷ 46，约 15.2%', ['9 ÷ 46，约 19.6%', '7 ÷ 44，约 15.9%', '9 ÷ 44，约 20.5%'],
      '有效 outs = 9 − 2 = 7；概率 = 7 ÷ 46 ≈ 15.2%。',
      '那 2 张无效牌仍留在未见牌中，所以只减少分子，不减少分母。真实牌局还要考虑对手范围、被反超和平局，不能把所有“看起来变强”的牌都当成干净 outs。'),
    question('side-pot-eligible', '边池 · 只能算自己可争的金额',
      '你只剩 100。跟注全下后，你有资格争夺的主池为 300（已含你这次跟入的 100）；另有 600 边池只属于其他玩家。你的保本胜率是多少？',
      '赢时独得这 300 主池，输时没有返还；无抽水、无平局、无后续费用；已有投入视为沉没成本。',
      '33.3%，因为只能争 300 主池', ['11.1%，因为主池加边池共 900', '10.0%，因为分母应再加一次自己的 100', '50.0%，因为桌上还剩两个底池'],
      'EV = 胜率 × 300 − 100；保本胜率 = 100 ÷ 300 ≈ 33.3%。',
      '300 是含本次跟注的最终可争金额，不能再加一次自己的 100。其他玩家之间的 600 边池不属于你的收益，不能用来降低你的跟注门槛。'),
    question('position-range', '位置 · 首次入池范围',
      '八人桌都尚未入池，比较枪口位 UTG 与按钮位 BTN。在其他条件相同时，哪个位置通常应采用更紧的首次入池范围？',
      '筹码深度、对手水平、盲注和抽水等条件相同；问一般原则，不要求具体开池牌表。',
      'UTG 通常更紧：身后未行动玩家更多',
      ['BTN 通常更紧：因为它最后拿到行动机会', '两个位置必须使用完全相同的范围', 'UTG 应更松：越早行动，信息越充分'],
      '八人桌 UTG 身后还有 7 位玩家；BTN 身后只剩小盲与大盲 2 位。',
      '更早位置要应对更多潜在强牌和再加注，翻牌后也更常失去位置优势。按钮位的范围通常可以更宽，但这不是任何底牌都能盈利入池的保证。'),
    question('range-combinations', '范围 · 按组合和频率判断',
      '河牌对手的当前下注范围中，有 20 个你能击败的诈唬组合、60 个你打不过的价值组合；各组合到达这个节点的概率相同。若跟注门槛为 30%，应如何判断？',
      '无平局，所有 80 个组合等权；你只赢诈唬、输给全部价值组合；仅比较跟注和弃牌。',
      '胜率 25%，低于门槛，应弃牌',
      ['胜率 33.3%，高于门槛，应跟注', '价值和诈唬是两种类型，所以胜率为 50%', '出现过一次诈唬就应跟注'],
      '胜率 = 20 ÷ (20 + 60) = 25%；25% < 30%。',
      '不能把“诈唬”与“价值”两个标签当成各占一半。真实范围应按组合到达当前节点的行动频率加权，本题特意给出等权条件，才可以直接数 20 / 80。'),
  ]);

  // This private generator never calls Math.random, so quiz order cannot
  // advance or alter the card game's random stream.
  function makeRandom(seed) {
    let value = Number(seed) >>> 0;
    return function () {
      value = (value + 0x6D2B79F5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items, random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function createSession(seed) {
    const random = makeRandom(seed);
    const records = new Map();
    let order, index, selectedId, status, solvedThisRound;
    let round = 0;

    function beginRound() {
      round++;
      order = shuffle(QUESTIONS, random).map(q => ({ ...q, choices: shuffle(q.choices, random) }));
      index = 0;
      selectedId = null;
      status = 'question';
      solvedThisRound = new Set();
    }

    function view() {
      const firstAnswered = records.size;
      const firstCorrect = [...records.values()].filter(r => r.firstCorrect).length;
      const corrected = [...records.values()].filter(r => !r.firstCorrect && r.solved).length;
      const q = status === 'complete' ? null : order[index];
      const record = q ? records.get(q.id) : null;
      return {
        status, round, number: Math.min(index + 1, QUESTIONS.length), total: QUESTIONS.length,
        firstAnswered, firstCorrect, corrected, roundCompleted: solvedThisRound.size,
        selectedId, attempts: record ? record.attempts : 0,
        questionFirstCorrect: record ? record.firstCorrect : null,
        question: q ? { ...q, choices: q.choices.map(choice => ({ ...choice })) } : null,
        review: QUESTIONS.filter(item => records.has(item.id) && !records.get(item.id).firstCorrect).map(item => ({
          id: item.id, topic: item.topic, answer: item.choices.find(c => c.id === item.correctId).text,
          calculation: item.calculation, explanation: item.explanation,
        })),
      };
    }

    function answer(choiceId) {
      if (status !== 'question') throw new Error('请先重试或进入下一题。');
      const q = order[index];
      if (!q.choices.some(c => c.id === choiceId)) throw new Error('请选择本题提供的答案。');
      const correct = choiceId === q.correctId;
      if (!records.has(q.id)) records.set(q.id, { firstCorrect: correct, attempts: 0, solved: false });
      const record = records.get(q.id);
      record.attempts++;
      if (correct) {
        record.solved = true;
        solvedThisRound.add(q.id);
      }
      selectedId = choiceId;
      status = correct ? 'correct' : 'wrong';
      return view();
    }

    function retry() {
      if (status !== 'wrong') throw new Error('只有答错后才能重试。');
      status = 'question';
      selectedId = null;
      return view();
    }

    function next() {
      if (status !== 'correct') throw new Error('请先完成本题或订正答案。');
      index++;
      selectedId = null;
      status = index >= order.length ? 'complete' : 'question';
      return view();
    }

    function again() {
      if (status !== 'complete') throw new Error('完成本轮后可以再练一轮。');
      beginRound(); // First-answer records intentionally survive every new round.
      return view();
    }

    beginRound();
    return { view, answer, retry, next, again };
  }

  let fallbackCounter = 0;
  function freshSeed() {
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      const values = new Uint32Array(1);
      root.crypto.getRandomValues(values);
      return values[0];
    }
    fallbackCounter++;
    return (Date.now() ^ Math.imul(fallbackCounter, 0x9E3779B9)) >>> 0;
  }

  let session = null;

  function element(tag, className, text) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function render(focusArea) {
    const host = root.document && root.document.getElementById('drills-root');
    if (!host || !session) return false;
    const state = session.view();
    const app = element('div', 'drill-app');
    const header = element('header', 'drill-header');
    const title = element('h2', 'drill-title', '牌技小测');
    title.id = 'drill-title';
    header.append(title, element('p', 'drill-intro', '12 道虚拟筹码练习 · 先判断，再看计算与解释。'));
    const score = element('p', 'drill-score', `首次掌握 ${state.firstCorrect} / ${state.total} · 已首答 ${state.firstAnswered} 题`);
    score.setAttribute('aria-live', 'polite');
    const progressText = element('p', 'drill-progress', `第 ${state.round} 轮 · 本轮完成 ${state.roundCompleted} / ${state.total} 题`);
    const progress = element('progress', 'drill-progress-bar');
    progress.max = state.total;
    progress.value = state.roundCompleted;
    progress.setAttribute('aria-label', '本轮已完成题数');
    header.append(score, progressText, progress);
    app.append(header);
    let focusNode;

    if (state.status === 'complete') {
      const summary = element('section', 'drill-summary');
      const heading = element('h3', 'drill-summary-title', '本轮完成');
      heading.tabIndex = -1;
      summary.append(heading,
        element('p', 'drill-summary-score', `首次作答掌握 ${state.firstCorrect} / ${state.total} 题`),
        element('p', 'drill-summary-detail', `首答错误后已订正 ${state.corrected} 题。再练不会重置首次作答记录，也不会靠重做提高首答成绩。`));
      if (state.review.length) {
        const review = element('div', 'drill-review');
        review.append(element('h4', 'drill-review-title', '这些题值得再巩固'));
        state.review.forEach(item => {
          const details = element('details', 'drill-review-item');
          details.append(element('summary', 'drill-review-topic', item.topic),
            element('p', 'drill-review-answer', `正确答案：${item.answer}`),
            element('p', 'drill-calculation', item.calculation),
            element('p', 'drill-explanation', item.explanation));
          review.append(details);
        });
        summary.append(review);
      } else {
        summary.append(element('p', 'drill-summary-detail', '所有题首次作答均正确。可以换个顺序再巩固，保持对条件和分母口径的检查。'));
      }
      const actions = element('div', 'drill-actions');
      actions.append(button('再练一轮（保留首答记录）', 'drill-again', () => { session.again(); render('question'); }));
      summary.append(actions);
      app.append(summary);
      focusNode = heading;
    } else {
      const q = state.question;
      const block = element('section', 'drill-question');
      const heading = element('h3', 'drill-question-title', `第 ${state.number} / ${state.total} 题 · ${q.topic}`);
      heading.id = 'drill-question-title';
      heading.tabIndex = -1;
      const prompt = element('p', 'drill-prompt', q.prompt);
      const assumptions = element('p', 'drill-assumptions', `条件：${q.assumptions}`);
      assumptions.id = 'drill-assumptions';
      block.append(heading, prompt, assumptions);
      if (state.attempts > 0 && state.status === 'question') {
        block.append(element('p', 'drill-attempt-note', state.questionFirstCorrect ? '本题首答已掌握；本轮继续巩固，不改变首答记录。' : '这次是巩固练习；订正后可继续，首答记录保持不变。'));
      }
      const options = element('fieldset', 'drill-options');
      options.append(element('legend', 'drill-legend', '选择一个答案'));
      q.choices.forEach((choice, i) => {
        let className = 'drill-option';
        if (state.status !== 'question' && choice.id === q.correctId) className += ' drill-correct';
        if (state.status === 'wrong' && choice.id === state.selectedId) className += ' drill-wrong';
        const option = button(`${String.fromCharCode(65 + i)}. ${choice.text}`, className, () => { session.answer(choice.id); render('feedback'); });
        option.disabled = state.status !== 'question';
        option.setAttribute('aria-describedby', 'drill-assumptions');
        options.append(option);
      });
      block.append(options);
      focusNode = heading;
      if (state.status === 'correct' || state.status === 'wrong') {
        const feedback = element('section', `drill-feedback ${state.status === 'correct' ? 'drill-correct' : 'drill-wrong'}`);
        feedback.setAttribute('aria-live', 'polite');
        const feedbackHeading = element('h4', 'drill-feedback-title', state.status === 'correct' ? '答对了' : '先看推导，再试一次');
        feedbackHeading.tabIndex = -1;
        feedback.append(feedbackHeading,
          element('p', 'drill-feedback-summary', `本题首次作答：${state.questionFirstCorrect ? '已掌握' : '待巩固'}。订正与重练不改变这个记录。`),
          element('p', 'drill-correct-answer', `正确答案：${q.choices.find(c => c.id === q.correctId).text}`),
          element('p', 'drill-calculation', q.calculation),
          element('p', 'drill-explanation', q.explanation));
        block.append(feedback);
        const actions = element('div', 'drill-actions');
        if (state.status === 'wrong') {
          actions.append(button('再试这题', 'drill-retry', () => { session.retry(); render('question'); }));
        } else {
          actions.append(button(state.number === state.total ? '查看本轮结果' : '下一题', 'drill-next', () => { session.next(); render('question'); }));
        }
        block.append(actions);
        if (focusArea === 'feedback') focusNode = feedbackHeading;
      }
      app.append(block);
    }
    host.replaceChildren(app);
    if (focusNode && typeof focusNode.focus === 'function') focusNode.focus();
    return true;
  }

  function start() {
    if (!root.document || !root.document.getElementById('drills-root')) return false;
    if (!session) session = createSession(freshSeed());
    return render('question'); // Closing and reopening a dialog resumes this session.
  }

  root.PokerDrills = Object.freeze({ start });
  if (typeof module === 'object' && module.exports) module.exports = { QUESTIONS, createSession, makeRandom };
})(typeof globalThis !== 'undefined' ? globalThis : window);
