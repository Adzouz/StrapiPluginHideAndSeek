'use strict';

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The scopes this repo actually has, so a typo does not slip through.
    'scope-enum': [
      1,
      'always',
      ['server', 'admin', 'overlay', 'widget', 'i18n', 'game', 'tests', 'docs', 'deps', 'ci'],
    ],
  },
};
