function destroyLateRequestResult(response) {
  return response;
}

function registerLateHandlers(registry) {
  registry.on("close", destroyLateRequestResult);
  return [destroyLateRequestResult];
}

const lateNoop = () => {};

function scheduleWith(registry) {
  registry.on("close", lateNoop);
}
