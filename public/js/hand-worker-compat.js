(() => {
  const NativeWorker = window.Worker;
  if (typeof NativeWorker !== 'function') return;

  function MexeMundoWorker(scriptURL, options) {
    const resolved = new URL(String(scriptURL), window.location.href);
    if (resolved.pathname === '/js/hand-landmarker-worker.js') {
      return new NativeWorker('/js/hand-landmarker-worker.js?v=classic-1.7.1');
    }
    return new NativeWorker(scriptURL, options);
  }

  Object.setPrototypeOf(MexeMundoWorker, NativeWorker);
  MexeMundoWorker.prototype = NativeWorker.prototype;
  window.Worker = MexeMundoWorker;
})();
