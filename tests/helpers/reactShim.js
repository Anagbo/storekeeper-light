// A tiny stand-in for React used only by tests (see renderJsx.js). It calls function
// components directly and keeps their hook state between renders. A state update does
// NOT re-render on its own: the test calls rerender(), so two calls of a handler in a row
// see the same render's state, exactly like two taps in the same frame.
const shared = (globalThis.__posReactShim ??= { current: null });

function slot(create) {
  const instance = shared.current;
  if (!instance) throw new Error("Hook called outside a component render.");
  const index = instance.index++;
  if (!(index in instance.hooks)) instance.hooks[index] = create();
  return instance.hooks[index];
}

export function useState(initial) {
  const state = slot(() => ({ value: typeof initial === "function" ? initial() : initial }));
  const setState = (next) => {
    state.value = typeof next === "function" ? next(state.value) : next;
  };
  return [state.value, setState];
}
export function useReducer(reducer, initialArg, init) {
  const state = slot(() => ({ value: init ? init(initialArg) : initialArg }));
  return [state.value, (action) => { state.value = reducer(state.value, action); }];
}
export function useRef(initial) {
  return slot(() => ({ current: initial }));
}
export function useEffect() {}
export function useLayoutEffect() {}
export function useInsertionEffect() {}
export function useMemo(create) { return create(); }
export function useCallback(callback) { return callback; }
export function useId() { return ":test-id:"; }
export function useTransition() { return [false, (callback) => callback()]; }
export function useDeferredValue(value) { return value; }
export function useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); }
export function createContext(value) {
  const context = { _value: value };
  context.Provider = ({ children }) => children;
  return context;
}
export function useContext(context) { return context?._value; }
export function memo(component) { return component; }
export function forwardRef(render) { return (props) => render(props, null); }
export const Fragment = Symbol.for("test.fragment");
export const StrictMode = ({ children }) => children;
export function createElement(type, props, ...children) {
  const merged = { ...(props ?? {}) };
  if (children.length) merged.children = children.length === 1 ? children[0] : children;
  return { type, props: merged };
}
export function jsx(type, props) { return { type, props: props ?? {} }; }
export const jsxs = jsx;
export const jsxDEV = jsx;
// dexie-react-hooks: no live database in these render tests. A query shows its default, or
// what the test returns from setLiveQuery(handler) for that query's deps.
export function useLiveQuery(query, deps, defaultValue) {
  const value = shared.liveQuery?.(deps ?? [], query);
  return value === undefined ? defaultValue : value;
}
export function setLiveQuery(handler) { shared.liveQuery = handler; }
const React = { useState, useReducer, useRef, useEffect, useLayoutEffect, useInsertionEffect, useMemo, useCallback, useId, useTransition, useDeferredValue, useSyncExternalStore, createContext, useContext, memo, forwardRef, Fragment, StrictMode, createElement };
export default React;

// Renders an element tree. Function components are called with persistent hook state per
// position; the result keeps each component node (type and props) with what it rendered.
export function render(element) {
  const root = { instances: new Map(), tree: null };
  root.rerender = () => {
    root.tree = expand(element, "root", root);
    return root;
  };
  return root.rerender();
}

function expand(node, path, root) {
  if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}.${index}`, root));
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  if (typeof node.type === "function") {
    const key = `${path}>${node.type.name || "anonymous"}`;
    let instance = root.instances.get(key);
    if (!instance) {
      instance = { hooks: [] };
      root.instances.set(key, instance);
    }
    const previous = shared.current;
    shared.current = instance;
    instance.index = 0;
    let output;
    try {
      output = node.type(node.props);
    } finally {
      shared.current = previous;
    }
    return { type: node.type, props: node.props, rendered: expand(output, key, root) };
  }
  return { type: node.type, props: { ...node.props, children: expand(node.props.children, `${path}/${String(node.type?.toString?.() ?? node.type)}`, root) } };
}