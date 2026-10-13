const DEFAULT_CRITERIA = ['经济余量', '时间自由', '成长空间', '内心踏实'];
const PATH_COLORS = { a: '#f8a568', b: '#a7a0ff', c: '#8ed6be' };
const DIMENSION_LIBRARY = {
  通用: ['现实可行', '长期价值', '风险可控', '可逆性', '身心健康', '关系支持'],
  工作: ['收入稳定', '成长空间', '工作强度', '团队氛围', '自主程度', '职业前景'],
  居住: ['生活成本', '通勤便利', '家人距离', '城市活力', '环境舒适', '医疗便利'],
  学习: ['学习兴趣', '投入时间', '实践机会', '未来用途', '学习资源', '持续动力'],
  消费: ['价格承受', '使用频率', '品质可靠', '维护成本', '转卖可能', '真实需要']
};

const PRESETS = {
  career: { question: '要不要换一份工作？', a: '换一份工作', b: '留在现在的岗位', scores: { a: [5, 6, 9, 5], b: [8, 7, 5, 8] }, weights: [3, 2, 4, 3] },
  city: { question: '要不要搬去一座新的城市？', a: '去新的城市', b: '留在熟悉的地方', scores: { a: [5, 6, 9, 5], b: [8, 8, 5, 8] }, weights: [3, 2, 4, 3] },
  study: { question: '现在要不要投入时间继续学习？', a: '开始一段系统学习', b: '保持现在的节奏', scores: { a: [5, 4, 9, 7], b: [8, 8, 5, 7] }, weights: [3, 3, 5, 2] }
};

const STORAGE_KEY = 'forking-paths-v1';
const SNAPSHOT_KEY = 'forking-paths-snapshots-v1';
const $ = selector => document.querySelector(selector);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));
let state = loadState();
let snapshots = loadSnapshots();
let toastTimer;
let undoAction = null;
let currentLibrary = '通用';
let previousLeader = null;

function activePaths() { return state.hasThird ? ['a', 'b', 'c'] : ['a', 'b']; }

function cleanText(value, fallback, max) {
  return typeof value === 'string' ? (value.trim().slice(0, max) || fallback) : fallback;
}

function normalize(input) {
  const base = PRESETS.career;
  if (!input || typeof input !== 'object') input = base;
  const raw = Array.isArray(input.criteria) ? input.criteria.slice(0, 8) : DEFAULT_CRITERIA;
  const criteria = raw.length >= 2 ? raw.map((label, i) => cleanText(label, `维度 ${i + 1}`, 12)) : DEFAULT_CRITERIA.slice();
  const normalizeScores = path => criteria.map((_, i) => {
    const value = input.scores?.[path]?.[i];
    return value === null ? null : clamp(value ?? base.scores[path]?.[i] ?? 5, 1, 10);
  });
  return {
    question: cleanText(input.question, base.question, 80),
    a: cleanText(input.a, base.a, 32),
    b: cleanText(input.b, base.b, 32),
    c: cleanText(input.c, '先试一小步', 32),
    hasThird: input.hasThird === true,
    criteria,
    scores: {
      a: normalizeScores('a'), b: normalizeScores('b'), c: normalizeScores('c')
    },
    lastScores: Object.fromEntries(['a', 'b', 'c'].map(path => [path, criteria.map((_, i) => clamp(input.lastScores?.[path]?.[i] ?? input.scores?.[path]?.[i] ?? base.scores[path]?.[i] ?? 5, 1, 10))])),
    weights: criteria.map((_, i) => clamp(input.weights?.[i] ?? base.weights[i] ?? 3, 1, 5)),
    minimums: criteria.map((_, i) => input.minimums?.[i] == null ? null : clamp(input.minimums[i], 1, 10)),
    notes: Object.fromEntries(['a', 'b', 'c'].map(path => [path, criteria.map((_, i) => typeof input.notes?.[path]?.[i] === 'string' ? input.notes[path][i].slice(0, 140) : '')]))
  };
}

function loadSnapshots() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item.id === 'string' && item.state && Number.isFinite(item.createdAt) && item.createdAt > 0 && item.createdAt < 8640000000000000).slice(0, 20)
      .map(item => ({ id: item.id, createdAt: item.createdAt, state: normalize(item.state) }));
  } catch { return []; }
}

function saveSnapshots() {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots)); return true; }
  catch { showToast('浏览器未允许保存，请检查本机存储空间或隐私设置。'); return false; }
}

function decodeShared(value) {
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

function loadState() {
  const shared = new URLSearchParams(location.search).get('s');
  if (shared) {
    const decoded = decodeShared(shared);
    if (decoded) return normalize(decoded);
  }
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return normalize(PRESETS.career); }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { return; /* Private browsing may disable storage. */ }
  const url = new URL(location.href);
  if (url.searchParams.has('s')) {
    url.searchParams.delete('s');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}

function sliderFill(element) {
  const pct = ((Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min))) * 100;
  element.style.setProperty('--fill', `${pct}%`);
}

function makeSlider({ id, label, value, max, onInput }) {
  const row = document.createElement('div');
  row.className = id.startsWith('weight') ? 'priority-row' : 'factor-row';
  const labelEl = document.createElement('label');
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'range'; input.id = id; input.min = '1'; input.max = String(max); input.step = '1'; input.value = String(value);
  input.setAttribute('aria-label', `${label}：${id.startsWith('weight') ? '重要程度' : '这条路的评分'}`);
  const output = document.createElement('output');
  output.htmlFor = id;
  output.textContent = id.startsWith('weight') ? `${value} / 5` : `${value}`;
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = id.startsWith('weight') ? `${next} / 5` : `${next}`;
    sliderFill(input);
    onInput(next);
    updateResult(); saveState();
  });
  row.append(labelEl, input, output);
  sliderFill(input);
  return row;
}

function makeScoreRow(path, label, i) {
  const item = document.createElement('div'); item.className = 'score-item';
  const row = document.createElement('div'); row.className = 'factor-row';
  const id = `${path}-${i}`;
  const name = document.createElement('label'); name.htmlFor = id; name.textContent = label;
  const slider = document.createElement('input');
  slider.type = 'range'; slider.id = id; slider.min = '1'; slider.max = '10'; slider.step = '1';
  slider.value = String(state.scores[path][i] ?? 5);
  slider.disabled = state.scores[path][i] === null;
  slider.setAttribute('aria-label', `${state[path]}：${label}的评分`);
  const output = document.createElement('output'); output.htmlFor = id; output.textContent = state.scores[path][i] ?? '—';
  const unknown = document.createElement('button'); unknown.type = 'button'; unknown.className = 'unknown-button';
  unknown.textContent = state.scores[path][i] === null ? '补评分' : '还不知道';
  unknown.setAttribute('aria-pressed', String(state.scores[path][i] === null));
  unknown.setAttribute('aria-label', `${state[path]}的${label}${state.scores[path][i] === null ? '：补评分' : '：标记为还不知道'}`);
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    state.scores[path][i] = value;
    state.lastScores[path][i] = value;
    output.textContent = String(value);
    sliderFill(slider);
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    updateResult(); saveState();
  });
  unknown.addEventListener('click', () => {
    if (state.scores[path][i] === null) state.scores[path][i] = state.lastScores[path][i];
    else { state.lastScores[path][i] = state.scores[path][i]; state.scores[path][i] = null; }
    renderControls(); saveState();
  });
  row.append(name, slider, output, unknown);
  sliderFill(slider);
  const note = document.createElement('details'); note.className = 'score-note';
  const summary = document.createElement('summary'); summary.textContent = state.notes[path][i] ? '已写评分依据' : '写评分依据';
  const textarea = document.createElement('textarea'); textarea.maxLength = 140; textarea.rows = 2;
  textarea.value = state.notes[path][i]; textarea.placeholder = '例如：目前的通勤时间大概能减少一半';
  textarea.setAttribute('aria-label', `${state[path]}在${label}上的评分依据`);
  textarea.addEventListener('input', () => {
    state.notes[path][i] = textarea.value.slice(0, 140);
    summary.textContent = state.notes[path][i] ? '已写评分依据' : '写评分依据';
    saveState();
  });
  note.append(summary, textarea);
  item.append(row, note);
  return item;
}

function renderControls() {
  $('#questionInput').value = state.question;
  $('#optionA').value = state.a;
  $('#optionB').value = state.b;
  $('#optionC').value = state.c;
  $('#pathC').hidden = !state.hasThird;
  $('#pathGrid').classList.toggle('three', state.hasThird);
  $('#thirdPathButton').textContent = state.hasThird ? '移除第三条路 −' : '添加第三条路 ＋';
  $('#scoreChipC').hidden = !state.hasThird;
  $('#legendItemC').hidden = !state.hasThird;
  ['a', 'b', 'c'].forEach(path => {
    const target = $(`#factors${path.toUpperCase()}`);
    target.replaceChildren(...state.criteria.map((label, i) => makeScoreRow(path, label, i)));
  });
  $('#priorityPanel').replaceChildren(...state.criteria.map((label, i) => makeSlider({
    id: `weight-${i}`, label, value: state.weights[i], max: 5,
    onInput: value => { state.weights[i] = value; }
  })));
  renderCriteriaEditor();
  renderLibrary();
  const active = Object.keys(PRESETS).find(key => JSON.stringify(normalize(PRESETS[key])) === JSON.stringify(state));
  document.querySelectorAll('.preset').forEach(button => button.classList.toggle('active', button.dataset.preset === active));
  updateResult();
}

function renderCriteriaEditor() {
  const editor = $('#criteriaEditor');
  editor.replaceChildren(...state.criteria.map((label, i) => {
    const row = document.createElement('div');
    row.className = 'criterion-edit';
    const number = document.createElement('span'); number.textContent = String(i + 1).padStart(2, '0');
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 12; input.value = label;
    input.setAttribute('aria-label', `第 ${i + 1} 项评价维度`);
    input.addEventListener('change', () => {
      state.criteria[i] = cleanText(input.value, label, 12);
      renderControls(); saveState();
    });
    const minimum = document.createElement('button'); minimum.type = 'button'; minimum.className = 'minimum-toggle';
    minimum.textContent = state.minimums[i] === null ? '设底线' : '底线';
    minimum.setAttribute('aria-pressed', String(state.minimums[i] !== null));
    minimum.setAttribute('aria-label', `${label}${state.minimums[i] === null ? '：设为必须满足的底线' : '：取消底线'}`);
    minimum.addEventListener('click', () => { state.minimums[i] = state.minimums[i] === null ? 6 : null; renderControls(); saveState(); });
    const select = document.createElement('select'); select.className = 'minimum-select';
    select.setAttribute('aria-label', `${label}的最低分`);
    select.hidden = state.minimums[i] === null;
    for (let value = 1; value <= 10; value += 1) {
      const option = document.createElement('option'); option.value = String(value); option.textContent = `至少 ${value} 分`; select.append(option);
    }
    select.value = String(state.minimums[i] ?? 6);
    select.addEventListener('change', () => { state.minimums[i] = Number(select.value); updateResult(); saveState(); });
    const up = document.createElement('button'); up.type = 'button'; up.className = 'reorder-criterion'; up.textContent = '↑'; up.disabled = i === 0;
    up.setAttribute('aria-label', `将${label}上移`);
    up.addEventListener('click', () => moveCriterion(i, -1));
    const down = document.createElement('button'); down.type = 'button'; down.className = 'reorder-criterion'; down.textContent = '↓'; down.disabled = i === state.criteria.length - 1;
    down.setAttribute('aria-label', `将${label}下移`);
    down.addEventListener('click', () => moveCriterion(i, 1));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'remove-criterion'; remove.textContent = '移除';
    remove.disabled = state.criteria.length <= 2;
    remove.setAttribute('aria-label', `移除${label}`);
    remove.addEventListener('click', () => {
      state.criteria.splice(i, 1);
      ['a', 'b', 'c'].forEach(path => { state.scores[path].splice(i, 1); state.lastScores[path].splice(i, 1); state.notes[path].splice(i, 1); });
      state.weights.splice(i, 1); state.minimums.splice(i, 1);
      renderControls(); saveState();
    });
    row.append(number, input, minimum, select, up, down, remove);
    return row;
  }));
  $('#addCriterion').disabled = state.criteria.length >= 8;
}

function moveCriterion(i, direction) {
  const j = i + direction;
  for (const array of [state.criteria, state.weights, state.minimums, ...['a', 'b', 'c'].flatMap(path => [state.scores[path], state.lastScores[path], state.notes[path]])]) {
    [array[i], array[j]] = [array[j], array[i]];
  }
  renderControls(); saveState();
}

function addCriterion(label) {
  if (state.criteria.length >= 8) { showToast('最多保留 8 项维度，可以先移除不需要的项目。'); return false; }
  if (state.criteria.includes(label)) { showToast('这个维度已经在列表中了。'); return false; }
  state.criteria.push(label); state.weights.push(3); state.minimums.push(null);
  ['a', 'b', 'c'].forEach(path => { state.scores[path].push(5); state.lastScores[path].push(5); state.notes[path].push(''); });
  renderControls(); saveState();
  return true;
}

function renderLibrary() {
  $('#libraryTabs').replaceChildren(...Object.keys(DIMENSION_LIBRARY).map(category => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = category;
    button.className = category === currentLibrary ? 'active' : '';
    button.setAttribute('aria-pressed', String(category === currentLibrary));
    button.addEventListener('click', () => { currentLibrary = category; renderLibrary(); });
    return button;
  }));
  $('#libraryItems').replaceChildren(...DIMENSION_LIBRARY[currentLibrary].map(label => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${label} ＋`;
    button.disabled = state.criteria.includes(label) || state.criteria.length >= 8;
    button.addEventListener('click', () => { if (addCriterion(label)) showToast(`已添加「${label}」。`); });
    return button;
  }));
}

function evaluateState(draft = state) {
  const keys = draft.hasThird ? ['a', 'b', 'c'] : ['a', 'b'];
  const comparable = draft.criteria.map((_, i) => i).filter(i => keys.every(path => draft.scores[path][i] !== null));
  const total = comparable.reduce((sum, i) => sum + draft.weights[i], 0);
  const scores = Object.fromEntries(keys.map(path => [path, total ? comparable.reduce((sum, i) => sum + draft.scores[path][i] * draft.weights[i], 0) / total : null]));
  const failures = Object.fromEntries(keys.map(path => [path, draft.criteria.map((_, i) => i).filter(i => draft.minimums[i] !== null && draft.scores[path][i] !== null && draft.scores[path][i] < draft.minimums[i])]));
  const pending = Object.fromEntries(keys.map(path => [path, draft.criteria.map((_, i) => i).filter(i => draft.minimums[i] !== null && draft.scores[path][i] === null)]));
  const eligible = keys.filter(path => scores[path] !== null && !failures[path].length && !pending[path].length).sort((a, b) => scores[b] - scores[a]);
  return { keys, comparable, scores, failures, pending, eligible, leader: eligible[0] ?? null, runner: eligible[1] ?? null };
}

function setSvgElement(name, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  if (text !== undefined) el.textContent = text;
  return el;
}

function drawDiagram() {
  const svg = $('#pathDiagram');
  svg.replaceChildren();
  const xs = state.criteria.map((_, i) => 95 + i * 705 / (state.criteria.length - 1));
  const y = value => 242 - (value - 1) * 19;
  [75, 155, 235].forEach((yy, i) => {
    svg.append(setSvgElement('line', { x1: 45, y1: yy, x2: 850, y2: yy, stroke: '#42414f', 'stroke-width': 1, 'stroke-dasharray': i === 1 ? '3 7' : '2 8', opacity: .65 }));
  });
  xs.forEach((x, i) => {
    svg.append(setSvgElement('line', { x1: x, y1: 58, x2: x, y2: 245, stroke: '#3d3e4b', 'stroke-width': 1 }));
    svg.append(setSvgElement('text', { x, y: 284, fill: '#a5a6b6', 'text-anchor': 'middle', 'font-size': 13, 'font-family': 'Noto Sans SC, sans-serif' }, state.criteria[i].length > 5 ? `${state.criteria[i].slice(0, 5)}…` : state.criteria[i]));
  });
  [...activePaths()].reverse().forEach(path => {
    const color = PATH_COLORS[path];
    const points = state.scores[path].map((value, i) => value === null ? null : [xs[i], y(value)]);
    let previousKnown = false;
    const d = points.map(point => {
      if (!point) { previousKnown = false; return ''; }
      const segment = `${previousKnown ? 'L' : 'M'} ${point[0]} ${point[1]}`;
      previousKnown = true; return segment;
    }).join(' ');
    svg.append(setSvgElement('path', { d, fill: 'none', stroke: color, 'stroke-width': 12, opacity: .08, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    svg.append(setSvgElement('path', { d, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    points.forEach((point, i) => {
      if (!point) {
        svg.append(setSvgElement('text', { x: xs[i], y: 164, fill: color, 'text-anchor': 'middle', 'font-size': 18 }, '?'));
        return;
      }
      const [x, yy] = point;
      svg.append(setSvgElement('circle', { cx: x, cy: yy, r: 7, fill: '#242431', stroke: color, 'stroke-width': 3 }));
      svg.append(setSvgElement('text', { x, y: yy - 17, fill: color, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, 'font-family': 'DM Sans, sans-serif' }, String(state.scores[path][i])));
    });
  });
  svg.setAttribute('aria-label', `${activePaths().map(path => state[path]).join('、')}在${state.criteria.join('、')}上的评分对比；问号表示还不知道`);
}

function findTurningPoint(base) {
  if (!base.leader || !base.runner || base.keys.some(path => state.scores[path].some(score => score === null))) return null;
  if (base.scores[base.leader] - base.scores[base.runner] < .35) return null;
  const candidates = [];
  for (const path of base.keys) {
    state.criteria.forEach((label, i) => {
      for (let target = 1; target <= 10; target += 1) {
        const original = state.scores[path][i];
        if (target === original) continue;
        const draft = structuredClone(state);
        draft.scores[path][i] = target;
        const next = evaluateState(draft);
        if (next.leader && next.leader !== base.leader && (!next.runner || next.scores[next.leader] - next.scores[next.runner] > .01))
          candidates.push({ path, label, original, target, steps: Math.abs(target - original), newLeader: next.leader });
      }
    });
  }
  candidates.sort((x, y) => x.steps - y.steps || Math.abs(x.target - 5) - Math.abs(y.target - 5));
  return candidates[0] || null;
}

function updateResult() {
  const result = evaluateState();
  const { keys, comparable, scores, failures, pending, eligible, leader, runner } = result;
  const close = leader && runner && scores[leader] - scores[runner] < .35;
  for (const path of keys) {
    const suffix = path.toUpperCase();
    $(`#score${suffix}`).textContent = scores[path] === null ? '—' : scores[path].toFixed(1);
    $(`#scoreLabel${suffix}`).textContent = state[path];
    $(`#legend${suffix}`).textContent = state[path];
    const chip = $(`#score${suffix}`).closest('.score-chip');
    chip.classList.toggle('blocked', failures[path].length > 0);
    chip.classList.toggle('pending', pending[path].length > 0);
    chip.title = failures[path].length ? `未达到${failures[path].map(i => state.criteria[i]).join('、')}的底线` : pending[path].length ? '底线项目还有未知评分' : '';
  }
  const liveScores = $('#liveScores');
  liveScores.replaceChildren(...keys.map(path => {
    const chip = document.createElement('span'); chip.className = `live-score ${path}${path === leader ? ' leading' : ''}${failures[path].length ? ' blocked' : ''}`;
    chip.textContent = `${state[path]} ${scores[path] === null ? '—' : scores[path].toFixed(1)}${failures[path].length ? ' · 未达底线' : pending[path].length ? ' · 底线待评' : ''}`;
    return chip;
  }));
  const liveText = !comparable.length ? '先补充共同评分' : !eligible.length ? '暂无满足底线的路' : close ? '前两条路很接近' : `目前偏向 ${state[leader]}`;
  if ($('#liveLeader').textContent !== liveText) $('#liveLeader').textContent = liveText;
  if (previousLeader !== null && previousLeader !== leader) {
    $('#liveReadout').classList.remove('shifted'); void $('#liveReadout').offsetWidth; $('#liveReadout').classList.add('shifted');
  }
  previousLeader = leader;
  $('#resultTitle').textContent = !comparable.length ? '还需要一点信息' : !eligible.length ? '还没有路满足你的底线' : close ? '前两条路，仍然很接近' : `你目前更倾向「${state[leader]}」`;
  const coverage = comparable.length < state.criteria.length ? `目前有 ${comparable.length} / ${state.criteria.length} 项可以共同比较；“还不知道”的项目暂不计入所有方案。` : '';
  const bottomLine = keys.filter(path => failures[path].length).map(path => `「${state[path]}」未达到${failures[path].map(i => `「${state.criteria[i]}」`).join('、')}的底线`).join('；');
  const leadText = runner ? `「${state[leader]}」领先「${state[runner]}」 ${(scores[leader] - scores[runner]).toFixed(1)} 分` : `目前只有「${state[leader]}」满足底线`;
  $('#resultCopy').textContent = !comparable.length ? '请为每条路至少填写同一项评分，才能进行比较。'
    : !eligible.length ? `${bottomLine || '有底线项目仍未评分'}。你可以调整评分或底线。${coverage}`
      : close ? `你给最接近的两条路的综合评分差距很小。${coverage}`
        : `按照当前评分与权重，${leadText}。${bottomLine ? `${bottomLine}。` : ''}${coverage}`;
  const insight = $('#insight');
  insight.replaceChildren();
  const strong = document.createElement('strong');
  if (comparable.length) {
    const comparedFrom = leader ?? keys[0];
    const comparedWith = runner ?? keys.find(path => path !== comparedFrom) ?? keys[1];
    const differences = comparable.map(i => ({ i, gap: (state.scores[comparedFrom][i] - state.scores[comparedWith][i]) * state.weights[i] }));
    differences.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));
    const biggest = differences[0];
    strong.textContent = `${state.criteria[biggest.i]}是当前差异较大的维度。`;
    insight.append(strong, document.createTextNode(biggest.gap === 0 ? '这项评分相同，可以继续看看尚未评价的条件。' : `在这项上，「${state[biggest.gap > 0 ? comparedFrom : comparedWith]}」的评分更高。`));
  } else { strong.textContent = '尚无可比较的维度。'; insight.append(strong, document.createTextNode('为每条路填写同一项评分后，这里会显示差异。')); }
  const turning = $('#turningPoint');
  turning.replaceChildren();
  const turnLabel = document.createElement('span'); turnLabel.className = 'turning-label'; turnLabel.textContent = '如果想换个角度';
  const turnText = document.createElement('p');
  const point = findTurningPoint(result);
  turnText.textContent = !comparable.length ? '先补充共同评分，再观察可能改变倾向的条件。'
    : keys.some(path => state.scores[path].some(score => score === null)) ? '补上“还不知道”的评分后，可以更准确地寻找翻转点。'
      : !leader ? '先检查你设定的底线，看看是否过于严格。'
        : !runner ? '当前只有一条路满足底线，可以检查最低要求或其他方案的评分。'
          : close ? '前两条路已经十分接近，调整一项评分就可能改变倾向。'
          : point ? `如果将「${state[point.path]}」的「${point.label}」从 ${point.original} 分调整到 ${point.target} 分，倾向会转向「${state[point.newLeader]}」。`
            : '单独调整一项评分无法改变当前倾向；可以重新考虑几项评分或重要程度。';
  turning.append(turnLabel, turnText);
  drawDiagram();
}

function showToast(message, action = null) {
  const toast = $('#toast');
  $('#toastMessage').textContent = message;
  undoAction = action;
  $('#undoButton').hidden = !action;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); undoAction = null; }, action ? 6000 : 3200);
}

function renderSnapshots() {
  const list = $('#snapshotList');
  if (!snapshots.length) {
    const empty = document.createElement('div');
    empty.className = 'snapshot-empty';
    empty.innerHTML = '<span aria-hidden="true">✳</span><strong>这里还没有路口</strong><p>当你想留住一个决定时，点一下「保存这一刻」。</p>';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...snapshots.map((item, index) => {
    const card = document.createElement('article'); card.className = 'snapshot-card';
    const top = document.createElement('div'); top.className = 'snapshot-top';
    const number = document.createElement('span'); number.textContent = `路口 ${String(snapshots.length - index).padStart(2, '0')}`;
    const date = document.createElement('time'); date.dateTime = new Date(item.createdAt).toISOString();
    date.textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(item.createdAt);
    top.append(number, date);
    const title = document.createElement('h3'); title.textContent = item.state.question;
    const routes = document.createElement('p'); routes.className = 'snapshot-routes'; routes.textContent = (item.state.hasThird ? ['a', 'b', 'c'] : ['a', 'b']).map(path => item.state[path]).join('  ↗  ');
    const actions = document.createElement('div'); actions.className = 'snapshot-actions';
    const open = document.createElement('button'); open.type = 'button'; open.textContent = '重新打开 ↗';
    open.addEventListener('click', () => { state = normalize(item.state); renderControls(); saveState(); window.scrollTo({ top: 0, behavior: 'smooth' }); showToast('已打开这个路口，你可以继续修改。'); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'snapshot-delete'; remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除快照：${item.state.question}`);
    remove.addEventListener('click', () => {
      const previous = snapshots.slice();
      snapshots = snapshots.filter(snapshot => snapshot.id !== item.id);
      if (saveSnapshots()) {
        renderSnapshots();
        showToast('快照已删除。', () => { snapshots = previous; saveSnapshots(); renderSnapshots(); });
      } else snapshots = previous;
    });
    actions.append(open, remove); card.append(top, title, routes, actions);
    return card;
  }));
}

function saveSnapshot() {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), state: normalize(state) };
  const previous = snapshots.slice();
  snapshots.unshift(item); snapshots = snapshots.slice(0, 20);
  if (saveSnapshots()) { renderSnapshots(); showToast('这一刻已保存，在页面底部可以找回。'); }
  else snapshots = previous;
}

function encodeState(payload = state) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function shareCurrent() {
  const url = new URL(location.href);
  const { notes, lastScores, ...shared } = state;
  url.searchParams.set('s', encodeState(shared));
  url.hash = '';
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('分享链接已复制，打开的人会看到这份选择。');
  } catch {
    window.prompt('复制这条分享链接：', url.toString());
  }
}

function roundedRect(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  let line = '';
  let lines = 0;
  for (const char of text) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines += 1; line = '';
      if (lines >= maxLines) return;
    }
    line += char;
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
}

function exportCard() {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 675;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 1200, 675);
  bg.addColorStop(0, '#22232f'); bg.addColorStop(1, '#11141e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 675);
  ctx.fillStyle = '#f8a568'; ctx.fillRect(72, 74, 34, 3);
  ctx.font = '700 24px Noto Sans SC, sans-serif'; ctx.fillStyle = '#f7f1ed'; ctx.fillText('分岔路口', 72, 126);
  ctx.font = '500 17px Noto Sans SC, sans-serif'; ctx.fillStyle = '#acaab8'; ctx.fillText('一张属于我的选择地图', 72, 163);
  ctx.font = '700 39px Noto Sans SC, sans-serif'; ctx.fillStyle = '#fff8f1';
  wrapText(ctx, state.question, 72, 239, 1040, 51, 2);
  const keys = activePaths();
  const result = evaluateState();
  const cardWidth = (1056 - (keys.length - 1) * 16) / keys.length;
  const cards = keys.map((key, i) => ({ key, x: 72 + i * (cardWidth + 16), color: PATH_COLORS[key] }));
  cards.forEach(card => {
    roundedRect(ctx, card.x, 325, cardWidth, 200, 16, card.key === 'a' ? '#342a2d' : card.key === 'b' ? '#292838' : '#23332f');
    ctx.fillStyle = card.color; ctx.font = '700 17px DM Sans, sans-serif'; ctx.fillText(`PATH 0${keys.indexOf(card.key) + 1}`, card.x + 24, 366);
    ctx.fillStyle = '#f8f5f3'; ctx.font = `700 ${keys.length === 3 ? 22 : 27}px Noto Sans SC, sans-serif`;
    wrapText(ctx, state[card.key], card.x + 24, 412, cardWidth - 110, 34, 2);
    ctx.fillStyle = card.color; ctx.font = '700 39px DM Sans, sans-serif';
    ctx.fillText(result.scores[card.key] === null ? '—' : result.scores[card.key].toFixed(1), card.x + cardWidth - 93, 486);
  });
  ctx.fillStyle = '#aaabb9'; ctx.font = '400 16px Noto Sans SC, sans-serif';
  ctx.fillText('只比较共同已评分的维度；底线单独判断。它帮我看清权衡，而不是预测未来。', 72, 589);
  ctx.fillStyle = '#6f7283'; ctx.font = '500 15px DM Sans, sans-serif'; ctx.fillText('FORKING PATHS  /  MY DECISION MAP', 72, 630);
  const link = document.createElement('a');
  link.download = '分岔路口-选择卡.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('选择卡已导出。');
}

function init() {
  renderControls();
  renderSnapshots();
  $('#undoButton').addEventListener('click', () => {
    const action = undoAction; undoAction = null;
    if (action) { action(); showToast('已撤销，之前的内容已恢复。'); }
  });
  $('#questionInput').addEventListener('input', event => { state.question = event.target.value.slice(0, 80); saveState(); });
  [['#optionA', 'a'], ['#optionB', 'b'], ['#optionC', 'c']].forEach(([selector, key]) => {
    $(selector).addEventListener('input', event => { state[key] = event.target.value.slice(0, 32); updateResult(); saveState(); });
    $(selector).addEventListener('blur', event => { state[key] = cleanText(state[key], key === 'a' ? '第一条路' : key === 'b' ? '第二条路' : '第三条路', 32); event.target.value = state[key]; renderControls(); saveState(); });
  });
  $('#questionInput').addEventListener('blur', event => { state.question = cleanText(state.question, '我正在考虑一个选择', 80); event.target.value = state.question; saveState(); });
  document.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => {
    const previous = structuredClone(state);
    state = normalize(PRESETS[button.dataset.preset]); renderControls(); saveState();
    showToast('已切换示例，你刚才的内容可以撤销。', () => { state = previous; renderControls(); saveState(); });
  }));
  $('#resetButton').addEventListener('click', () => {
    const previous = structuredClone(state);
    state = normalize(PRESETS.career); renderControls(); saveState();
    showToast('已恢复示例。', () => { state = previous; renderControls(); saveState(); });
  });
  $('#thirdPathButton').addEventListener('click', () => {
    const previous = structuredClone(state);
    state.hasThird = !state.hasThird; renderControls(); saveState();
    if (!state.hasThird) showToast('第三条路已移除。', () => { state = previous; renderControls(); saveState(); });
    else { $('#optionC').focus(); showToast('第三条路已加入，可以给它命名并评分。'); }
  });
  $('#addCriterion').addEventListener('click', () => {
    let i = state.criteria.length + 1;
    while (state.criteria.includes(`新维度 ${i}`)) i += 1;
    if (!addCriterion(`新维度 ${i}`)) return;
    const inputs = document.querySelectorAll('.criterion-edit input');
    inputs[inputs.length - 1]?.focus(); inputs[inputs.length - 1]?.select();
  });
  $('#saveSnapshot').addEventListener('click', saveSnapshot);
  $('#shareButton').addEventListener('click', shareCurrent);
  $('#exportButton').addEventListener('click', exportCard);
}

init();
