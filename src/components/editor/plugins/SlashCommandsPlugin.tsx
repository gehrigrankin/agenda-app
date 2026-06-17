"use client";

import { useCallback, useMemo, useState } from "react";
import * as ReactDOM from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { $createCodeNode } from "@lexical/code";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import {
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Text,
  type LucideIcon,
} from "lucide-react";

class SlashOption extends MenuOption {
  title: string;
  icon: LucideIcon;
  keywords: string[];
  onSelect: () => void;

  constructor(
    title: string,
    opts: { icon: LucideIcon; keywords?: string[]; onSelect: () => void },
  ) {
    super(title);
    this.title = title;
    this.icon = opts.icon;
    this.keywords = opts.keywords ?? [];
    this.onSelect = opts.onSelect;
  }
}

function buildOptions(editor: LexicalEditor): SlashOption[] {
  const setBlock = (factory: () => ElementNode) => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      $setBlocksType(selection, factory);
    }
  };

  return [
    new SlashOption("Text", {
      icon: Text,
      keywords: ["paragraph", "plain", "p"],
      onSelect: () => setBlock(() => $createParagraphNode()),
    }),
    new SlashOption("Heading 1", {
      icon: Heading1,
      keywords: ["title", "h1", "big"],
      onSelect: () => setBlock(() => $createHeadingNode("h1")),
    }),
    new SlashOption("Heading 2", {
      icon: Heading2,
      keywords: ["h2", "subtitle"],
      onSelect: () => setBlock(() => $createHeadingNode("h2")),
    }),
    new SlashOption("Heading 3", {
      icon: Heading3,
      keywords: ["h3"],
      onSelect: () => setBlock(() => $createHeadingNode("h3")),
    }),
    new SlashOption("Bulleted list", {
      icon: List,
      keywords: ["unordered", "ul", "bullet"],
      onSelect: () =>
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    }),
    new SlashOption("Numbered list", {
      icon: ListOrdered,
      keywords: ["ordered", "ol", "number"],
      onSelect: () =>
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    }),
    new SlashOption("Checklist", {
      icon: CheckSquare,
      keywords: ["todo", "task", "check"],
      onSelect: () =>
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
    }),
    new SlashOption("Quote", {
      icon: Quote,
      keywords: ["blockquote", "citation"],
      onSelect: () => setBlock(() => $createQuoteNode()),
    }),
    new SlashOption("Code block", {
      icon: Code,
      keywords: ["snippet", "pre", "monospace"],
      onSelect: () => setBlock(() => $createCodeNode()),
    }),
    new SlashOption("Divider", {
      icon: Minus,
      keywords: ["hr", "rule", "separator", "line"],
      onSelect: () =>
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
    }),
  ];
}

export function SlashCommandsPlugin() {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);

  const options = useMemo(() => {
    const all = buildOptions(editor);
    if (!queryString) return all;
    const q = queryString.toLowerCase();
    return all.filter(
      (o) =>
        o.title.toLowerCase().includes(q) ||
        o.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [editor, queryString]);

  const triggerFn = useCallback((text: string): MenuTextMatch | null => {
    const match = /(?:^|\s)\/([a-zA-Z0-9]*)$/.exec(text);
    if (match === null) return null;
    const matchingString = match[1];
    const slashIndex = match.index + match[0].length - matchingString.length - 1;
    return {
      leadOffset: slashIndex,
      matchingString,
      replaceableString: "/" + matchingString,
    };
  }, []);

  const onSelectOption = useCallback(
    (
      selectedOption: SlashOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        nodeToRemove?.remove();
        selectedOption.onSelect();
        closeMenu();
      });
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<SlashOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchorElementRef.current && options.length
          ? ReactDOM.createPortal(
              <div className="w-60 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                <ul>
                  {options.map((option, i) => {
                    const Icon = option.icon;
                    const active = selectedIndex === i;
                    return (
                      <li key={option.key}>
                        <button
                          type="button"
                          onMouseEnter={() => setHighlightedIndex(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setHighlightedIndex(i);
                            selectOptionAndCleanUp(option);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                            active
                              ? "bg-neutral-100 dark:bg-neutral-800"
                              : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                          }`}
                        >
                          <Icon className="h-4 w-4 text-neutral-500" />
                          {option.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>,
              anchorElementRef.current,
            )
          : null
      }
    />
  );
}
