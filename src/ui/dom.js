import { isObject, normalizeString } from '../core/data.js';

function createElement(adapterDocument, tagName, options = {}, children = []) {
  const element = adapterDocument.createElement(tagName);
  if (options.id) {
    element.id = options.id;
  }
  if (options.className) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = normalizeString(options.text, '');
  }
  if (options.type) {
    element.type = options.type;
  }
  if (options.value !== undefined) {
    element.value = normalizeString(options.value, '');
  }
  if (options.hidden) {
    element.hidden = true;
  }
  if (isObject(options.dataset)) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        element.dataset[key] = String(value);
      }
    });
  }
  if (isObject(options.attributes)) {
    Object.entries(options.attributes).forEach(([name, value]) => {
      if (value !== null && value !== undefined) {
        element.setAttribute(name, String(value));
      }
    });
  }
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child === null || child === undefined) {
      return;
    }
    if (typeof child === 'string') {
      element.appendChild(adapterDocument.createTextNode(child));
      return;
    }
    element.appendChild(child);
  });
  return element;
}

function removeChildren(element) {
  while (element && element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function setMessage(messageElement, message, kind = 'info') {
  const text = normalizeString(message, '');
  messageElement.hidden = !text;
  messageElement.dataset.kind = normalizeString(kind, 'info');
  messageElement.textContent = text;
}

export { createElement, removeChildren, setMessage };
