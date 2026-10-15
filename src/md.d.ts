// Markdown files are bundled as plain strings (tsup `loader: { '.md': 'text' }`, and a matching
// vitest transform), so prompt text can live in editable .md templates.
declare module '*.md' {
  const content: string;
  export default content;
}
