/**
 * Minimal CSInterface — just what the Yoink panel needs.
 *
 * Adobe's full CSInterface.js (Adobe-CEP/CEP-Resources on GitHub) provides
 * a much larger API surface. This trimmed copy exposes only:
 *   - evalScript(script, callback)         — call ExtendScript from the panel
 *   - getHostEnvironment()                 — get host app info (version, theme)
 *   - getSystemPath(type)                  — resolve standard CEP paths
 *   - openURLInDefaultBrowser(url)         — open in the user's browser
 *
 * If something more advanced is needed later, swap in the full file from
 * https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_*_x/CSInterface.js
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (typeof window !== 'undefined' && window.__adobe_cep__) {
    window.__adobe_cep__.evalScript(script, callback || function () {});
  } else if (callback) {
    callback('EvalScript error: __adobe_cep__ not available');
  }
};

CSInterface.prototype.getHostEnvironment = function () {
  if (typeof window !== 'undefined' && window.__adobe_cep__) {
    try { return JSON.parse(window.__adobe_cep__.getHostEnvironment()); } catch (e) { return null; }
  }
  return null;
};

CSInterface.prototype.getSystemPath = function (pathType) {
  if (typeof window !== 'undefined' && window.__adobe_cep__) {
    return window.__adobe_cep__.getSystemPath(pathType);
  }
  return '';
};

CSInterface.prototype.openURLInDefaultBrowser = function (url) {
  if (typeof window !== 'undefined' && window.cep && window.cep.util) {
    window.cep.util.openURLInDefaultBrowser(url);
  }
};

CSInterface.prototype.requestOpenExtension = function (id, params) {
  if (typeof window !== 'undefined' && window.__adobe_cep__) {
    window.__adobe_cep__.requestOpenExtension(id, params || '');
  }
};

// Standard CEP path-type constants
var SystemPath = {
  USER_DATA:    'userData',
  COMMON_FILES: 'commonFiles',
  MY_DOCUMENTS: 'myDocuments',
  EXTENSION:    'extension',
  HOST_APPLICATION: 'hostApplication'
};

// Make it available as a global so legacy code expecting CSInterface as a
// "module" (without modules) just works.
if (typeof window !== 'undefined') {
  window.CSInterface = CSInterface;
  window.SystemPath = SystemPath;
}
