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
    rejected: 'Transition timings must come from --motion-* tokens (no raw durations or easings)',
  });
  return (root, result) => {
    root.walkDecls(/^transition/, (decl) => {
      const val = decl.value.trim();
      if (decl.prop === 'transition' && val === 'none') return;
      if (decl.prop === 'transition-property') return;
      // v1: motion is allowed, but only through tokens so reduced-motion can zero it.
      const usesToken = /var\(--motion-[a-z0-9-]+\)/.test(val);
      const rawTiming = /(?<![\w-])\d*\.?\d+m?s\b|cubic-bezier|steps\(|\bease\b|ease-(in|out|in-out)\b|\blinear\b/.test(
        val.replace(/var\(--motion-[a-z0-9-]+\)/g, ''),
      );
      if (usesToken && !rawTiming) return;
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
        // v1: shadows must be built from tokens (recipes --sh-*, --elev-*, legacy
        // --bevel-* / --shadow-*); raw colours and px are caught by the other rules.
        if (val !== 'none' && !/var\(--/.test(val)) {
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

const zIndexTokenRule = stylelint.createPlugin('organum/z-index-token', () => {
  const messages = ruleMessages('organum/z-index-token', {
    rejected: (val) => `z-index "${val}" must use a --z-* token from tokens.css`,
  });
  return (root, result) => {
    if (isTokensFile(result)) return;
    root.walkDecls('z-index', (decl) => {
      if (/^var\(--z-[a-z0-9-]+\)$/.test(decl.value.trim())) return;
      report({
        message: messages.rejected(decl.value),
        node: decl,
        result,
        ruleName: 'organum/z-index-token',
      });
    });
  };
});

export default [
  rawColorRule,
  rawPxRule,
  noTransitionsRule,
  noDisallowedShadowsRule,
  noLargeRadiusRule,
  zIndexTokenRule,
];
