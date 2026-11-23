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
// Effects are only recorded; a test that wants them to run calls flushEffects(view) (below).
export function useEffect(effect, deps) { const hook = slot(() => ({})); hook.effect = effect; hook.deps = deps; }
export function useLayoutEffect(effect, deps) { const hook = slot(() => ({})); hook.effect = effect; hook.deps = deps; }
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
  // Its value is seen by useContext while its children are expanded (expand below), as in React.
  context.Provider._context = context;
  return context;
}
export function useContext(context) { return context?._value; }
export class Component {
  constructor(props) { this.props = props; }
  setState(next) { this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) }; }
}
// lazy(): the module starts loading at once; the component renders nothing until it has
// loaded (a test awaits a tick and rerenders). Suspense just renders its children.
export function lazy(load) {
  const holder = { component: null };
  holder.ready = load().then((module) => { holder.component = module.default; });
  function LazyComponent(props) {
    return holder.component ? { type: holder.component, props } : null;
  }
  LazyComponent.ready = holder.ready;
  return LazyComponent;
}
export const Suspense = ({ children }) => children;
export function memo(component) { return component; }
export function forwardRef(render) { return (props) => render(props, null); }
export const Fragment = Symbol.for("test.fragment");
export const StrictMode = ({ children }) => children;
export function createElement(type, props, ...children) {
  const merged = { ...(props ?? {}) };
  if (children.length) merged.children = children.length === 1 ? children[0] : children;
  return { type, props: merged };
}
export function jsx(type, props, key) { return key === undefined ? { type, props: props ?? {} } : { type, props: props ?? {}, key }; }
export const jsxs = jsx;
export const jsxDEV = jsx;
// dexie-react-hooks: no live database in these render tests. A query shows its default, or
// what the test returns from setLiveQuery(handler) for that query's deps.
export function useLiveQuery(query, deps, defaultValue) {
  const value = shared.liveQuery?.(deps ?? [], query);
  return value === undefined ? defaultValue : value;
}
export function setLiveQuery(handler) { shared.liveQuery = handler; }
const React = { Component, lazy, Suspense, useState, useReducer, useRef, useEffect, useLayoutEffect, useInsertionEffect, useMemo, useCallback, useId, useTransition, useDeferredValue, useSyncExternalStore, createContext, useContext, memo, forwardRef, Fragment, StrictMode, createElement };
export default React;

// Runs the effects recorded by the last render of every component, once each (opt-in).
// With { tracked: true } it behaves like React: an effect runs only when its deps changed (or it
// has none), after the cleanup of its previous run.
export function flushEffects(root, { tracked = false } = {}) {
  for (const instance of root.instances.values()) {
    for (const hook of instance.hooks) {
      if (typeof hook?.effect !== "function") continue;
      if (!tracked) { hook.effect(); continue; }
      const changed = !hook.ranDeps || !hook.deps || hook.deps.length !== hook.ranDeps.length ||
        hook.deps.some((value, index) => !Object.is(value, hook.ranDeps[index]));
      if (!changed) continue;
      if (typeof hook.cleanup === "function") hook.cleanup();
      hook.ranDeps = hook.deps ?? null;
      hook.cleanup = hook.effect();
    }
  }
}

// Renders an element tree. Function components are called with persistent hook state per
// position; the result keeps each component node (type and props) with what it rendered.
// With { unmount: true } a component that is no longer in the tree is dropped (its effect
// cleanups run), so showing it again starts it fresh, as React remounts a screen.
export function render(element, { unmount = false } = {}) {
  const root = { instances: new Map(), tree: null, seen: null };
  root.rerender = () => {
    root.seen = unmount ? new Set() : null;
    root.tree = expand(element, "root", root);
    if (unmount) {
      for (const [key, instance] of [...root.instances]) {
        if (root.seen.has(key)) continue;
        for (const hook of instance.hooks) if (typeof hook?.cleanup === "function") hook.cleanup();
        root.instances.delete(key);
      }
    }
    return root;
  };
  return root.rerender();
}

function expand(node, path, root) {
  if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}.${index}`, root));
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  if (typeof node.type === "function" && typeof node.type.prototype?.render === "function") {
    // A class component (the error boundary): one instance per position; a render error is
    // caught as React would (getDerivedStateFromError, componentDidCatch).
    const key = `${path}>${node.type.name || "anonymousClass"}|${node.key ?? ""}`;
    root.seen?.add(key);
    let holder = root.instances.get(key);
    if (!holder) {
      holder = { hooks: [], component: new node.type(node.props) };
      holder.component.state ??= {};
      root.instances.set(key, holder);
    }
    const component = holder.component;
    component.props = node.props;
    let rendered;
    try {
      rendered = expand(component.render(), key, root);
    } catch (error) {
      if (!node.type.getDerivedStateFromError) throw error;
      component.state = { ...component.state, ...node.type.getDerivedStateFromError(error) };
      component.componentDidCatch?.(error, { componentStack: "" });
      rendered = expand(component.render(), key, root);
    }
    return { type: node.type, props: node.props, rendered };
  }
  if (typeof node.type === "function") {
    const key = `${path}>${node.type.name || "anonymous"}`;
    root.seen?.add(key);
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
    const context = node.type._context;
    if (!context) return { type: node.type, props: node.props, rendered: expand(output, key, root) };
    const outer = context._value;
    context._value = node.props.value;
    try {
      return { type: node.type, props: node.props, rendered: expand(output, key, root) };
    } finally {
      context._value = outer;
    }
  }
  return { type: node.type, props: { ...node.props, children: expand(node.props.children, `${path}/${String(node.type?.toString?.() ?? node.type)}`, root) } };
}