(function () {
  'use strict';

  if (!String.prototype.trimStart) {
    String.prototype.trimStart = String.prototype.trimLeft || function () {
      return this.replace(/^\s+/, '');
    };
  }
})();
