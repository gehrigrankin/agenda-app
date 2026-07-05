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
import { $createNoteLinkNode } from "../nodes/NoteLinkNode";
import { NoteTaskContext } from "../nodes/TaskNode";

/**
 * "[[" typeahead that links to another note. Results come from the same
 * `searchAction` the ⌘K palette uses; picking one replaces the typed
 * "[[query" with an inline NoteLinkNode (title snapshot; see NoteLinkNode).
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
        const linkNode = $createNoteLinkNode({
          noteId: selectedOption.note.id,
          title: selectedOption.note.title || "Untitled",
        });
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
    [editor],
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
