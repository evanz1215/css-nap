import './style.css';
import { toTailwind, toStyledComponent, extractUrl, cssSelector, specificity, PROPS, SUBTREE_LIMIT } from './convert.js';

const t = (...args: Parameters<typeof browser.i18n.getMessage>) => browser.i18n.getMessage(...args);
const COLOR_PROPS = ['color', 'background-color'];
const BG_PROPS = ['background-image'];
const FONT_PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing'];

type StyleEntry = [name: string, value: string];
type MatchedRuleBlock = { selectorLabel: string; entries: StyleEntry[] };
type InspectPayload = {
  tag: string;
  selector: string;
  props: StyleEntry[];
  matchedRules: MatchedRuleBlock[];
  subtreeCss: string;
  html: string;
};

function collectStyles(el: Element): StyleEntry[] {
  const computed = getComputedStyle(el);
  return PROPS.filter((name) => computed.getPropertyValue(name))
    .map((name): StyleEntry => [name, computed.getPropertyValue(name)]);
}

function formatCss(props: StyleEntry[]): string {
  return props.map(([name, value]) => `${name}: ${value};`).join('\n');
}

function selectorFor(el: Element): string {
  return cssSelector(el.tagName, el.id, Array.from(el.classList));
}

function styleDeclEntries(decl: CSSStyleDeclaration): StyleEntry[] {
  const entries: StyleEntry[] = [];
  for (let i = 0; i < decl.length; i++) {
    const name = decl.item(i);
    entries.push([name, decl.getPropertyValue(name)]);
  }
  return entries;
}

function collectStyleRules(ruleList: CSSRuleList, out: CSSStyleRule[]) {
  for (const rule of Array.from(ruleList)) {
    if (rule instanceof CSSStyleRule) {
      out.push(rule);
    } else if ('cssRules' in rule) {
      collectStyleRules((rule as CSSGroupingRule).cssRules, out);
    }
  }
}

// 跨網域樣式表直接讀 cssRules 會丟例外，改請 background fetch 純文字後在本地解析。
// 每個 href 只抓一次，同頁重複點選直接吃快取。
// ponytail: replaceSync 會忽略 @import，巢狀匯入的規則抓不到 — 遇到再展開處理。
const remoteRulesCache = new Map<string, CSSStyleRule[]>();

async function fetchRemoteRules(href: string): Promise<CSSStyleRule[]> {
  const cached = remoteRulesCache.get(href);
  if (cached) return cached;
  const rules: CSSStyleRule[] = [];
  try {
    const text: string = await browser.runtime.sendMessage({ type: 'fetch-css', url: href });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    collectStyleRules(sheet.cssRules, rules);
  } catch {
    // fetch 失敗或解析失敗 — 當成沒有規則
  }
  remoteRulesCache.set(href, rules);
  return rules;
}

// ponytail: document order, not cascade/specificity order like real DevTools
// — good enough to see which rules apply, not to predict the winning value.
async function getMatchedRules(el: Element): Promise<CSSStyleRule[]> {
  const all: CSSStyleRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.cssRules) collectStyleRules(sheet.cssRules, all);
    } catch {
      if (sheet.href) all.push(...(await fetchRemoteRules(sheet.href)));
    }
  }
  const matched = all.filter((rule) => {
    try {
      return el.matches(rule.selectorText);
    } catch {
      return false;
    }
  });
  // specificity 高的排前面（同 DevTools）；先 reverse 讓同分時「文件較後 = cascade 勝出」者在前
  return matched.reverse().sort((a, b) => specificity(b.selectorText) - specificity(a.selectorText));
}

async function gatherMatchedRuleBlocks(el: Element): Promise<MatchedRuleBlock[]> {
  const blocks: MatchedRuleBlock[] = [];
  const inline = styleDeclEntries((el as HTMLElement).style ?? ({} as CSSStyleDeclaration));
  if (inline.length) blocks.push({ selectorLabel: 'element.style', entries: inline });
  for (const rule of await getMatchedRules(el)) {
    const entries = styleDeclEntries(rule.style);
    if (entries.length) blocks.push({ selectorLabel: rule.selectorText, entries });
  }
  return blocks;
}

function collectSubtreeCss(root: Element): string {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))].slice(0, SUBTREE_LIMIT);
  return elements
    .map((el) => `${selectorFor(el)} {\n${formatCss(collectStyles(el)).split('\n').map((l) => `  ${l}`).join('\n')}\n}`)
    .join('\n\n');
}

async function gatherInspectData(el: Element): Promise<InspectPayload> {
  return {
    tag: el.tagName.toLowerCase(),
    selector: selectorFor(el),
    props: collectStyles(el),
    matchedRules: await gatherMatchedRuleBlocks(el),
    subtreeCss: collectSubtreeCss(el),
    html: el.outerHTML,
  };
}

type HistoryRecord = { tag: string; css: string; time: number };
const HISTORY_LIMIT = 20;
const historyItem = storage.defineItem<HistoryRecord[]>('local:cil-history', { defaultValue: [] });
const onboardedItem = storage.defineItem<boolean>('local:cil-onboarded', { defaultValue: false });

async function pushHistory(tag: string, css: string) {
  const list = (await historyItem.getValue()) ?? [];
  await historyItem.setValue([{ tag, css, time: Date.now() }, ...list].slice(0, HISTORY_LIMIT));
}

// ponytail: postMessage bridge instead of a shared background/state store —
// a `fixed` panel can only ever be positioned relative to its own frame's
// viewport, so an iframe's content script can't dock a panel to the real
// browser edge itself. It hands the (serializable) inspect data to the top
// frame, which is the only frame whose `fixed` actually spans the real page.
const CIL_MESSAGE = '__cil-inspect';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  cssInjectionMode: 'ui',
  async main(ctx) {
    const isTop = window.self === window.top;

    let hoverTarget: Element | null = null;
    let selectedElement: Element | null = null;
    let highlight: HTMLDivElement;
    let dims: HTMLDivElement;
    let panel: HTMLDivElement;
    let toast: HTMLDivElement;
    let toastTimer: ReturnType<typeof setTimeout>;

    const ui = await createShadowRootUi(ctx, {
      name: 'cssnap-ui',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        highlight = document.createElement('div');
        highlight.className = 'cil-highlight';
        highlight.hidden = true;
        container.appendChild(highlight);

        dims = document.createElement('div');
        dims.className = 'cil-dims';
        highlight.appendChild(dims);

        panel = document.createElement('div');
        panel.className = 'cil-panel';
        panel.hidden = true;
        container.appendChild(panel);

        toast = document.createElement('div');
        toast.className = 'cil-toast';
        toast.hidden = true;
        toast.addEventListener('click', () => (toast.hidden = true));
        container.appendChild(toast);
      },
    });
    ui.mount();

    function showToast(text: string, ms = 8000) {
      toast.textContent = text;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), ms);
    }

    // 首次安裝引導：只在 top frame、只顯示一次
    if (isTop && !(await onboardedItem.getValue())) {
      showToast(t('onboardToast'));
      onboardedItem.setValue(true);
    }

    // 右鍵選單「複製 CSS」的目標：記下最後一次右鍵點到的元素
    let lastContextTarget: Element | null = null;
    document.addEventListener('contextmenu', (e) => {
      const first = e.composedPath()[0];
      lastContextTarget = first instanceof Element && !ui.shadowHost.contains(first) ? first : null;
    }, true);

    browser.runtime.onMessage.addListener((message: any) => {
      // 點工具列圖示 → background 轉發過來的說明請求
      if (message?.type === 'show-help' && isTop) showToast(t('onboardToast'));
      // 右鍵選單 → background 送到本 frame 的複製請求
      if (message?.type === 'copy-css' && lastContextTarget) {
        const el = lastContextTarget;
        const css = message.subtree ? collectSubtreeCss(el) : formatCss(collectStyles(el));
        navigator.clipboard.writeText(css);
        showToast(t('copied'), 1500);
      }
    });

    function elementUnderPoint(x: number, y: number): Element | null {
      const el = document.elementFromPoint(x, y);
      if (!el || ui.shadowHost.contains(el)) return null;
      return el;
    }

    function updateHighlight(el: Element) {
      const rect = el.getBoundingClientRect();
      highlight.style.top = `${rect.top}px`;
      highlight.style.left = `${rect.left}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      dims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      // 貼近視窗底部時改標在外框上方，避免被切掉
      dims.classList.toggle('cil-dims-above', rect.bottom + 24 > window.innerHeight);
      highlight.hidden = false;
    }

    function copyWithFeedback(btn: HTMLButtonElement, text: string) {
      navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = t('copied');
      btn.classList.add('cil-copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('cil-copied');
      }, 1200);
    }

    function makeRow(name: string, value: string, opts: { swatch?: boolean; downloadUrl?: string | null } = {}): HTMLDivElement {
      const row = document.createElement('div');
      row.className = 'cil-prop-row';
      row.title = t('clickToCopyLine');
      row.addEventListener('click', () => navigator.clipboard.writeText(`${name}: ${value};`));
      if (opts.swatch) {
        const chip = document.createElement('span');
        chip.className = 'cil-swatch';
        chip.style.background = value;
        row.appendChild(chip);
      }
      row.appendChild(document.createTextNode(`${name}: ${value};`));
      if (opts.downloadUrl) {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'cil-btn cil-download';
        dlBtn.textContent = '⬇';
        dlBtn.title = t('downloadImage');
        dlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          browser.runtime.sendMessage({ type: 'download-image', url: opts.downloadUrl });
        });
        row.appendChild(dlBtn);
      }
      return row;
    }

    function makeSection(
      title: string,
      entries: StyleEntry[],
      entryOpts: (name: string, value: string) => { swatch?: boolean; downloadUrl?: string | null } = () => ({}),
    ): HTMLDivElement | null {
      if (entries.length === 0) return null;
      const section = document.createElement('div');
      section.className = 'cil-section';
      const heading = document.createElement('div');
      heading.className = 'cil-section-title';
      heading.textContent = title;
      section.appendChild(heading);
      for (const [name, value] of entries) {
        section.appendChild(makeRow(name, value, entryOpts(name, value)));
      }
      return section;
    }

    function renderHistoryList(container: HTMLElement, list: HistoryRecord[]) {
      container.innerHTML = '';
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cil-history-empty';
        empty.textContent = t('historyEmpty');
        container.appendChild(empty);
        return;
      }
      for (const record of list) {
        const row = document.createElement('div');
        row.className = 'cil-prop-row';
        row.title = t('clickToCopyRecord');
        row.textContent = `<${record.tag}> ${new Date(record.time).toLocaleTimeString()}`;
        row.addEventListener('click', () => navigator.clipboard.writeText(record.css));
        container.appendChild(row);
      }
    }

    function makeHistorySection(): HTMLDetailsElement {
      const details = document.createElement('details');
      details.className = 'cil-section cil-history';

      const summary = document.createElement('summary');
      summary.className = 'cil-section-title';
      summary.textContent = t('historyTitle');
      details.appendChild(summary);

      const list = document.createElement('div');
      details.appendChild(list);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'cil-btn';
      clearBtn.textContent = t('clearHistory');
      clearBtn.addEventListener('click', async () => {
        await historyItem.setValue([]);
        renderHistoryList(list, []);
      });
      details.appendChild(clearBtn);

      details.addEventListener('toggle', async () => {
        if (details.open) renderHistoryList(list, (await historyItem.getValue()) ?? []);
      });

      return details;
    }

    function makeMatchedRulesSection(matchedRules: MatchedRuleBlock[]): HTMLDivElement {
      const section = document.createElement('div');
      section.className = 'cil-section';

      const heading = document.createElement('div');
      heading.className = 'cil-section-title';
      heading.textContent = t('matchedRules');
      section.appendChild(heading);

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'cil-search';
      search.placeholder = t('searchPlaceholder');
      section.appendChild(search);

      const blocks: { block: HTMLElement; text: string }[] = [];

      for (const { selectorLabel, entries } of matchedRules) {
        const block = document.createElement('div');
        block.className = 'cil-rule-block';

        const sel = document.createElement('div');
        sel.className = 'cil-rule-selector';
        sel.textContent = `${selectorLabel} {`;
        block.appendChild(sel);

        for (const [name, value] of entries) block.appendChild(makeRow(name, value));

        const close = document.createElement('div');
        close.className = 'cil-rule-selector';
        close.textContent = '}';
        block.appendChild(close);

        section.appendChild(block);
        blocks.push({ block, text: `${selectorLabel} ${formatCss(entries)}`.toLowerCase() });
      }

      if (blocks.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cil-history-empty';
        empty.textContent = t('noRules');
        section.appendChild(empty);
      }

      search.addEventListener('input', () => {
        const q = search.value.toLowerCase();
        for (const { block, text } of blocks) block.hidden = q !== '' && !text.includes(q);
      });

      return section;
    }

    function renderPanel(data: InspectPayload) {
      const { tag, selector, props, matchedRules, subtreeCss, html } = data;
      const cssText = formatCss(props);
      const byName = (names: string[]) => props.filter(([name]) => names.includes(name));

      panel.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'cil-panel-header';
      header.textContent = `<${tag}> ${selector}`;
      header.title = t('navHint');

      const closeBtn = document.createElement('button');
      closeBtn.className = 'cil-btn cil-close';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        panel.hidden = true;
        selectedElement = null;
      });
      header.appendChild(closeBtn);

      const actions = document.createElement('div');
      actions.className = 'cil-actions';

      const copyAllBtn = document.createElement('button');
      copyAllBtn.className = 'cil-btn cil-btn-primary';
      copyAllBtn.textContent = t('copyAll');
      copyAllBtn.addEventListener('click', () => copyWithFeedback(copyAllBtn, cssText));

      const copyHtmlBtn = document.createElement('button');
      copyHtmlBtn.className = 'cil-btn';
      copyHtmlBtn.textContent = t('copyHtml');
      copyHtmlBtn.addEventListener('click', () => copyWithFeedback(copyHtmlBtn, html));

      const copyTailwindBtn = document.createElement('button');
      copyTailwindBtn.className = 'cil-btn';
      copyTailwindBtn.textContent = 'Tailwind';
      copyTailwindBtn.addEventListener('click', () => copyWithFeedback(copyTailwindBtn, toTailwind(props)));

      const copyStyledBtn = document.createElement('button');
      copyStyledBtn.className = 'cil-btn';
      copyStyledBtn.textContent = 'Styled Component';
      copyStyledBtn.addEventListener('click', () => copyWithFeedback(copyStyledBtn, toStyledComponent(tag, cssText)));

      const copySubtreeBtn = document.createElement('button');
      copySubtreeBtn.className = 'cil-btn';
      copySubtreeBtn.textContent = t('copySubtree');
      copySubtreeBtn.title = t('copySubtreeTitle', String(SUBTREE_LIMIT));
      copySubtreeBtn.addEventListener('click', () => copyWithFeedback(copySubtreeBtn, subtreeCss));

      actions.append(copyAllBtn, copyHtmlBtn, copyTailwindBtn, copyStyledBtn, copySubtreeBtn);

      panel.appendChild(header);
      panel.appendChild(actions);

      const sections = [
        makeSection(t('sectionColors'), byName(COLOR_PROPS), () => ({ swatch: true })),
        makeSection(t('sectionBackground'), byName(BG_PROPS), (_name, value) => ({ swatch: true, downloadUrl: extractUrl(value) })),
        makeSection(t('sectionFont'), byName(FONT_PROPS)),
      ];
      for (const section of sections) {
        if (section) panel.appendChild(section);
      }
      panel.appendChild(makeMatchedRulesSection(matchedRules));
      panel.appendChild(makeHistorySection());
      panel.hidden = false;

      pushHistory(tag, cssText);
    }

    // Only the top frame ever shows a panel — see CIL_MESSAGE comment above.
    async function selectAndRender(el: Element) {
      selectedElement = el;
      const data = await gatherInspectData(el);
      if (selectedElement !== el) return; // 等待 fetch 期間已改選其他元素
      if (isTop) {
        renderPanel(data);
      } else {
        window.top?.postMessage({ [CIL_MESSAGE]: true, payload: data }, '*');
      }
    }

    if (isTop) {
      window.addEventListener('message', (e) => {
        const data = e.data;
        if (!data || data[CIL_MESSAGE] !== true) return;
        selectedElement = null; // came from another frame, no local Element to navigate from
        renderPanel(data.payload as InspectPayload);
      });
    }

    document.addEventListener('mousemove', (e) => {
      if (!e.altKey) {
        highlight.hidden = true;
        hoverTarget = null;
        return;
      }
      const el = elementUnderPoint(e.clientX, e.clientY);
      if (!el) return;
      hoverTarget = el;
      updateHighlight(el);
    }, true);

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') {
        highlight.hidden = true;
        hoverTarget = null;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        panel.hidden = true;
        selectedElement = null;
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.altKey || !hoverTarget) return;
      e.preventDefault();
      e.stopPropagation();
      selectAndRender(hoverTarget);
    }, true);

    const NAV_KEYS: Record<string, (el: Element) => Element | null> = {
      ArrowUp: (el) => el.parentElement,
      ArrowDown: (el) => el.firstElementChild,
      ArrowLeft: (el) => el.previousElementSibling,
      ArrowRight: (el) => el.nextElementSibling,
    };

    document.addEventListener('keydown', (e) => {
      if (!e.altKey || !selectedElement) return;
      const step = NAV_KEYS[e.key];
      if (!step) return;
      const next = step(selectedElement);
      if (!next || ui.shadowHost.contains(next)) return;
      e.preventDefault();
      hoverTarget = next;
      updateHighlight(next);
      selectAndRender(next);
    }, true);
  },
});
