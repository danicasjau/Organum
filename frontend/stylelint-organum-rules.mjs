import stylelint from 'stylelint';
import path from 'node:path';

const {
  utils: { report, ruleMessages },
} = stylelint;

function isTokensFile(postcssResult) {
  const filePath = postcssResult.opts?.from || '';
  return path.basename(filePath) === 'tokens.css';
}

const rawColorRule = stylelint.createPlugin('organum/no-raw-colors', () => {
  const messages = ruleMessages('organum/no-raw-colors', {
    rejected: (val) => `Raw color "${val}" is forbidden outside tokens.css; use a CSS variable`,
  });
  return (root, result) => {
    if (isTokensFile(result)) return;
    root.walkDecls((decl) => {
      const m = decl.value.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
      if (m) {
        report({
          message: messages.rejected(m[0]),
          node: decl,
          result,
          ruleName: 'organum/no-raw-colors',
        });
      }
    });
  };
});

const rawPxRule = stylelint.createPlugin('organum/no-raw-px', () => {
  const messages = ruleMessages('organum/no-raw-px', {
    rejected: (val) =>
      `Raw pixel value "${val}" is forbidden outside tokens.css (only 0px and 1px allowed)`,
  });
  return (root, result) => {
    if (isTokensFile(result)) return;
    root.walkDecls((decl) => {
      const matches = decl.value.matchAll(/(?<![\w.-])(-?\d*\.?\d+)px\b/g);
      for (const match of matches) {
        const num = Number.parseFloat(match[1]);
        if (num !== 0 && num !== 1) {
          report({
            message: messages.rejected(match[0]),
            node: decl,
            result,
            ruleName: 'organum/no-raw-px',
          });
        }
      }
    });
  };
});

const noTransitionsRule = stylelint.createPlugin('organum/no-transitions', () => {
  const messages = ruleMessages('organum/no-transitions', {
    rejected: 'Transitions are forbidden (only transition: none is allowed)',
  });
  return (root, result) => {
    root.walkDecls(/^transition/, (decl) => {
      if (decl.prop === 'transition' && decl.value.trim() === 'none') return;
      report({
        message: messages.rejected,
        node: decl,
        result,
        ruleName: 'organum/no-transitions',
      });
    });
  };
});

const noDisallowedShadowsRule = stylelint.createPlugin('organum/no-disallowed-shadows', () => {
  const messages = ruleMessages('organum/no-disallowed-shadows', {
    rejected: (val) => `Disallowed shadow or blur "${val}"`,
  });
  return (root, result) => {
    if (isTokensFile(result)) return;
    root.walkDecls((decl) => {
      if (decl.prop === 'backdrop-filter' && decl.value.trim() !== 'none') {
        report({
          message: messages.rejected(decl.value),
          node: decl,
          result,
          ruleName: 'organum/no-disallowed-shadows',
        });
      }
      if (decl.prop === 'filter' && /blur\(/i.test(decl.value)) {
        report({
          message: messages.rejected(decl.value),
          node: decl,
          result,
          ruleName: 'organum/no-disallowed-shadows',
        });
      }
      if (decl.prop === 'box-shadow') {
        const val = decl.value.trim();
        if (val !== 'none' && !val.startsWith('var(--shadow-popup)') && !val.startsWith('var(--bevel-')) {
          report({
            message: messages.rejected(val),
            node: decl,
            result,
            ruleName: 'organum/no-disallowed-shadows',
          });
        }
      }
    });
  };
});

const noLargeRadiusRule = stylelint.createPlugin('organum/no-large-radius', () => {
  const messages = ruleMessages('organum/no-large-radius', {
    rejected: (val) => `Disallowed border-radius "${val}"; use 0, var(--radius-*), or 50%`,
  });
  return (root, result) => {
    if (isTokensFile(result)) return;
    root.walkDecls(/^border-.*radius$/, (decl) => {
      const tokens = decl.value.trim().split(/\s+/);
      for (const tok of tokens) {
        if (tok === '0' || tok === '0px' || tok === '50%' || /^var\(--radius-/.test(tok)) {
          continue;
        }
        report({
          message: messages.rejected(decl.value),
          node: decl,
          result,
          ruleName: 'organum/no-large-radius',
        });
      }
    });
  };
});

export default [
  rawColorRule,
  rawPxRule,
  noTransitionsRule,
  noDisallowedShadowsRule,
  noLargeRadiusRule,
];

