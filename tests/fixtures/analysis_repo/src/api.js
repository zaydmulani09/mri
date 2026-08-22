import { log } from './log';
import { validate } from 'extlib';
import * as fmt from './format';

export async function fetchUser(id) {
  log('fetching user');
  validate(id);
  fmt.pad(id, 10);
  process(id);
  formatter(id);
  return helper(id);
}

function helper(id) {
  return id;
}

function ghost() {
  return null;
}
