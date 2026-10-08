import { describe, expect, it, vi } from 'vitest';
import { createMountScope } from './mountScope';

describe('mount resource ownership', () => {
  it('aborts and releases resources exactly once, in reverse mounting order', () => {
    const scope = createMountScope();
    const released: string[] = [];
    scope.own('scene', item => released.push(item));
    scope.own('controls', item => released.push(item));
    scope.dispose();
    scope.dispose();
    expect(scope.signal.aborted).toBe(true);
    expect(released).toEqual(['controls', 'scene']);
  });
  it('immediately releases a resource that arrives after unmount', () => {
    const scope = createMountScope();
    const release = vi.fn();
    scope.dispose();
    const resource = {};
    expect(scope.own(resource, release)).toBe(resource);
    expect(release).toHaveBeenCalledExactlyOnceWith(resource);
  });
});
