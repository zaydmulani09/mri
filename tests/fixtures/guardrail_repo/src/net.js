import https from 'https';

export function ping(url) {
  return https.get(url);
}
