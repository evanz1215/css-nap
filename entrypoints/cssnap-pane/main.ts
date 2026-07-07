import { PROPS, SUBTREE_LIMIT, pageInspect } from '../content/convert.js';

declare const chrome: any;

const t = (key: string, subs?: string[]) => chrome.i18n.getMessage(key, subs);

// DevTools 主題只在開啟時決定，不會中途切換
if (chrome.devtools.panels.themeName === 'dark') document.body.classList.add('dark');

const selEl = document.getElementById('sel')!;
const preview = document.getElementById('preview')!;
const copyCssBtn = document.getElementById('copy-css') as HTMLButtonElement;
const copySubtreeBtn = document.getElementById('copy-subtree') as HTMLButtonElement;

copyCssBtn.textContent = t('copyAll');
copySubtreeBtn.textContent = t('copySubtree');
copySubtreeBtn.title = t('copySubtreeTitle', [String(SUBTREE_LIMIT)]);

// pageInspect 是刻意 self-contained 的函式,序列化後對 Elements 面板目前選取的 $0 執行
function evalInPage(mode: 'info' | 'subtree'): Promise<any> {
  const expr = `(${pageInspect})($0, ${JSON.stringify(PROPS)}, ${SUBTREE_LIMIT}, ${JSON.stringify(mode)})`;
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(expr, (result: unknown, err: unknown) => resolve(err ? null : result));
  });
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    // 側欄失焦時 clipboard API 會拒絕 — 退回 execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

function copyWithFeedback(btn: HTMLButtonElement, text: string) {
  copyText(text);
  const original = btn.textContent;
  btn.textContent = t('copied');
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 1200);
}

const COLOR_RE = /rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i;

function makeRow(line: string): HTMLDivElement {
  const idx = line.indexOf(':');
  const row = document.createElement('div');
  row.className = 'row';
  row.title = t('clickToCopyLine');
  row.addEventListener('click', () => copyText(line));

  const colorMatch = line.slice(idx + 1).match(COLOR_RE);
  if (colorMatch) {
    const chip = document.createElement('span');
    chip.className = 'swatch';
    chip.style.background = colorMatch[0];
    row.appendChild(chip);
  }

  const name = document.createElement('span');
  name.className = 'prop';
  name.textContent = line.slice(0, idx + 1);
  const value = document.createElement('span');
  value.className = 'value';
  value.textContent = line.slice(idx + 1).trim();
  row.append(name, value);
  return row;
}

type RuleBlock = { sel: string; lines: string[] };

function renderInfo(css: string, rules: RuleBlock[]) {
  preview.innerHTML = '';

  // 命中的 CSS 規則,依 selector 分塊(同 DevTools Styles)
  for (const { sel, lines } of rules) {
    const block = document.createElement('div');
    block.className = 'rule-block';
    const open = document.createElement('div');
    open.className = 'rule-sel';
    open.textContent = `${sel} {`;
    block.appendChild(open);
    for (const line of lines) block.appendChild(makeRow(line));
    const close = document.createElement('div');
    close.className = 'rule-sel';
    close.textContent = '}';
    block.appendChild(close);
    preview.appendChild(block);
  }
  if (rules.length === 0) {
    const none = document.createElement('div');
    none.className = 'empty';
    none.textContent = t('noRules');
    preview.appendChild(none);
  }

  // 計算後樣式(複製按鈕複製的內容)
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = t('paneComputed');
  preview.appendChild(title);
  for (const line of css.split('\n')) preview.appendChild(makeRow(line));
}

let currentCss = '';

async function refresh() {
  const info = await evalInPage('info');
  copyCssBtn.disabled = !info;
  copySubtreeBtn.disabled = !info;
  selEl.textContent = info ? info.selector : '';
  currentCss = info ? info.css : '';
  if (info) {
    renderInfo(info.css, info.rules ?? []);
  } else {
    preview.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('paneSelectElement');
    preview.appendChild(empty);
  }
}

copyCssBtn.addEventListener('click', () => copyWithFeedback(copyCssBtn, currentCss));
copySubtreeBtn.addEventListener('click', async () => {
  const css = await evalInPage('subtree');
  if (css) copyWithFeedback(copySubtreeBtn, css);
});

chrome.devtools.panels.elements.onSelectionChanged.addListener(refresh);
refresh();
