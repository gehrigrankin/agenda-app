import type { EditorThemeClasses } from "lexical";

/**
 * Lexical theme → Tailwind class map. Keep visual concerns here, not in node
 * code. Code-token classes are styled in globals.css (`.editor-content`).
 */
export const editorTheme: EditorThemeClasses = {
  paragraph: "mb-3 leading-7",
  heading: {
    h1: "mt-6 mb-2 text-3xl font-semibold tracking-tight",
    h2: "mt-5 mb-2 text-2xl font-semibold tracking-tight",
    h3: "mt-4 mb-1 text-xl font-semibold tracking-tight",
  },
  quote:
    "my-3 border-l-2 border-neutral-300 pl-4 italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-300",
  list: {
    ul: "my-2 ml-6 list-disc",
    ol: "my-2 ml-6 list-decimal",
    listitem: "mb-1 pl-1",
    nested: { listitem: "list-none" },
    checklist: "ml-1",
    listitemChecked: "editor-checked",
    listitemUnchecked: "editor-unchecked",
  },
  link: "text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400",
  hr: "my-6 border-t border-neutral-200 dark:border-neutral-700",
  code: "editor-code-block my-3 block overflow-x-auto rounded-md bg-neutral-100 p-4 font-mono text-sm leading-6 dark:bg-neutral-800",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline underline-offset-2",
    strikethrough: "line-through",
    underlineStrikethrough: "underline line-through underline-offset-2",
    code: "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.85em] text-pink-600 dark:bg-neutral-800 dark:text-pink-400",
  },
  codeHighlight: {
    atrule: "text-purple-600 dark:text-purple-400",
    attr: "text-purple-600 dark:text-purple-400",
    boolean: "text-amber-600 dark:text-amber-400",
    builtin: "text-emerald-600 dark:text-emerald-400",
    cdata: "text-neutral-500",
    char: "text-emerald-600 dark:text-emerald-400",
    class: "text-amber-600 dark:text-amber-400",
    "class-name": "text-amber-600 dark:text-amber-400",
    comment: "text-neutral-400 italic",
    constant: "text-amber-600 dark:text-amber-400",
    deleted: "text-red-600 dark:text-red-400",
    doctype: "text-neutral-500",
    entity: "text-amber-600 dark:text-amber-400",
    function: "text-blue-600 dark:text-blue-400",
    important: "text-red-600 dark:text-red-400",
    inserted: "text-emerald-600 dark:text-emerald-400",
    keyword: "text-purple-600 dark:text-purple-400",
    namespace: "text-amber-600 dark:text-amber-400",
    number: "text-amber-600 dark:text-amber-400",
    operator: "text-neutral-500 dark:text-neutral-400",
    prolog: "text-neutral-500",
    property: "text-blue-600 dark:text-blue-400",
    punctuation: "text-neutral-500 dark:text-neutral-400",
    regex: "text-red-600 dark:text-red-400",
    selector: "text-emerald-600 dark:text-emerald-400",
    string: "text-emerald-600 dark:text-emerald-400",
    symbol: "text-amber-600 dark:text-amber-400",
    tag: "text-red-600 dark:text-red-400",
    url: "text-blue-600 dark:text-blue-400",
    variable: "text-amber-600 dark:text-amber-400",
  },
};
