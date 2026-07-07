// ponytail: keyword map covers common enum-valued properties; everything else
// falls back to Tailwind's arbitrary-value syntax `prefix-[value]`, which is
// exact (no theme-scale guessing). Upgrade to full theme-scale matching if
// arbitrary values turn out to be too noisy in practice.
export const TAILWIND_KEYWORDS = {
  display: { flex: 'flex', grid: 'grid', block: 'block', inline: 'inline', 'inline-block': 'inline-block', 'inline-flex': 'inline-flex', none: 'hidden' },
  position: { relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky', static: 'static' },
  'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify' },
  'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
  'white-space': { nowrap: 'whitespace-nowrap', normal: 'whitespace-normal', pre: 'whitespace-pre' },
  overflow: { hidden: 'overflow-hidden', visible: 'overflow-visible', auto: 'overflow-auto', scroll: 'overflow-scroll' },
  cursor: { pointer: 'cursor-pointer', default: 'cursor-default', 'not-allowed': 'cursor-not-allowed' },
  'flex-direction': { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' },
  'justify-content': { 'flex-start': 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around' },
  'align-items': { 'flex-start': 'items-start', center: 'items-center', 'flex-end': 'items-end', stretch: 'items-stretch' },
  'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
};

export const TAILWIND_PREFIXES = {
  width: 'w', height: 'h',
  'margin-top': 'mt', 'margin-right': 'mr', 'margin-bottom': 'mb', 'margin-left': 'ml',
  'padding-top': 'pt', 'padding-right': 'pr', 'padding-bottom': 'pb', 'padding-left': 'pl',
  gap: 'gap', 'border-radius': 'rounded', 'font-size': 'text',
  color: 'text', 'background-color': 'bg', 'background-image': 'bg',
  'border-color': 'border', 'z-index': 'z', opacity: 'opacity',
  top: 'top', right: 'right', bottom: 'bottom', left: 'left',
  'letter-spacing': 'tracking', 'line-height': 'leading', 'box-shadow': 'shadow',
};

function toTailwindClass(name, value) {
  const keyword = TAILWIND_KEYWORDS[name]?.[value];
  if (keyword) return keyword;
  const prefix = TAILWIND_PREFIXES[name];
  if (!prefix) return null;
  return `${prefix}-[${value.replace(/\s+/g, '_')}]`;
}

export function toTailwind(props) {
  return props.map(([name, value]) => toTailwindClass(name, value)).filter(Boolean).join(' ');
}

export function toStyledComponent(tag, cssText) {
  const indented = cssText.split('\n').map((line) => `  ${line}`).join('\n');
  const name = `Styled${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
  return `const ${name} = styled.${tag}\`\n${indented}\n\`;`;
}

export function extractUrl(value) {
  const match = value.match(/url\((['"]?)(.*?)\1\)/);
  return match ? match[2] : null;
}

// ponytail: naive specificity — regex token counting on the whole selectorText.
// :not()/:is()/:where() 的引數規則、逗號列表取最大值這些細節都沒做，
// 排面板順序夠用，不是標準實作。回傳單一數字方便直接比大小。
export function specificity(selector) {
  // 先消毒：屬性選擇器內容清空（避免 [type="a b"] 內的字被誤數）、偽元素改記成型別 token
  const s = selector.replace(/\[[^\]]*\]/g, '[]').replace(/::[\w-]+/g, ' x');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes =
    (s.match(/\.[\w-]+/g) || []).length +
    (s.match(/\[\]/g) || []).length +
    (s.match(/:[\w-]+/g) || []).length;
  const types = (s.match(/(^|[\s>+~,(])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 1e6 + classes * 1e3 + types;
}

// ponytail: id/first-3-classes only — good enough for a display label, not a
// guaranteed-unique CSS selector. Upgrade to full ancestor-path selector if
// collisions turn out to matter in practice.
export function cssSelector(tagName, id, classNames) {
  if (id) return `#${id}`;
  const classes = classNames.slice(0, 3).map((c) => `.${c}`).join('');
  return `${tagName.toLowerCase()}${classes}`;
}
