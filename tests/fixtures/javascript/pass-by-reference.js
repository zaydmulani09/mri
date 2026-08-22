export function destroyLateRequestResult(response) {
  return response;
}

export function registerLateHandlers(registry) {
  registry.on("close", destroyLateRequestResult);
  return [destroyLateRequestResult];
}

export const cleanup = destroyLateRequestResult;

export function directCall() {
  return destroyLateRequestResult(1);
}
