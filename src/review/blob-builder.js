import { GRADE_STATUS } from '../scoring/grader.js';
import { normalizeString } from '../storage/attempt-store.js';
import { buildReviewModel } from './model.js';
import { REVIEW_PAGE_CSS } from './page-styles.js';

const REVIEW_PAGE_VERSION = 1;

function escapeHtml(value) {
  return normalizeString(value, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function statusSymbol(status) {
  switch (status) {
    case GRADE_STATUS.CORRECT:
      return '✓';
    case GRADE_STATUS.INCORRECT:
      return '✕';
    case GRADE_STATUS.OMITTED:
      return '–';
    case GRADE_STATUS.UNKNOWN:
      return '?';
    default:
      return '•';
  }
}

function scoreLabel(scoreSummary) {
  const score = scoreSummary && scoreSummary.overallScore ? scoreSummary.overallScore : null;
  if (!score) {
    return 'Score unavailable';
  }
  const unknown = Number(scoreSummary.unknown || 0);
  const suffix = unknown > 0 ? ` · ${unknown} unknown key${unknown === 1 ? '' : 's'}` : '';
  return `${score.label} (${score.percent}%)${suffix}`;
}

function buildScoreSummaryHtml(scoreSummary) {
  const perBlock = Array.isArray(scoreSummary && scoreSummary.perBlock) ? scoreSummary.perBlock : [];
  const rows = [
    ['Overall', scoreLabel(scoreSummary)],
    ['Correct', `${Number(scoreSummary && scoreSummary.correct || 0)}`],
    ['Incorrect', `${Number(scoreSummary && scoreSummary.incorrect || 0)}`],
    ['Omitted', `${Number(scoreSummary && scoreSummary.omitted || 0)}`],
    ['Unknown', `${Number(scoreSummary && scoreSummary.unknown || 0)}`],
    ...perBlock.map((block) => [`Block ${Number(block && block.blockNumber || 0)}`, `${block && block.overallScore ? block.overallScore.label : '—'} (${block && block.overallScore ? block.overallScore.percent : 0}%)`]),
  ];
  return rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function buildStaticShell(model) {
  const firstQuestion = model.questions[0] || null;
  const firstStatus = firstQuestion ? firstQuestion.status : 'unknown';
  return `
    <div id="f120-review-root" data-review-page-version="${REVIEW_PAGE_VERSION}">
      <header class="f120-review-toolbar">
        <div>
          <h1 class="f120-review-title">Free120 Review</h1>
          <div class="f120-review-summary">${escapeHtml(scoreLabel(model.scoreSummary))} · ${model.questions.length} item${model.questions.length === 1 ? '' : 's'}</div>
        </div>
        <div class="f120-review-controls" aria-label="Review controls">
          <label>Filter
            <select id="f120-review-filter">
              <option value="all">All</option>
              <option value="correct">Correct</option>
              <option value="incorrect">Incorrect</option>
              <option value="omitted">Omitted</option>
              <option value="unknown">Unknown</option>
              <option value="marked">Marked</option>
            </select>
          </label>
          <label>Block
            <select id="f120-review-block-filter"><option value="all">All blocks</option></select>
          </label>
          <button type="button" id="f120-review-prev">Previous</button>
          <button type="button" id="f120-review-next">Next</button>
        </div>
      </header>
      <div class="f120-review-shell">
        <nav class="f120-review-leftnav" aria-label="Reviewed questions"><ol id="leftnav"></ol></nav>
        <main class="f120-review-main">
          <div class="f120-review-current-header">
            <span id="f120-review-current-label">${firstQuestion ? `Block ${escapeHtml(firstQuestion.blockNumber)} · Item ${escapeHtml(firstQuestion.itemIndex)}` : 'No review items'}</span>
            <span id="f120-review-current-status" class="f120-review-pill f120-review-pill--${escapeHtml(firstStatus)}">${firstQuestion ? `${escapeHtml(statusSymbol(firstStatus))} ${escapeHtml(firstStatus)}` : 'empty'}</span>
          </div>
          <section id="item" aria-label="Question review"><article id="content"><div id="medley"></div></article></section>
        </main>
        <aside class="f120-review-side">
          <section class="f120-review-detail-panel" aria-label="Question details">
            <h2>Score summary</h2>
            <dl class="f120-review-detail-list">${buildScoreSummaryHtml(model.scoreSummary)}</dl>
            <h2>Question details</h2>
            <dl id="f120-review-details" class="f120-review-detail-list"></dl>
            <div id="f120-review-compact" class="f120-review-compact-summary"></div>
          </section>
        </aside>
      </div>
    </div>`;
}

function buildReviewRuntimeScript(model) {
  const modelJson = safeJsonForScript(model);
  return `
(function(){
  'use strict';
  const MODEL = ${modelJson};
  const STATUS_SYMBOL = { correct: '✓', incorrect: '✕', omitted: '–', unknown: '?' };
  const OPTION_MARK = { correct: '✓', wrong: '✕', unknown: '?' };
  const state = { filter: 'all', block: 'all', currentQuestionId: MODEL.questions[0] ? MODEL.questions[0].questionId : '' };

  function qs(selector, root) { return (root || document).querySelector(selector); }
  function qsa(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function el(tag, options) {
    const node = document.createElement(tag);
    const opts = options || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = String(opts.text);
    if (opts.html !== undefined) node.innerHTML = String(opts.html);
    if (opts.type) node.type = opts.type;
    if (opts.attrs) Object.entries(opts.attrs).forEach(([key, value]) => { if (value !== null && value !== undefined) node.setAttribute(key, String(value)); });
    return node;
  }
  function replaceChildren(node, children) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    (Array.isArray(children) ? children : [children]).forEach((child) => { if (child) node.appendChild(child); });
  }
  function text(value, fallback) {
    if (value === null || value === undefined) return fallback || '';
    const normalized = String(value).trim();
    return normalized || (fallback || '');
  }
  function answersMatch(left, right) {
    const l = text(left).toLowerCase();
    const r = text(right).toLowerCase();
    return Boolean(l && r && l === r);
  }
  function formatDuration(ms) {
    const value = Number(ms || 0);
    if (!Number.isFinite(value) || value <= 0) return '—';
    const seconds = Math.round(value / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes + ':' + String(seconds % 60).padStart(2, '0');
  }
  function sortedBlockNumbers() {
    return Array.from(new Set(MODEL.questions.map((question) => Number(question.blockNumber || 1)).filter(Boolean))).sort((a, b) => a - b);
  }
  function getQuestion(questionId) {
    return MODEL.questions.find((question) => question.questionId === questionId) || MODEL.questions[0] || null;
  }
  function visibleQuestions() {
    return MODEL.questions.filter((question) => {
      if (state.block !== 'all' && String(question.blockNumber) !== String(state.block)) return false;
      if (state.filter === 'all') return true;
      if (state.filter === 'marked') return Boolean(question.marked);
      return question.status === state.filter;
    });
  }
  function ensureVisibleQuestion() {
    const visible = visibleQuestions();
    if (!visible.length) {
      state.currentQuestionId = '';
      return null;
    }
    if (!visible.some((question) => question.questionId === state.currentQuestionId)) {
      state.currentQuestionId = visible[0].questionId;
    }
    return getQuestion(state.currentQuestionId);
  }
  function answerIdCandidates(answerId) {
    const value = text(answerId);
    if (!value) return [];
    const parts = [value];
    const colonTail = value.includes(':') ? value.split(':').pop() : '';
    if (colonTail) parts.push(colonTail);
    return Array.from(new Set(parts.map((part) => part.toLowerCase())));
  }
  function choiceMatches(choice, answerId) {
    const candidates = answerIdCandidates(answerId);
    if (!candidates.length) return false;
    const id = text(choice && choice.id).toLowerCase();
    const index = String(choice && choice.index || '').toLowerCase();
    return candidates.includes(id) || candidates.includes(index);
  }
  function rowInputAnswerId(input, row, index) {
    if (!input) return 'option-' + (index + 1);
    const value = text(input.getAttribute('value'));
    const id = text(input.getAttribute('id'));
    const name = text(input.getAttribute('name'));
    return value || id || (name && value ? name + ':' + value : '') || row.getAttribute('data-option-id') || 'option-' + (index + 1);
  }
  function rowMatchesAnswer(row, question, answerId, index) {
    const input = row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
    const rowId = rowInputAnswerId(input, row, index);
    if (answerIdCandidates(answerId).includes(String(rowId).toLowerCase())) return true;
    const choice = (question.snapshot.choices || [])[index];
    return choiceMatches(choice, answerId);
  }
  function sanitizeSnapshotFragment(root) {
    qsa('script, iframe, object, embed, link[rel="import"]', root).forEach((node) => node.remove());
    qsa('*', root).forEach((node) => {
      Array.from(node.attributes || []).forEach((attribute) => {
        const name = attribute.name;
        const value = text(attribute.value);
        if (/^on/i.test(name) || ['ng-click', 'data-ng-click'].includes(name)) {
          node.removeAttribute(name);
          return;
        }
        if (['href', 'src', 'xlink:href', 'formaction'].includes(name.toLowerCase()) && /^javascript:/i.test(value)) {
          node.removeAttribute(name);
        }
      });
    });
  }
  function disableInteractiveControls(root) {
    qsa('input, button, textarea, select', root).forEach((node) => {
      node.disabled = true;
      node.setAttribute('aria-disabled', 'true');
    });
    qsa('a[href]', root).forEach((node) => {
      node.removeAttribute('href');
      node.setAttribute('role', 'link');
      node.setAttribute('aria-disabled', 'true');
    });
    qsa('[onclick], [ng-click], [data-ng-click]', root).forEach((node) => {
      node.removeAttribute('onclick');
      node.removeAttribute('ng-click');
      node.removeAttribute('data-ng-click');
    });
  }
  function insertStatusMarker(row, kind, symbol) {
    const input = row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
    const marker = el('span', { className: 'f120-review-option-status f120-review-option-status--' + kind, text: symbol || '' });
    const visibleSpan = row.querySelector('span, label');
    if (input && input.parentNode === row) {
      if (visibleSpan && visibleSpan.parentNode === row) row.insertBefore(marker, visibleSpan);
      else input.insertAdjacentElement('afterend', marker);
    } else {
      row.insertBefore(marker, row.firstChild);
    }
  }
  function decorateOptionRows(root, question) {
    const rows = qsa('ol.options > li.stContext, li.stContext', root);
    rows.forEach((row, index) => {
      const isCorrect = rowMatchesAnswer(row, question, question.correctAnswerId, index);
      const isSelected = rowMatchesAnswer(row, question, question.selectedAnswerId, index);
      let kind = 'empty';
      let symbol = '';
      if (isCorrect && question.correctAnswerId) {
        kind = 'correct';
        symbol = OPTION_MARK.correct;
        row.classList.add('f120-review-option--correct');
      } else if (isSelected && question.status === 'incorrect') {
        kind = 'wrong';
        symbol = OPTION_MARK.wrong;
        row.classList.add('f120-review-option--selected-wrong');
      } else if (isSelected && question.status === 'unknown') {
        kind = 'unknown';
        symbol = OPTION_MARK.unknown;
        row.classList.add('f120-review-option--selected-unknown');
      }
      insertStatusMarker(row, kind, symbol);
      const input = row.querySelector('input.NBOptionInput, input[type="radio"], input[type="checkbox"]');
      if (input) input.checked = Boolean(isSelected);
    });
  }
  function insertTimeSpent(root, question) {
    const time = el('div', { className: 'f120-review-time-spent', text: 'Time spent: ' + formatDuration(question.timingMs) });
    const options = qs('ol.options', root);
    if (options && options.parentNode) {
      options.insertAdjacentElement('afterend', time);
      return;
    }
    const answerBox = qs('div[id$="_div"].NBOptionListComp.answerbox, .NBOptionListComp.answerbox, .answerbox', root);
    if (answerBox && answerBox.parentNode) {
      answerBox.insertAdjacentElement('afterend', time);
      return;
    }
    root.appendChild(time);
  }
  function renderFallbackQuestion(question) {
    const wrapper = el('div', { className: 'f120-review-item-unavailable' });
    wrapper.appendChild(el('p', { text: 'Stored rendered item snapshot unavailable. Compact review data shown below.' }));
    const list = el('dl', { className: 'f120-review-detail-list' });
    appendDetail(list, 'Selected', question.selectedAnswerId || '—');
    appendDetail(list, 'Correct', question.correctAnswerId || '—');
    wrapper.appendChild(list);
    return wrapper;
  }
  function renderQuestion(question) {
    const medley = qs('#medley');
    if (!medley) return;
    replaceChildren(medley, []);
    if (!question) {
      medley.appendChild(el('div', { className: 'f120-review-item-unavailable', text: 'No questions match current filters.' }));
      return;
    }
    const html = text(question.snapshot && question.snapshot.renderedHtml);
    let root;
    if (html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      sanitizeSnapshotFragment(template.content);
      const firstElement = Array.from(template.content.childNodes).find((node) => node.nodeType === 1);
      root = firstElement || el('div');
      medley.appendChild(template.content);
      root = medley.querySelector('div[id^="item"], .NBExposition, .answerbox') || medley.firstElementChild || medley;
    } else {
      medley.appendChild(renderFallbackQuestion(question));
      root = medley.firstElementChild || medley;
    }
    disableInteractiveControls(medley);
    decorateOptionRows(medley, question);
    insertTimeSpent(root && root.nodeType === 1 ? root : medley, question);
  }
  function appendDetail(container, label, value) {
    container.appendChild(el('dt', { text: label }));
    container.appendChild(el('dd', { text: value === undefined || value === null || value === '' ? '—' : value }));
  }
  function renderDetails(question) {
    const details = qs('#f120-review-details');
    const compact = qs('#f120-review-compact');
    replaceChildren(details, []);
    replaceChildren(compact, []);
    if (!question) {
      compact.appendChild(el('div', { className: 'f120-review-empty', text: 'No matching item.' }));
      return;
    }
    appendDetail(details, 'Status', question.status);
    appendDetail(details, 'Selected', question.selectedAnswerId || '—');
    appendDetail(details, 'Correct', question.correctAnswerId || '—');
    appendDetail(details, 'Marked', question.marked ? 'yes' : 'no');
    appendDetail(details, 'Time', formatDuration(question.timingMs));
    const annotations = question.annotations || {};
    const highlights = Array.isArray(annotations.highlights) ? annotations.highlights : [];
    const strikeouts = Array.isArray(annotations.strikeouts) ? annotations.strikeouts : [];
    appendDetail(details, 'Highlights', highlights.length ? String(highlights.length) : '—');
    appendDetail(details, 'Strikeouts', strikeouts.length ? String(strikeouts.length) : '—');
    appendDetail(details, 'Question id', question.questionId);
    if (question.notes) {
      compact.appendChild(el('div', { text: 'Notes: ' + question.notes }));
    }
    if (highlights.length) {
      compact.appendChild(el('strong', { text: 'Highlights' }));
      highlights.slice(0, 5).forEach((entry) => compact.appendChild(el('div', { text: text(entry.text || entry.html).slice(0, 180) })));
    }
    if (strikeouts.length) {
      compact.appendChild(el('strong', { text: 'Strikeouts' }));
      strikeouts.slice(0, 5).forEach((entry) => compact.appendChild(el('div', { text: text(entry.text || entry.html).slice(0, 180) })));
    }
    const timeline = Array.isArray(question.answerTimeline) ? question.answerTimeline : [];
    if (timeline.length) {
      compact.appendChild(el('strong', { text: 'Answer changes' }));
      timeline.slice(-8).forEach((entry) => compact.appendChild(el('div', { text: (entry.changedAt || '') + ' · ' + (entry.fromAnswerId || '—') + ' → ' + (entry.toAnswerId || '—') })));
    } else {
      compact.appendChild(el('div', { className: 'f120-review-empty', text: 'No answer-change timeline.' }));
    }
  }
  function renderHeader(question) {
    const label = qs('#f120-review-current-label');
    const status = qs('#f120-review-current-status');
    if (!question) {
      label.textContent = 'No review items';
      status.className = 'f120-review-pill f120-review-pill--unknown';
      status.textContent = 'empty';
      return;
    }
    label.textContent = 'Block ' + question.blockNumber + ' · Item ' + question.itemIndex;
    status.className = 'f120-review-pill f120-review-pill--' + question.status;
    status.textContent = (STATUS_SYMBOL[question.status] || '•') + ' ' + question.status;
  }
  function renderNav() {
    const nav = qs('ol#leftnav');
    const visible = visibleQuestions();
    replaceChildren(nav, []);
    visible.forEach((question) => {
      const row = el('li', { attrs: { tabindex: '0', role: 'button', 'data-question-id': question.questionId, 'aria-label': 'Review item ' + question.itemIndex + ' ' + question.status } });
      if (question.questionId === state.currentQuestionId) row.classList.add('currentitem');
      row.appendChild(el('span', { className: 'ans_status ' + (question.selectedAnswerId ? 'f120-review-answered' : ''), attrs: { 'aria-hidden': 'true' } }));
      row.appendChild(el('span', { className: 'f120-review-nav-status f120-review-nav-status--' + question.status, text: STATUS_SYMBOL[question.status] || '•' }));
      row.appendChild(el('span', { className: 'index', text: question.itemIndex }));
      row.appendChild(el('span', { className: 'hoverNote', text: question.marked ? '★' : '' }));
      row.addEventListener('click', () => { state.currentQuestionId = question.questionId; render(); });
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.currentQuestionId = question.questionId; render(); } });
      nav.appendChild(row);
    });
  }
  function renderBlockOptions() {
    const select = qs('#f120-review-block-filter');
    const previous = select.value || 'all';
    replaceChildren(select, [el('option', { text: 'All blocks', attrs: { value: 'all' } })]);
    sortedBlockNumbers().forEach((blockNumber) => select.appendChild(el('option', { text: 'Block ' + blockNumber, attrs: { value: blockNumber } })));
    select.value = Array.from(select.options).some((option) => option.value === previous) ? previous : 'all';
    state.block = select.value;
  }
  function move(delta) {
    const visible = visibleQuestions();
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex((question) => question.questionId === state.currentQuestionId));
    const nextIndex = Math.min(visible.length - 1, Math.max(0, index + delta));
    state.currentQuestionId = visible[nextIndex].questionId;
    render();
  }
  function render() {
    const question = ensureVisibleQuestion();
    renderNav();
    renderHeader(question);
    renderQuestion(question);
    renderDetails(question);
    const visible = visibleQuestions();
    const index = question ? visible.findIndex((item) => item.questionId === question.questionId) : -1;
    qs('#f120-review-prev').disabled = index <= 0;
    qs('#f120-review-next').disabled = index < 0 || index >= visible.length - 1;
  }
  function hydrateStoredShell() {
    const shellHtml = text(MODEL.shell && MODEL.shell.itemShellHtml);
    if (!shellHtml) return;
    const template = document.createElement('template');
    template.innerHTML = shellHtml;
    sanitizeSnapshotFragment(template.content);
    const storedSection = template.content.querySelector('section#item');
    const storedArticle = template.content.querySelector('article#content');
    const targetSection = qs('section#item');
    if (storedSection && targetSection) {
      const medley = storedSection.querySelector('#medley') || storedSection.querySelector('div[id="medley"]');
      if (medley) replaceChildren(medley, []);
      disableInteractiveControls(storedSection);
      targetSection.replaceWith(storedSection);
      return;
    }
    if (storedArticle && targetSection) {
      const medley = storedArticle.querySelector('#medley') || storedArticle.querySelector('div[id="medley"]');
      if (medley) replaceChildren(medley, []);
      disableInteractiveControls(storedArticle);
      replaceChildren(targetSection, [storedArticle]);
    }
  }
  function attachControls() {
    hydrateStoredShell();
    renderBlockOptions();
    qs('#f120-review-filter').addEventListener('change', (event) => { state.filter = event.target.value; render(); });
    qs('#f120-review-block-filter').addEventListener('change', (event) => { state.block = event.target.value; render(); });
    qs('#f120-review-prev').addEventListener('click', () => move(-1));
    qs('#f120-review-next').addEventListener('click', () => move(1));
    document.addEventListener('keydown', (event) => {
      if (event.target && ['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    });
  }
  attachControls();
  render();
})();`;
}

function buildReviewHtml(attempt, snapshots = []) {
  const model = buildReviewModel(attempt, snapshots);
  const title = `Free120 Review${model.attempt.id ? ` · ${model.attempt.id}` : ''}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${REVIEW_PAGE_CSS}</style>
</head>
<body>
  ${buildStaticShell(model)}
  <script>${buildReviewRuntimeScript(model)}</script>
</body>
</html>`;
}

function createReviewBlobUrl(attempt, snapshots = [], adapterWindow = window) {
  const html = buildReviewHtml(attempt, snapshots);
  const BlobCtor = adapterWindow.Blob || Blob;
  const URLObject = adapterWindow.URL || URL;
  const blob = new BlobCtor([html], { type: 'text/html;charset=utf-8' });
  return URLObject.createObjectURL(blob);
}

async function openReviewTab(options = {}) {
  const adapterWindow = options.window || window;
  const storage = options.storage;
  const attemptId = normalizeString(options.attemptId || (options.attempt && options.attempt.id), '');
  if (!storage || typeof storage.getAttempt !== 'function' || typeof storage.listQuestionSnapshots !== 'function') {
    throw new Error('Review launcher requires storage with attempt and snapshot readers.');
  }
  if (!attemptId) {
    throw new Error('Review launcher requires attempt id.');
  }
  const attempt = await storage.getAttempt(attemptId) || options.attempt;
  if (!attempt) {
    throw new Error(`Attempt not found: ${attemptId}`);
  }
  const opened = typeof adapterWindow.open === 'function' ? adapterWindow.open('about:blank', '_blank') : null;
  if (!opened) {
    throw new Error('Review tab popup was blocked. Allow popups for orientation.nbme.org and retry.');
  }
  try {
    opened.opener = null;
  } catch (_error) {}
  const snapshots = await storage.listQuestionSnapshots(attemptId);
  const url = createReviewBlobUrl(attempt, snapshots, adapterWindow);
  try {
    opened.location.href = url;
  } catch (_error) {
    if (typeof adapterWindow.open === 'function') {
      adapterWindow.open(url, '_blank', 'noopener,noreferrer');
    }
  }
  return Object.freeze({ url, window: opened, attemptId, snapshotCount: snapshots.length });
}

export {
  REVIEW_PAGE_VERSION,
  buildReviewHtml,
  createReviewBlobUrl,
  openReviewTab,
};
