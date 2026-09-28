import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/events';

describe('EventBus (T1.9)', () => {
  it('delivers typed events to matching and wildcard subscribers', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const any = vi.fn();
    bus.on('stack:sealed', a);
    bus.onAny(any);
    bus.emit({ type: 'stack:sealed', x: 1, y: 2 });
    bus.emit({ type: 'phase:changed', phase: 'action' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing handler from the others', () => {
    const bus = new EventBus();
    bus.onError = () => {};
    const ok = vi.fn();
    bus.on('stack:sealed', () => {
      throw new Error('boom');
    });
    bus.on('stack:sealed', ok);
    bus.emit({ type: 'stack:sealed', x: 0, y: 0 });
    expect(ok).toHaveBeenCalled();
  });

  it('unsubscribes', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('stack:sealed', fn);
    off();
    bus.emit({ type: 'stack:sealed', x: 0, y: 0 });
    expect(fn).not.toHaveBeenCalled();
  });
});
