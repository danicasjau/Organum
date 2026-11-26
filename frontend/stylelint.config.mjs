export default {
  plugins: ['./stylelint-organum-rules.mjs'],
  rules: {
    'organum/no-raw-colors': true,
    'organum/no-raw-px': true,
    'organum/no-transitions': true,
    'organum/no-disallowed-shadows': true,
    'organum/no-large-radius': true,
    'organum/z-index-token': true,
  },
};

