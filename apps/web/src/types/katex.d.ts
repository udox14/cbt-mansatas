declare module 'katex' {
  interface KatexOptions {
    displayMode?: boolean;
    throwOnError?: boolean;
    strict?: boolean | string;
    trust?: boolean;
  }

  interface Katex {
    renderToString(expression: string, options?: KatexOptions): string;
  }

  const katex: Katex;
  export default katex;
}
