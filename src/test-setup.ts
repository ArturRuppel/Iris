import "@testing-library/jest-dom/vitest";

/* --- React Flow (@xyflow/react) needs these DOM APIs that jsdom lacks. Without
   them ReactFlow throws on mount in tests. Standard React Flow test shim. --- */
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;

class DOMMatrixReadOnlyMock {
  m22 = 1;
  constructor(_t?: string) {}
}
(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyMock;

Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return 100; } });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 100; } });
(globalThis as unknown as { SVGElement: { prototype: { getBBox?: unknown } } }).SVGElement.prototype.getBBox =
  () => ({ x: 0, y: 0, width: 0, height: 0 });
