(function () {
  'use strict';

  if (!String.prototype.trimStart) {
    String.prototype.trimStart = String.prototype.trimLeft || function () {
      return this.replace(/^\s+/, '');
    };
  }

  // 2016 WebKit (Tizen 2.4): DOM methods the legacy build's JavaScript polyfills can't add.
  var E = window.Element && Element.prototype;
  if (E && !E.matches) E.matches = E.webkitMatchesSelector;
  if (E && !E.closest) {
    E.closest = function (selector) {
      for (var el = this; el && el.nodeType === 1; el = el.parentNode) if (el.matches(selector)) return el;
      return null;
    };
  }
  if (E && !E.prepend) {
    E.prepend = function () {
      for (var i = arguments.length - 1; i >= 0; i--) {
        var n = arguments[i];
        this.insertBefore(typeof n === 'string' ? document.createTextNode(n) : n, this.firstChild);
      }
    };
  }
  if (window.NodeList && !NodeList.prototype.forEach) NodeList.prototype.forEach = Array.prototype.forEach;
})();
