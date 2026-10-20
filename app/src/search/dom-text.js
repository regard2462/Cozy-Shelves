// The text of a document as the full-text search sees it: the text nodes in reading order with a line break at
// every block boundary (a heading and the paragraph after it are two words, not one). The indexer window reads book
// sections this way, the reader the same sections and the text layer of PDF pages, so that a hit found in the index
// is found again on the page. Elements of interest (contents and page-list anchors) are noted with their position.
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'br', 'caption', 'center', 'dd', 'details', 'dialog', 'div', 'dl',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'li',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'rt', 'rp', 'object', 'iframe', 'canvas', 'math']);

/**
 * @param root   the element to read (a section's <body>, a PDF page's .textLayer)
 * @param marks  optional Map(element → [keys]): the position of each of these elements is reported in `marked`
 * @returns {{ pieces: Array<{ str: string, node?: Text }>, marked: Map<any, number>, length: number }}
 *   pieces: the input of textnorm.cleanText (a '\n' piece without a node at block boundaries), marked: key →
 *   position in the raw text (the pieces joined), length: the raw length
 */
export function domPieces(root, marks = null) {
  const pieces = [];
  const marked = new Map();
  let raw = 0;
  const brk = () => { if (pieces.length && pieces[pieces.length - 1].str !== '\n') { pieces.push({ str: '\n' }); raw += 1; } };
  if (!root) return { pieces, marked, length: 0 };
  // iterative walk (a deep document must not overflow the stack): [node, leaving]
  const stack = [[root, false]];
  while (stack.length) {
    const [node, leaving] = stack.pop();
    if (node.nodeType === 3) {
      const s = node.data;
      if (s) { pieces.push({ str: s, node }); raw += s.length; }
      continue;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) continue;
    const name = (node.localName || '').toLowerCase();
    if (leaving) { if (BLOCK.has(name)) brk(); continue; }
    if (marks?.has(node)) for (const key of marks.get(node)) if (!marked.has(key)) marked.set(key, raw);
    if (SKIP.has(name)) continue;
    if (BLOCK.has(name)) brk();
    stack.push([node, true]);
    for (let c = node.lastChild; c; c = c.previousSibling) stack.push([c, false]);
  }
  return { pieces, marked, length: raw };
}
