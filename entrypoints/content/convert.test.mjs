import assert from 'node:assert/strict';
import { toTailwind, toStyledComponent, extractUrl, cssSelector, specificity, pageInspect } from './convert.js';

// pageInspect: non-element input returns null (DOM paths need a browser, tested manually)
assert.equal(pageInspect(null, [], 0, 'info'), null);
assert.equal(pageInspect({ nodeType: 3 }, [], 0, 'subtree'), null);

// keyword mapping
assert.equal(toTailwind([['display', 'flex']]), 'flex');

// arbitrary-value fallback for unmapped keywords
assert.equal(toTailwind([['width', '10px']]), 'w-[10px]');

// unmapped property is skipped entirely
assert.equal(toTailwind([['unknown-prop', 'x']]), '');

// spaces in values become underscores (Tailwind arbitrary-value syntax)
assert.equal(
  toTailwind([['box-shadow', '0px 1px 2px rgb(0, 0, 0)']]),
  'shadow-[0px_1px_2px_rgb(0,_0,_0)]',
);

// styled-components output
const styled = toStyledComponent('div', 'color: red;\nwidth: 10px;');
assert.match(styled, /^const StyledDiv = styled\.div`/);
assert.match(styled, /^ {2}color: red;$/m);

// background-image url extraction
assert.equal(extractUrl('url("https://example.com/a.png")'), 'https://example.com/a.png');
assert.equal(extractUrl('linear-gradient(red, blue)'), null);

// selector labeling
assert.equal(cssSelector('DIV', 'header', ['a', 'b']), '#header');
assert.equal(cssSelector('DIV', '', ['a', 'b', 'c', 'd']), 'div.a.b.c');
assert.equal(cssSelector('SPAN', '', []), 'span');

// specificity（a=id, b=class/attr/pseudo-class, c=type/pseudo-element → a*1e6 + b*1e3 + c）
assert.equal(specificity('#a'), 1e6);
assert.equal(specificity('.a.b'), 2e3);
assert.equal(specificity('div p'), 2);
assert.equal(specificity('a:hover'), 1e3 + 1);
assert.equal(specificity('.a::before'), 1e3 + 1);
assert.equal(specificity('[type="text a"]'), 1e3);
assert.equal(specificity('*'), 0);
assert.ok(specificity('#x') > specificity('.a.b.c div span'));

console.log('convert.test.mjs: all assertions passed');
