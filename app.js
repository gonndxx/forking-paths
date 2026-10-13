const FACTORS = [
  { id: 'money', label: '经济余量', short: '经济' },
  { id: 'time', label: '时间自由', short: '时间' },
  { id: 'growth', label: '成长空间', short: '成长' },
  { id: 'peace', label: '内心踏实', short: '踏实' }
];

const PRESETS = {
  career: { question: '要不要换一份工作？', a: '换一份工作', b: '留在现在的岗位', scores: { a: [5, 6, 9, 5], b: [8, 7, 5, 8] }, weights: [3, 2, 4, 3] },
  city: { question: '要不要搬去一座新的城市？', a: '去新的城市', b: '留在熟悉的地方', scores: { a: [5, 6, 9, 5], b: [8, 8, 5, 8] }, weights: [3, 2, 4, 3] },
  study: { question: '现在要不要投入时间继续学习？', a: '开始一段系统学习', b: '保持现在的节奏', scores: { a: [5, 4, 9, 7], b: [8, 8, 5, 7] }, weights: [3, 3, 5, 2] }
};

const STORAGE_KEY = 'forking-paths-v1';
const $ = selector => document.querySelector(selector);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));
let state = loadState();
let toastTimer;

function cleanText(value, fallback, max) {
  return typeof value === 'string' ? (value.trim().slice(0, max) || fallback) : fallback;
}

function normalize(input) {
  const base = PRESETS.career;
  if (!input || typeof input !== 'object') return structuredClone(base);
  return {
    question: cleanText(input.question, base.question, 80),
    a: cleanText(input.a, base.a, 32),
    b: cleanText(input.b, base.b, 32),
    scores: {
      a: FACTORS.map((_, i) => clamp(input.scores?.a?.[i] ?? base.scores.a[i], 1, 10)),
      b: FACTORS.map((_, i) => clamp(input.scores?.b?.[i] ?? base.scores.b[i], 1, 10))
    },
    weights: FACTORS.map((_, i) => clamp(input.weights?.[i] ?? base.weights[i], 1, 5))
  };
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Private browsing may disable storage. */ }
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

function renderControls() {
  $('#questionInput').value = state.question;
  $('#optionA').value = state.a;
  $('#optionB').value = state.b;
  ['a', 'b'].forEach(path => {
    const target = $(`#factors${path.toUpperCase()}`);
    target.replaceChildren(...FACTORS.map((factor, i) => makeSlider({
      id: `${path}-${factor.id}`, label: factor.label, value: state.scores[path][i], max: 10,
      onInput: value => { state.scores[path][i] = value; }
    })));
  });
  $('#priorityPanel').replaceChildren(...FACTORS.map((factor, i) => makeSlider({
    id: `weight-${factor.id}`, label: factor.label, value: state.weights[i], max: 5,
    onInput: value => { state.weights[i] = value; }
  })));
  const active = Object.keys(PRESETS).find(key => JSON.stringify(normalize(PRESETS[key])) === JSON.stringify(state));
  document.querySelectorAll('.preset').forEach(button => button.classList.toggle('active', button.dataset.preset === active));
  updateResult();
}

function weightedScore(path) {
  const total = state.weights.reduce((sum, weight) => sum + weight, 0);
  return state.scores[path].reduce((sum, value, i) => sum + value * state.weights[i], 0) / total;
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
  const xs = [95, 330, 565, 800];
  const y = value => 242 - (value - 1) * 19;
  [75, 155, 235].forEach((yy, i) => {
    svg.append(setSvgElement('line', { x1: 45, y1: yy, x2: 850, y2: yy, stroke: '#42414f', 'stroke-width': 1, 'stroke-dasharray': i === 1 ? '3 7' : '2 8', opacity: .65 }));
  });
  xs.forEach((x, i) => {
    svg.append(setSvgElement('line', { x1: x, y1: 58, x2: x, y2: 245, stroke: '#3d3e4b', 'stroke-width': 1 }));
    svg.append(setSvgElement('text', { x, y: 284, fill: '#a5a6b6', 'text-anchor': 'middle', 'font-size': 13, 'font-family': 'Noto Sans SC, sans-serif' }, FACTORS[i].label));
  });
  [['b', '#a7a0ff'], ['a', '#f8a568']].forEach(([path, color]) => {
    const points = state.scores[path].map((value, i) => [xs[i], y(value)]);
    const d = points.map(([x, yy], i) => i ? `L ${x} ${yy}` : `M ${x} ${yy}`).join(' ');
    svg.append(setSvgElement('path', { d, fill: 'none', stroke: color, 'stroke-width': 12, opacity: .08, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    svg.append(setSvgElement('path', { d, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    points.forEach(([x, yy], i) => {
      svg.append(setSvgElement('circle', { cx: x, cy: yy, r: 7, fill: '#242431', stroke: color, 'stroke-width': 3 }));
      svg.append(setSvgElement('text', { x, y: yy - 17, fill: color, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, 'font-family': 'DM Sans, sans-serif' }, String(state.scores[path][i])));
    });
  });
  svg.setAttribute('aria-label', `${state.a}与${state.b}在经济余量、时间自由、成长空间和内心踏实四个维度上的评分对比`);
}

function updateResult() {
  const a = weightedScore('a');
  const b = weightedScore('b');
  const delta = a - b;
  const close = Math.abs(delta) < .35;
  const leader = delta >= 0 ? 'a' : 'b';
  $('#scoreA').textContent = a.toFixed(1);
  $('#scoreB').textContent = b.toFixed(1);
  $('#scoreLabelA').textContent = state.a;
  $('#scoreLabelB').textContent = state.b;
  $('#legendA').textContent = state.a;
  $('#legendB').textContent = state.b;
  $('#resultTitle').textContent = close ? '两条路，仍然很接近' : `你目前更倾向「${state[leader]}」`;
  $('#resultCopy').textContent = close ? '你给两条路的综合评分非常接近。也许真正的问题，是哪一种遗憾更容易接受。' : `按照你现在的评分和重视程度，「${state[leader]}」领先 ${Math.abs(delta).toFixed(1)} 分。试着调整一项条件，看看这个倾向是否稳固。`;
  const differences = FACTORS.map((factor, i) => ({ factor: factor.label, gap: (state.scores.a[i] - state.scores.b[i]) * state.weights[i] }));
  differences.sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));
  const biggest = differences[0];
  const insight = $('#insight');
  insight.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = `${biggest.factor}是当前最关键的分岔点。`;
  const detail = document.createTextNode(biggest.gap === 0 ? '两条路在这一项上持平；你可以重新想想，是否有尚未写进来的条件。' : `在你给出的评分里，「${state[biggest.gap > 0 ? 'a' : 'b']}」在这一项更符合你的期待。`);
  insight.append(strong, detail);
  drawDiagram();
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function encodeState() {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function shareCurrent() {
  const url = new URL(location.href);
  url.searchParams.set('s', encodeState());
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
  const cards = [{ key: 'a', x: 72, color: '#f8a568' }, { key: 'b', x: 615, color: '#a7a0ff' }];
  cards.forEach(card => {
    roundedRect(ctx, card.x, 325, 513, 200, 16, card.key === 'a' ? '#342a2d' : '#292838');
    ctx.fillStyle = card.color; ctx.font = '700 17px DM Sans, sans-serif'; ctx.fillText(card.key === 'a' ? 'PATH 01' : 'PATH 02', card.x + 28, 366);
    ctx.fillStyle = '#f8f5f3'; ctx.font = '700 27px Noto Sans SC, sans-serif';
    wrapText(ctx, state[card.key], card.x + 28, 412, 350, 36, 2);
    ctx.fillStyle = card.color; ctx.font = '700 47px DM Sans, sans-serif';
    ctx.fillText(weightedScore(card.key).toFixed(1), card.x + 400, 486);
  });
  ctx.fillStyle = '#aaabb9'; ctx.font = '400 16px Noto Sans SC, sans-serif';
  ctx.fillText('分数来自我自己的评分与权重；它帮我看清权衡，而不是预测未来。', 72, 589);
  ctx.fillStyle = '#6f7283'; ctx.font = '500 15px DM Sans, sans-serif'; ctx.fillText('FORKING PATHS  /  MY DECISION MAP', 72, 630);
  const link = document.createElement('a');
  link.download = '分岔路口-选择卡.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('选择卡已导出。');
}

function init() {
  renderControls();
  $('#questionInput').addEventListener('input', event => { state.question = event.target.value.slice(0, 80); saveState(); });
  [['#optionA', 'a'], ['#optionB', 'b']].forEach(([selector, key]) => {
    $(selector).addEventListener('input', event => { state[key] = event.target.value.slice(0, 32); updateResult(); saveState(); });
    $(selector).addEventListener('blur', event => { state[key] = cleanText(state[key], key === 'a' ? '第一条路' : '第二条路', 32); event.target.value = state[key]; updateResult(); saveState(); });
  });
  $('#questionInput').addEventListener('blur', event => { state.question = cleanText(state.question, '我正在考虑一个选择', 80); event.target.value = state.question; saveState(); });
  document.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => { state = normalize(PRESETS[button.dataset.preset]); renderControls(); saveState(); }));
  $('#resetButton').addEventListener('click', () => { state = normalize(PRESETS.career); renderControls(); saveState(); showToast('已恢复示例。'); });
  $('#shareButton').addEventListener('click', shareCurrent);
  $('#exportButton').addEventListener('click', exportCard);
}

init();
