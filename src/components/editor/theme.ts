import type { EditorThemeClasses } from "lexical";

/**
 * Lexical theme → Tailwind class map. Extend as nodes are added (task nodes,
 * note-links, images). Keep visual concerns here, not in node code.
 */
export const editorTheme: EditorThemeClasses = {
  paragraph: "mb-2 leading-7",
  heading: {
    h1: "mt-4 mb-2 text-2xl font-semibold",
    h2: "mt-3 mb-2 text-xl font-semibold",
    h3: "mt-3 mb-1 text-lg font-semibold",
  },
  quote: "my-2 border-l-2 border-neutral-300 pl-3 text-neutral-600",
  list: {
    ul: "ml-6 list-disc",
    ol: "ml-6 list-decimal",
    listitem: "mb-1",
    checklist: "ml-2",
    listitemChecked: "line-through text-neutral-400",
    listitemUnchecked: "",
  },
  link: "text-blue-600 underline underline-offset-2 hover:text-blue-500",
  code: "rounded bg-neutral-100 px-1 py-0.5 font-mono text-sm dark:bg-neutral-800",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline underline-offset-2",
    strikethrough: "line-through",
    code: "rounded bg-neutral-100 px-1 py-0.5 font-mono text-sm dark:bg-neutral-800",
  },
};
