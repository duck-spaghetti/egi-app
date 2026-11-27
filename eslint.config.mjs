/** Focused correctness rules; browser and CommonJS fixture globals stay separate. */
const readonly = names => Object.fromEntries(names.split(' ').map(name => [name, 'readonly']));
const rules = {'no-undef':'error','no-unreachable':'error','no-dupe-args':'error','no-dupe-keys':'error','valid-typeof':'error'};
export default [
  {files:['app/frontend/static/js/**/*.js'], languageOptions:{ecmaVersion:'latest', sourceType:'module', globals:readonly('window document confirm alert prompt structuredClone AbortSignal navigator location history console fetch localStorage sessionStorage performance crypto URL URLSearchParams Headers Request Response AbortController DOMException HTMLElement HTMLInputElement HTMLSelectElement Element Event CustomEvent MouseEvent KeyboardEvent Option IntersectionObserver ResizeObserver MutationObserver requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval getComputedStyle atob btoa matchMedia L')}, rules},
  {files:['tests/**/*.cjs'], languageOptions:{ecmaVersion:'latest',sourceType:'commonjs',globals:readonly('console process Buffer __dirname __filename structuredClone TextEncoder TextDecoder URL URLSearchParams fetch setTimeout clearTimeout setInterval clearInterval setImmediate clearImmediate performance crypto AbortController AbortSignal DOMException Event EventTarget')},rules}
];
