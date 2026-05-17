// React 19 requires this flag for tests that use the legacy `act()` semantics
// (anything wrapped in React Testing Library's render(), createRoot(), etc.).
// Without it, every test logs a "current testing environment is not configured
// to support act(...)" warning even though the test itself passes.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
