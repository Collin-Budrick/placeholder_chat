/* Qwik WARN enhancer (dev only): surface component/file via stack trace */
(function () {
  try {
    var origWarn = console.warn;
    // Guard against double-wrapping
    if ((console.warn && console.warn.__qwikWarnPatched) || typeof origWarn !== 'function') return;
    function logStack(prefix) {
      try {
        var e = new Error(prefix || 'QWIK WARN stack');
        // Some browsers require throwing to populate stack fully
        if (!e.stack) try { throw e; } catch (_e) { e = _e; }
        (origWarn || console.log).call(console, '[qwik-warn-debug] stack:\n' + (e.stack || 'no stack'));
      } catch {}
    }
    console.warn = function () {
      try {
        var msg = arguments && arguments[0] ? String(arguments[0]) : '';
        if (msg.includes('QWIK WARN') && msg.includes('unsupported value was passed to the JSX')) {
          (origWarn || console.log).apply(console, ['[qwik-warn-debug]'].concat([].slice.call(arguments)));
          // Provide route + a short DOM hint
          try {
            var path = (globalThis.location && globalThis.location.pathname) || '';
            var active = document && document.activeElement;
            var hint = active ? (active.tagName + (active.id ? ('#' + active.id) : '') + (active.className ? ('.' + String(active.className).trim().replace(/\s+/g, '.')) : '')) : '';
            (origWarn || console.log).call(console, '[qwik-warn-debug] route:', path, 'active:', hint);
          } catch {}
          logStack();
        }
      } catch {}
      return (origWarn || console.log).apply(console, arguments);
    };
    console.warn.__qwikWarnPatched = true;
  } catch {}
})();

