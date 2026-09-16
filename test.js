const { JSDOM } = require("jsdom");
const dom = new JSDOM(`<!DOCTYPE html><body><script src="./bundle.js"></script></body>`);
dom.window.eval(`
  window.onerror = function(msg) { console.error("ONERROR:", msg); };
`);
const fs = require('fs');
const js = fs.readFileSync('temp/bundle.js', 'utf8');
try {
  dom.window.eval(js);
} catch (e) {
  console.error("CAUGHT:", e);
}
