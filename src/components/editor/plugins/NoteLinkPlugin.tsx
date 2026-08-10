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
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $insertNodes,
  $isElementNode,
  type TextNode,
} from "lexical";
import {
  CalendarDays,
  CircleDashed,
  CornerDownRight,
  FileText,
  Plus,
} from "lucide-react";

import {
  createCardAnchorAction,
  quickCreateNoteAction,
  searchAction,
  type SearchNoteResult,
} from "@/app/app/actions";
import { useDailyEditor } from "../DailyEditorContext";
import {
  $createLinkedNoteCardNode,
  $isLinkedNoteCardNode,
} from "../nodes/LinkedNoteCardNode";
import { $createLogHeadingNode } from "../nodes/LogHeadingNode";
import { $createNoteLinkNode } from "../nodes/NoteLinkNode";
import { $createTimedParagraphNode } from "../nodes/TimedParagraphNode";
import { NoteTaskContext } from "../nodes/TaskNode";

/**
 * "[[" typeahead that links to another note. Results come from the same
 * `searchAction` the ⌘K palette uses. Picking one replaces the typed
 * "[[query" with an inline NoteLinkNode chip — or, in the DAILY editor, a
 * block-level LinkedNoteCardNode inserted after the current block with a
 * fresh timed paragraph to keep writing in (design Turn 10).
 *
 * Typing "[[+" instead switches to LOG mode: the same search and the same
 * link, but it lands as a LogHeadingNode — a heading in THIS note whose
 * section is mirrored onto the target's Logs panel. The three modes differ
 * only in where the writing ends up:
 *   [[   chip  — a reference; you go there to read it
 *   [[   card  — an editable window; you write INTO the other note (daily)
 *   [[+  log   — you write HERE and the other note receives a timestamped copy
 */

/** True when the matched text opened with "[[+" rather than "[[". */
function isLogTrigger(node: TextNode): boolean {
  return node.getTextContent().startsWith("[[+");
}

/**
 * Drop a log heading after `anchorBlockKey`, seeded with the target's title,
 * and put the caret on a fresh paragraph beneath it — which is already inside
 * the heading's section, so the first thing typed is the first thing logged.
 */
function insertLogHeading(
  fields: { noteId: string; title: string },
  anchorBlockKey: string | null,
): void {
  const heading = $createLogHeadingNode(
    "h2",
    crypto.randomUUID(),
    fields.noteId,
    fields.title,
  );
  heading.append($createTextNode(fields.title));

  const anchorBlock = anchorBlockKey ? $getNodeByKey(anchorBlockKey) : null;
  if (anchorBlock && $isElementNode(anchorBlock) && anchorBlock.isAttached()) {
    anchorBlock.insertAfter(heading);
  } else {
    $insertNodes([heading]);
  }

  // A plain paragraph, not a timed one: the log's timestamp comes from when
  // the row was written, and per-block times inside a logged section would
  // read as a second, disagreeing clock.
  const body = $createParagraphNode();
  heading.insertAfter(body);
  body.select();
}

class NoteLinkOption extends MenuOption {
  /** null = the trailing "create a new note" option. */
  note: SearchNoteResult | null;
  createTitle: string | null;

  constructor(note: SearchNoteResult | null, createTitle: string | null = null) {
    super(note ? note.id : `create:${createTitle ?? ""}`);
    this.note = note;
    this.createTitle = createTitle;
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
  const { isDaily, sourceNoteId, sourceTitle } = useDailyEditor();

  /**
   * Give a freshly inserted card a section of its own on the target note.
   *
   * Fire-and-forget by design: the card is already in the document and usable,
   * and the anchor id lands on the node a moment later (`setAnchorId`). If the
   * round-trip fails the card stays unscoped and shows the whole target note —
   * the behavior every card had before scoping — rather than blocking the
   * insert or leaving a card pointing at a boundary that was never written.
   */
  const attachAnchor = useCallback(
    (cardKey: string, targetNoteId: string) => {
      const from = sourceNoteId ?? currentNoteId;
      if (!from || !targetNoteId) return;
      createCardAnchorAction(targetNoteId, from, sourceTitle ?? "")
        .then((res) => {
          if (!res) return;
          editor.update(() => {
            const node = $getNodeByKey(cardKey);
            if ($isLinkedNoteCardNode(node)) node.setAnchorId(res.anchorId);
          });
        })
        .catch((err) => {
          console.error("[cards] anchor create failed:", err);
        });
    },
    [editor, sourceNoteId, sourceTitle, currentNoteId],
  );

  const [queryString, setQueryString] = useState<string | null>(null);
  const [results, setResults] = useState<SearchNoteResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Monotonic request id so a slow response can't clobber a newer one.
  const requestIdRef = useRef(0);
  /** Set by triggerFn; drives the menu's label only (see triggerFn). */
  const logModeRef = useRef(false);

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

  const options = useMemo(() => {
    const list = results
      .filter((n) => n.id !== currentNoteId)
      .map((n) => new NoteLinkOption(n));
    // "Create" tail option: always offered for any non-empty query, even
    // when an exact title match already exists — users may want a second
    // note with the same title.
    const q = (queryString ?? "").trim();
    if (q) {
      list.push(new NoteLinkOption(null, q));
    }
    return list;
  }, [results, currentNoteId, queryString]);

  // useBasicTypeaheadTriggerMatch only supports single-char triggers, so this
  // is a hand-rolled matcher for the two-char "[[" trigger. The optional "+"
  // is the log variant: "[[+Acme" links the same way but lands as a heading
  // whose section gets logged onto the target.
  const triggerFn = useCallback((text: string): MenuTextMatch | null => {
    const match = /\[\[(\+?)([^+\[\]]*)$/.exec(text);
    if (match === null) return null;
    // Purely so the menu can label itself; the insert reads the mode back off
    // the matched text node, which can't drift out of sync with what's typed.
    logModeRef.current = match[1] === "+";
    return {
      leadOffset: match.index,
      matchingString: match[2],
      replaceableString: "[[" + match[1] + match[2],
    };
  }, []);

  const onSelectOption = useCallback(
    (
      selectedOption: NoteLinkOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      // Create-new flow: drop the typed "[[query" now, then insert the chip
      // (or daily card) once the server hands back the new note's id. The
      // user stays right where they are — no navigation.
      if (selectedOption.note === null) {
        const title = selectedOption.createTitle || "Untitled";
        let anchorBlockKey: string | null = null;
        let logMode = false;
        editor.update(() => {
          if (nodeToRemove) {
            logMode = isLogTrigger(nodeToRemove);
            if (isDaily || logMode) {
              anchorBlockKey = nodeToRemove.getTopLevelElementOrThrow().getKey();
            }
            nodeToRemove.remove();
          }
        });
        closeMenu();
        quickCreateNoteAction(title)
          .then(({ id, title: createdTitle }) => {
            editor.update(() => {
              const fields = { noteId: id, title: createdTitle || "Untitled" };
              if (logMode) {
                insertLogHeading(fields, anchorBlockKey);
                return;
              }
              if (isDaily) {
                const card = $createLinkedNoteCardNode(fields);
                const anchorBlock = anchorBlockKey
                  ? $getNodeByKey(anchorBlockKey)
                  : null;
                if (
                  anchorBlock &&
                  $isElementNode(anchorBlock) &&
                  anchorBlock.isAttached()
                ) {
                  anchorBlock.insertAfter(card);
                } else {
                  $insertNodes([card]);
                }
                const continuation = $createTimedParagraphNode();
                card.insertAfter(continuation);
                continuation.select();
                attachAnchor(card.getKey(), id);
                return;
              }
              const linkNode = $createNoteLinkNode(fields);
              $insertNodes([linkNode]);
              const spaceNode = $createTextNode(" ");
              linkNode.insertAfter(spaceNode);
              spaceNode.select();
            });
          })
          .catch((err) => {
            console.error("[note-links] create failed:", err);
          });
        return;
      }

      editor.update(() => {
        const fields = {
          noteId: selectedOption.note!.id,
          title: selectedOption.note!.title || "Untitled",
        };

        // "[[+" wins over the daily card: the point of a log heading is that
        // what you write STAYS in this note and is mirrored to the target,
        // which is the opposite of the card's write-into-the-other-note.
        if (nodeToRemove && isLogTrigger(nodeToRemove)) {
          const anchorBlock = nodeToRemove.getTopLevelElementOrThrow();
          nodeToRemove.remove();
          insertLogHeading(fields, anchorBlock.getKey());
          closeMenu();
          return;
        }

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
          attachAnchor(card.getKey(), fields.noteId);
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
    [editor, isDaily, attachAnchor],
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
              <div className="w-64 overflow-hidden rounded-lg border border-white/8 bg-card py-1 shadow-lg">
                {/* "[[+" looks almost identical to "[[" while typing — say
                    which one is armed before the pick, not after. */}
                {logModeRef.current && (
                  <div className="flex items-center gap-1.5 border-b border-white/8 px-3 pb-1.5 pt-1 text-[0.6875rem] font-medium text-sage">
                    <CornerDownRight className="h-3 w-3" />
                    Log under a heading
                  </div>
                )}
                {options.length ? (
                  <ul>
                    {options.map((option, i) => {
                      const isCreate = option.note === null;
                      const Icon = isCreate ? Plus : noteIcon(option.note!);
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
                                ? "bg-white/8"
                                : "hover:bg-white/5"
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0 text-ink-500" />
                            <span className="min-w-0 flex-1 truncate">
                              {isCreate
                                ? `Create “${option.createTitle}”`
                                : option.note!.title || "Untitled"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="px-3 py-2 text-sm italic text-ink-400">
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
