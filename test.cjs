const fs = require('fs');
const js = fs.readFileSync('temp/bundle.js', 'utf8');
const vm = require('vm');
const context = {
  window: {
    process: {
      env: { NODE_ENV: 'production' },
      versions: { node: '20' },
      platform: 'browser',
      nextTick: function(cb) { setTimeout(cb, 0); },
      emit: function() { return false; },
      on: function() {},
      removeListener: function() {},
    }
  },
  document: {
    getElementById: () => ({ innerHTML: '' }),
    createElement: () => ({}),
    createTextNode: () => ({})
  },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
};
context.globalThis = context.window;
vm.createContext(context);
try {
  vm.runInContext(js, context);
  console.log("Success!");
} catch (e) {
  console.error("CAUGHT:", e);
}
