function attrsToDataset(attrs) {
  const dataset = {};
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (!key.startsWith('data-')) {
      return;
    }
    const datasetKey = key.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    dataset[datasetKey] = String(value);
  });
  return dataset;
}

function normalizeClassName(value) {
  return String(value || '').trim();
}

function serializeAttrs(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== false && value !== null && value !== undefined)
    .map(([key, value]) => value === true ? key : `${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join(' ');
}

function splitSelectorList(selector) {
  return String(selector || '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function splitDescendantSelector(selector) {
  let depth = 0;
  for (let index = selector.length - 1; index >= 0; index -= 1) {
    const char = selector[index];
    if (char === ']') depth += 1;
    if (char === '[') depth -= 1;
    if (depth === 0 && /\s/.test(char)) {
      const left = selector.slice(0, index).trim();
      const right = selector.slice(index + 1).trim();
      if (left && right) {
        return [left, right];
      }
    }
  }
  return null;
}

function getAttr(element, name) {
  return element && Object.prototype.hasOwnProperty.call(element.attributes, name)
    ? String(element.attributes[name])
    : '';
}

function matchAttribute(element, expression) {
  const dollarMatch = expression.match(/^([\w-]+)\$=["']?([^"']+)["']?$/);
  if (dollarMatch) {
    return getAttr(element, dollarMatch[1]).endsWith(dollarMatch[2]);
  }
  const starMatch = expression.match(/^([\w-]+)\*=["']?([^"']+)["']?$/);
  if (starMatch) {
    return getAttr(element, starMatch[1]).includes(starMatch[2]);
  }
  const startsMatch = expression.match(/^([\w-]+)\^=["']?([^"']+)["']?$/);
  if (startsMatch) {
    return getAttr(element, startsMatch[1]).startsWith(startsMatch[2]);
  }
  const equalMatch = expression.match(/^([\w-]+)=["']?([^"']+)["']?$/);
  if (equalMatch) {
    return getAttr(element, equalMatch[1]) === equalMatch[2];
  }
  return Boolean(getAttr(element, expression));
}

function matchSimpleSelector(element, selector) {
  if (!element || !selector) {
    return false;
  }
  let working = selector.trim();
  if (working.endsWith(':checked')) {
    if (!element.checked) {
      return false;
    }
    working = working.slice(0, -8);
  }

  const attrMatches = [...working.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  working = working.replace(/\[[^\]]+\]/g, '');
  if (attrMatches.some((expression) => !matchAttribute(element, expression))) {
    return false;
  }

  const idMatch = working.match(/#([\w-]+)/);
  if (idMatch && getAttr(element, 'id') !== idMatch[1]) {
    return false;
  }
  working = working.replace(/#[\w-]+/g, '');

  const classMatches = [...working.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  const classSet = new Set(normalizeClassName(element.className).split(/\s+/).filter(Boolean));
  if (classMatches.some((className) => !classSet.has(className))) {
    return false;
  }
  working = working.replace(/\.[\w-]+/g, '').trim();

  if (working && working !== '*' && working.toLowerCase() !== element.tagName.toLowerCase()) {
    return false;
  }
  return true;
}

function matchSelector(element, selector, root = null) {
  const directParts = selector.split('>').map((part) => part.trim()).filter(Boolean);
  if (directParts.length > 1) {
    const childSelector = directParts.pop();
    const parentSelector = directParts.join(' > ');
    return matchSelector(element, childSelector, root)
      && element.parentNode
      && element.parentNode !== root
      && matchSelector(element.parentNode, parentSelector, root);
  }

  const descendantParts = splitDescendantSelector(selector);
  if (descendantParts) {
    const [ancestorSelector, childSelector] = descendantParts;
    if (!matchSelector(element, childSelector, root)) {
      return false;
    }
    let parent = element.parentNode;
    while (parent && parent !== root) {
      if (matchSelector(parent, ancestorSelector, root)) {
        return true;
      }
      parent = parent.parentNode;
    }
    return Boolean(parent && matchSelector(parent, ancestorSelector, root));
  }

  return matchSimpleSelector(element, selector);
}

class FakeElement {
  constructor(tagName, attrs = {}, children = []) {
    this.nodeType = 1;
    this.tagName = String(tagName || 'div').toUpperCase();
    this.attributes = { ...attrs };
    this.className = normalizeClassName(attrs.class || attrs.className || '');
    this.dataset = attrsToDataset(this.attributes);
    this.children = [];
    this.parentNode = null;
    this.hidden = Boolean(attrs.hidden);
    this.checked = Boolean(attrs.checked);
    this.disabled = Boolean(attrs.disabled);
    this.value = attrs.value === undefined ? '' : String(attrs.value);
    this.append(...children);
    if (this.value === '' && (this.tagName === 'TEXTAREA' || this.attributes.contenteditable === 'true')) {
      this.value = this.textContent;
    }
  }

  append(...children) {
    children.flat().forEach((child) => {
      const normalized = typeof child === 'string' ? new FakeTextNode(child) : child;
      normalized.parentNode = this;
      this.children.push(normalized);
    });
  }

  get id() {
    return getAttr(this, 'id');
  }

  get textContent() {
    return this.children.map((child) => child.textContent || '').join('');
  }

  get innerHTML() {
    return this.children.map((child) => child.outerHTML || child.textContent || '').join('');
  }

  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attrs = serializeAttrs(this.attributes);
    return `<${tag}${attrs ? ` ${attrs}` : ''}>${this.innerHTML}</${tag}>`;
  }

  getAttribute(name) {
    if (name === 'class') {
      return this.className;
    }
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? String(this.attributes[name]) : null;
  }

  querySelectorAll(selector) {
    const selectors = splitSelectorList(selector);
    const result = [];
    const visit = (node) => {
      if (!(node instanceof FakeElement)) {
        return;
      }
      if (selectors.some((entry) => matchSelector(node, entry, this))) {
        result.push(node);
      }
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return result;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    const selectors = splitSelectorList(selector);
    let node = this;
    while (node) {
      if (selectors.some((entry) => matchSelector(node, entry))) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }
}

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text || '');
    this.outerHTML = this.textContent;
    this.parentNode = null;
  }
}

function el(tagName, attrs = {}, children = []) {
  return new FakeElement(tagName, attrs, children);
}

function createFakeDocument(body, options = {}) {
  return {
    title: options.title || 'Synthetic WebFRED Step 1',
    body,
    documentElement: body,
    querySelector(selector) {
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      return body.querySelectorAll(selector);
    },
  };
}

function createFakeWindow(href = 'https://orientation.nbme.org/webfred/#/main?program=Step%201&exam=Free%20120') {
  return {
    location: new URL(href),
    performance: { now: () => 1000 },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
}

export { FakeElement, el, createFakeDocument, createFakeWindow };
