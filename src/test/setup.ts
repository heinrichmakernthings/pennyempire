import '@testing-library/jest-dom/vitest';

// jsdom has no canvas; pixel rendering is verified in a real browser (see docs/FRONTEND.md). Keep unit output quiet.
if (typeof HTMLCanvasElement !== 'undefined') HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
