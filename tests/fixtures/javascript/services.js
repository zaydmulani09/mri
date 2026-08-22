import path from 'path';
import { format, padStart as pad } from './format';
import * as strings from '../strings';
const fs = require('fs');

export function formatPath(segments) {
  return path.join(...segments);
}

function clampValue(value, low, high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export const buildKey = (table, id) => `${table}:${id}`;

const noop = () => {};

export default class ServiceRegistry {
  register(name, factory) {
    this.factories.set(name, factory);
    return this;
  }

  resolve(name) {
    return this.factories.get(name);
  }
}

class InternalCache {}

export { InternalCache as PublicCache };
