function destroyLateRequestResult(response) {
  return response;
}

const noop = () => {};

function registerLateHandlers(registry) {
  registry.on("close", destroyLateRequestResult);
  registry.on("error", noop);
  return [destroyLateRequestResult, noop];
}

const cleanup = destroyLateRequestResult;

function directCall() {
  return destroyLateRequestResult(1);
}
