import { EventEmitter } from 'node:events';
import type { AppEvent } from '../../shared/types';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export const events = {
  publish(e: AppEvent): void {
    emitter.emit('event', e);
  },
  subscribe(fn: (e: AppEvent) => void): () => void {
    emitter.on('event', fn);
    return () => emitter.off('event', fn);
  },
};
