"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as ReactDOM from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode, $insertNodes, type TextNode } from "lexical";
import { CalendarDays, CircleDashed, FileText } from "lucide-react";

import { searchAction, type SearchNoteResult } from "@/app/app/actions";
import { useDailyEditor } from "../DailyEditorContext";
import { $createLinkedNoteCardNode } from "../nodes/LinkedNoteCardNode";
import { $createNoteLinkNode } from "../nodes/NoteLinkNode";
import { $createTimedParagraphNode } from "../nodes/TimedParagraphNode";
import { NoteTaskContext } from "../nodes/TaskNode";

/**
 * "[[" typeahead that links to another note. Results come from the same
 * `searchAction` the ⌘K palette uses. Picking one replaces the typed
 * "[[query" with an inline NoteLinkNode chip — or, in the DAILY editor, a
 * block-level LinkedNoteCardNode inserted after the current block with a
 * fresh timed paragraph to keep writing in (design Turn 10).
 */

class NoteLinkOption extends MenuOption {
  note: SearchNoteResult;

  constructor(note: SearchNoteResult) {
    super(note.id);
    this.note = note;
  }
}

/** Same note-kind icons as the command palette. */
function noteIcon(note: SearchNoteResult) {
  if (note.dailyDate) return CalendarDays;
  if (note.bubbleId) return CircleDashed;
  return FileText;
}

export function NoteLinkPlugin() {
  const [editor] = useLexicalComposerContext();
  // The hosting note (provided by NoteEditor for tasks) — reused here to
  // exclude the current note from the link candidates.
  const currentNoteId = useContext(NoteTaskContext)?.noteId ?? null;
  const { isDaily } = useDailyEditor();

  const [queryString, setQueryString] = useState<string | null>(null);
  const [results, setResults] = useState<SearchNoteResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Monotonic request id so a slow response can't clobber a newer one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const q = queryString?.trim() ?? "";
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchAction(q)
      .then((res) => {
        if (requestIdRef.current !== requestId) return;
        setResults(res.notes);
        setSearching(false);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        console.error("[note-links] search failed:", err);
        setResults([]);
        setSearching(false);
      });
  }, [queryString]);

  const options = useMemo(
    () =>
      results
        .filter((n) => n.id !== currentNoteId)
        .map((n) => new NoteLinkOption(n)),
    [results, currentNoteId],
  );

  // useBasicTypeaheadTriggerMatch only supports single-char triggers, so this
  // is a hand-rolled matcher for the two-char "[[" trigger.
  const triggerFn = useCallback((text: string): MenuTextMatch | null => {
    const match = /\[\[([^\[\]]*)$/.exec(text);
    if (match === null) return null;
    return {
      leadOffset: match.index,
      matchingString: match[1],
      replaceableString: "[[" + match[1],
    };
  }, []);

  const onSelectOption = useCallback(
    (
      selectedOption: NoteLinkOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        const fields = {
          noteId: selectedOption.note.id,
          title: selectedOption.note.title || "Untitled",
        };

        if (isDaily) {
          // Daily editor: a block CARD after the current block (the typed
          // line stays as the lead-in), then a fresh timed paragraph so the
          // timeline continues below the card.
          const card = $createLinkedNoteCardNode(fields);
          if (nodeToRemove) {
            const anchorBlock = nodeToRemove.getTopLevelElementOrThrow();
            // Drop the "[[query" text, then hang the card off the block.
            nodeToRemove.remove();
            anchorBlock.insertAfter(card);
          } else {
            $insertNodes([card]);
          }
          const continuation = $createTimedParagraphNode();
          card.insertAfter(continuation);
          continuation.select();
          closeMenu();
          return;
        }

        const linkNode = $createNoteLinkNode(fields);
        if (nodeToRemove) {
          // Replaces the "[[query" text the typeahead split off for us.
          nodeToRemove.replace(linkNode);
        } else {
          // Defensive: shouldn't happen with this triggerFn, but never insert
          // an unattached node.
          $insertNodes([linkNode]);
        }
        const spaceNode = $createTextNode(" ");
        linkNode.insertAfter(spaceNode);
        spaceNode.select();
        closeMenu();
      });
    },
    [editor, isDaily],
  );

  const hasQuery = (queryString?.trim() ?? "") !== "";

  return (
    <LexicalTypeaheadMenuPlugin<NoteLinkOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchorElementRef.current
          ? ReactDOM.createPortal(
              <div className="w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                {options.length ? (
                  <ul>
                    {options.map((option, i) => {
                      const Icon = noteIcon(option.note);
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
                            <Icon className="h-4 w-4 shrink-0 text-neutral-500" />
                            <span className="min-w-0 flex-1 truncate">
                              {option.note.title || "Untitled"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="px-3 py-2 text-sm italic text-neutral-400">
                    {!hasQuery
                      ? "Type a note title…"
                      : searching
                        ? "Searching…"
                        : "No matching notes"}
                  </div>
                )}
              </div>,
              anchorElementRef.current,
            )
          : null
      }
    />
  );
}
