"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LexicalEditor } from "lexical";
import { $createTextNode, $getRoot } from "lexical";
import {
  AlertCircle,
  Bell,
  Check,
  Link as LinkIcon,
  Loader2,
  Mic,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";

import {
  extractVoiceAction,
  keepVoiceExtractionAction,
  saveVoiceMemoAction,
} from "@/app/app/ai/actions";
import { $createTimedParagraphNode } from "@/components/editor/nodes/TimedParagraphNode";
import { TASKS_CHANGED_EVENT } from "@/components/layout/NavRail";

/**
 * Voice capture (design 14a): a header mic button on the daily note opens a
 * centered overlay that records audio, live-transcribes it (Web Speech API
 * where available), then shows the cleaned transcript next to an "extracted"
 * rail of tasks and note-link ideas. Nothing is committed until "Keep all":
 * tasks/links go through keepVoiceExtractionAction and the transcript is
 * appended to the daily editor as timed paragraphs. The raw audio is uploaded
 * as a voice memo regardless.
 */

// ---------------------------------------------------------------------------
// Minimal Web Speech API types (not in lib.dom for all targets)
// ---------------------------------------------------------------------------

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type ExtractedTask = { title: string; remindToday: boolean };
type ExtractedLink = { noteId: string; title: string; idea: string };

type PendingTask = ExtractedTask & { key: number };
type PendingLink = ExtractedLink & { key: number };

type Phase = "idle" | "starting" | "recording" | "processing" | "review" | "error";

const WAVE_BARS = 16;
const WAVE_DIM = "#3a403d";
const RED = "#D9938A";
const AMBER = "#D9B78A";

function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Paragraphs for editor insertion: split on blank lines, else single
 * newlines, else the whole text as one block. */
function splitParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let parts = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  if (parts.length === 1 && trimmed.includes("\n")) {
    parts = trimmed
      .split(/\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return parts.length > 0 ? parts : [trimmed];
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// transcript highlighting — best-effort substring match of the extracted
// phrases inside the (cleaned) transcript, per the mock: task-ish phrases get
// a sage wash, note-topic phrases go steel.
// ---------------------------------------------------------------------------

type Mark = { start: number; end: number; kind: "task" | "link" };

function computeMarks(
  text: string,
  taskPhrases: string[],
  linkPhrases: string[],
): Mark[] {
  const lower = text.toLowerCase();
  const marks: Mark[] = [];
  const add = (phrase: string, kind: Mark["kind"]) => {
    const p = phrase.trim().toLowerCase();
    if (p.length < 4) return;
    const idx = lower.indexOf(p);
    if (idx >= 0) marks.push({ start: idx, end: idx + p.length, kind });
  };
  for (const p of taskPhrases) add(p, "task");
  for (const p of linkPhrases) add(p, "link");
  marks.sort((a, b) => a.start - b.start);
  const out: Mark[] = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.start >= cursor) {
      out.push(m);
      cursor = m.end;
    }
  }
  return out;
}

function HighlightedText({
  text,
  taskPhrases,
  linkPhrases,
}: {
  text: string;
  taskPhrases: string[];
  linkPhrases: string[];
}) {
  const marks = computeMarks(text, taskPhrases, linkPhrases);
  if (marks.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let pos = 0;
  marks.forEach((m, i) => {
    if (m.start > pos) out.push(text.slice(pos, m.start));
    const seg = text.slice(m.start, m.end);
    out.push(
      m.kind === "task" ? (
        <span
          key={i}
          className="rounded-[0.125rem] border-b border-sage/40 bg-sage/14"
        >
          {seg}
        </span>
      ) : (
        <span key={i} className="border-b border-steel/35 text-steel">
          {seg}
        </span>
      ),
    );
    pos = m.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// waveform strip
// ---------------------------------------------------------------------------

function Waveform({ bars }: { bars: number[] }) {
  const padded =
    bars.length >= WAVE_BARS
      ? bars.slice(-WAVE_BARS)
      : [...Array<number>(WAVE_BARS - bars.length).fill(0), ...bars];
  const max = Math.max(0.15, ...padded);
  return (
    <div className="flex h-[1.625rem] items-center gap-[0.125rem]">
      {padded.map((v, i) => (
        <span
          key={i}
          className="w-[0.1875rem] rounded-[0.125rem]"
          style={{
            height: `${Math.round(15 + Math.min(1, v / max) * 75)}%`,
            background: v > 0.1 && v >= max * 0.62 ? "var(--color-sage)" : WAVE_DIM,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// the button + overlay
// ---------------------------------------------------------------------------

export function VoiceCaptureButton({
  noteId,
  editorRef,
  dateStr,
}: {
  /** Today's daily note id; null disables the button. */
  noteId: string | null;
  editorRef: MutableRefObject<LexicalEditor | null>;
  /** Local YYYY-MM-DD being viewed. */
  dateStr: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [manualText, setManualText] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [cleaned, setCleaned] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [capturedAt, setCapturedAt] = useState("");
  const [durationSec, setDurationSec] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState(false);

  // Everything the capture pipeline owns lives in refs so cleanup never
  // depends on render timing.
  const sessionRef = useRef(0);
  const liveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("audio/webm");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const barsRef = useRef<number[]>([]);
  const lastSampleRef = useRef(0);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startAtRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const manualRef = useRef("");
  const durationRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const open = phase !== "idle";

  /** Release every live resource (mic tracks included) without touching
   * React state — safe to run on unmount. */
  const hardCleanup = useCallback(() => {
    sessionRef.current += 1;
    liveRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      recognitionRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // already stopped
        }
      }
      recorderRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    const audio = audioElRef.current;
    if (audio) {
      audio.pause();
      audioElRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const closeOverlay = useCallback(() => {
    hardCleanup();
    setPhase("idle");
    setPlaying(false);
  }, [hardCleanup]);

  // Unmount: never leave the mic indicator on.
  useEffect(() => hardCleanup, [hardCleanup]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOverlay]);

  // -- live waveform ---------------------------------------------------------

  const waveTick = useCallback(() => {
    if (!liveRef.current) return;
    const analyser = analyserRef.current;
    const data = waveDataRef.current;
    if (analyser && data) {
      const now = performance.now();
      if (now - lastSampleRef.current >= 90) {
        lastSampleRef.current = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const d = (data[i] - 128) / 128;
          sum += d * d;
        }
        const amp = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
        barsRef.current = [...barsRef.current.slice(-(WAVE_BARS - 1)), amp];
        setBars(barsRef.current);
      }
    }
    rafRef.current = requestAnimationFrame(waveTick);
  }, []);

  // -- start -----------------------------------------------------------------

  const startCapture = async () => {
    if (!noteId || open) return;
    hardCleanup();
    const session = sessionRef.current;
    setError("");
    setElapsed(0);
    setBars([]);
    barsRef.current = [];
    setFinalText("");
    setInterimText("");
    finalRef.current = "";
    setManualText("");
    manualRef.current = "";
    setRawTranscript("");
    setCleaned(null);
    setAiAvailable(true);
    setPendingTasks([]);
    setPendingLinks([]);
    setAudioReady(false);
    setPlaying(false);
    setKeeping(false);
    setKeepError(false);
    setPhase("starting");

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone access isn't available in this browser.");
      setPhase("error");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (session === sessionRef.current) {
        setError(
          "Microphone access was denied. Allow the mic in your browser's site settings and try again.",
        );
        setPhase("error");
      }
      return;
    }
    if (session !== sessionRef.current) {
      // Closed while the permission prompt was up.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    try {
      const mime = pickMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mimeRef.current = recorder.mimeType || mime || "audio/webm";
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(500);
      recorderRef.current = recorder;
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError("Recording isn't supported in this browser.");
      setPhase("error");
      return;
    }

    // Analyser for the live waveform.
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      waveDataRef.current = new Uint8Array(analyser.fftSize);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch {
      // No waveform — recording still works.
    }

    // Live transcription where the browser offers it.
    const Ctor = getSpeechRecognitionCtor();
    setSpeechSupported(Ctor !== null);
    if (Ctor) {
      try {
        const rec = new Ctor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = navigator.language || "en-US";
        rec.onresult = (ev) => {
          let interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const result = ev.results[i];
            const text = result[0]?.transcript ?? "";
            if (result.isFinal) {
              finalRef.current = `${finalRef.current} ${text}`.trim();
            } else {
              interim += text;
            }
          }
          setFinalText(finalRef.current);
          setInterimText(interim.trim());
        };
        // Chrome ends recognition on silence; restart while still recording.
        rec.onend = () => {
          if (liveRef.current && recognitionRef.current === rec) {
            try {
              rec.start();
            } catch {
              // restart raced a stop — fine
            }
          }
        };
        rec.onerror = () => {};
        rec.start();
        recognitionRef.current = rec;
      } catch {
        setSpeechSupported(false);
      }
    }

    liveRef.current = true;
    startAtRef.current = performance.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((performance.now() - startAtRef.current) / 1000));
    }, 500);
    rafRef.current = requestAnimationFrame(waveTick);
    setPhase("recording");
  };

  // -- stop → upload + extract ------------------------------------------------

  // Interim words and speech availability are captured at the moment of stop
  // (interim state may still hold the last, never-finalized phrase).
  const interimAtStopRef = useRef("");
  const recognitionSupportedAtStopRef = useRef(true);

  const finishStop = useCallback(
    (session: number) => {
      if (session !== sessionRef.current) return;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;

      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      chunksRef.current = [];
      if (blob.size > 0) {
        audioUrlRef.current = URL.createObjectURL(blob);
        setAudioReady(true);
      }

      const transcript = (
        recognitionSupportedAtStopRef.current
          ? `${finalRef.current} ${interimAtStopRef.current}`.trim()
          : manualRef.current
      ).trim();
      setRawTranscript(transcript);

      // Upload the memo in the background — the transcript stays either way.
      if (blob.size > 0) {
        const fd = new FormData();
        fd.append("audio", blob);
        if (noteId) fd.append("noteId", noteId);
        fd.append("transcript", transcript);
        fd.append("durationSec", String(Math.round(durationRef.current)));
        saveVoiceMemoAction(fd).catch((err) => {
          console.error("[voice] memo upload failed:", err);
        });
      }

      if (!transcript) {
        setAiAvailable(false);
        setPhase("review");
        return;
      }
      extractVoiceAction(transcript)
        .then((res) => {
          if (session !== sessionRef.current) return;
          if (res === null) {
            setAiAvailable(false);
          } else {
            setAiAvailable(true);
            setCleaned(res.cleaned.trim() || null);
            setPendingTasks(res.tasks.map((t, i) => ({ ...t, key: i })));
            setPendingLinks(res.links.map((l, i) => ({ ...l, key: i })));
          }
          setPhase("review");
        })
        .catch((err) => {
          console.error("[voice] extraction failed:", err);
          if (session !== sessionRef.current) return;
          setAiAvailable(false);
          setPhase("review");
        });
    },
    [noteId],
  );

  const stopRecording = () => {
    if (phase !== "recording") return;
    const session = sessionRef.current;
    interimAtStopRef.current = interimText;
    recognitionSupportedAtStopRef.current = speechSupported;
    durationRef.current = (performance.now() - startAtRef.current) / 1000;
    setDurationSec(durationRef.current);
    setCapturedAt(
      new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    );

    // Stop the live bits but leave the frozen waveform on screen.
    liveRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      recognitionRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;

    setPhase("processing");
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => finishStop(session);
      recorder.stop();
    } else {
      finishStop(session);
    }
  };

  // -- playback ---------------------------------------------------------------

  const togglePlay = () => {
    const url = audioUrlRef.current;
    if (!url) return;
    let audio = audioElRef.current;
    if (!audio) {
      audio = new Audio(url);
      audio.onended = () => setPlaying(false);
      audioElRef.current = audio;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  // -- keep all ---------------------------------------------------------------

  const transcriptToKeep = cleaned ?? rawTranscript;

  const insertIntoEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const durLabel = formatClock(durationSec);
    editor.update(() => {
      const root = $getRoot();
      const lead = $createTimedParagraphNode();
      lead.append($createTextNode(`\u{1F399} Voice memo — ${durLabel}`));
      root.append(lead);
      for (const part of splitParagraphs(transcriptToKeep)) {
        const p = $createTimedParagraphNode();
        p.append($createTextNode(part));
        root.append(p);
      }
    });
  };

  const handleKeepAll = () => {
    if (keeping) return;
    setKeeping(true);
    setKeepError(false);
    const tasks = pendingTasks.map(({ title, remindToday }) => ({
      title,
      remindToday,
    }));
    const links = pendingLinks.map(({ noteId: id, idea }) => ({
      noteId: id,
      idea,
    }));
    const commit =
      dateStr && (tasks.length > 0 || links.length > 0)
        ? keepVoiceExtractionAction({ tasks, links, todayStr: dateStr })
        : Promise.resolve(null);
    commit
      .then(() => {
        insertIntoEditor();
        if (tasks.length > 0) {
          window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
        }
        closeOverlay();
      })
      .catch((err) => {
        console.error("[voice] keep failed:", err);
        setKeepError(true);
        setKeeping(false);
      });
  };

  // -- render ------------------------------------------------------------------

  const taskPhrases = pendingTasks.map((t) => t.title);
  const linkPhrases = pendingLinks.flatMap((l) => [l.title, l.idea]);

  const headerCaption =
    phase === "recording"
      ? `recording · ${formatClock(elapsed)}`
      : phase === "starting"
        ? "requesting microphone…"
        : phase === "error"
          ? ""
          : `captured ${capturedAt} · ${formatClock(durationSec)}`;

  const overlay = open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="animate-overlay-fade-in absolute inset-0 bg-black/60"
        onMouseDown={closeOverlay}
      />
      <div className="relative flex w-full max-w-[54rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-2xl">
        {/* header */}
        <div className="flex flex-none items-center gap-2.5 border-b border-white/7 px-[1.125rem] py-3">
          <Mic
            className={`h-3.5 w-3.5 flex-none text-[#D9938A] ${
              phase === "recording" ? "animate-pulse" : ""
            }`}
          />
          <span className="text-[0.84375rem] font-semibold text-ink-100">
            Voice memo
          </span>
          {headerCaption && (
            <span className="truncate text-[0.6875rem] text-ink-600">
              {headerCaption}
            </span>
          )}
          <div className="ml-auto flex flex-none items-center gap-2">
            {(phase === "processing" || phase === "review") && (
              <button
                type="button"
                onClick={togglePlay}
                disabled={!audioReady}
                className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5 text-[0.65625rem] font-medium text-ink-300 hover:bg-white/8 disabled:opacity-40"
              >
                {playing ? (
                  <Pause className="h-2.5 w-2.5" />
                ) : (
                  <Play className="h-2.5 w-2.5" />
                )}
                {playing ? "Pause" : "Play"}
              </button>
            )}
            <button
              type="button"
              onClick={closeOverlay}
              aria-label="Close voice capture"
              className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-600 hover:bg-white/6 hover:text-ink-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* body */}
        {phase === "error" ? (
          <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
            <AlertCircle className="h-6 w-6 text-[#D9938A]" />
            <p className="max-w-[26rem] text-[0.8125rem] leading-relaxed text-ink-400">
              {error}
            </p>
            <button
              type="button"
              onClick={closeOverlay}
              className="rounded-lg bg-white/6 px-3 py-1.5 text-[0.75rem] font-medium text-ink-300 hover:bg-white/10"
            >
              Close
            </button>
          </div>
        ) : phase === "starting" ? (
          <div className="flex items-center justify-center px-8 py-16">
            <Loader2 className="h-5 w-5 animate-spin text-ink-600" />
          </div>
        ) : phase === "recording" ? (
          <div className="flex flex-col px-[1.375rem] pb-6 pt-[1.125rem]">
            <Waveform bars={bars} />
            <div className="mt-4 max-h-[40vh] min-h-[5rem] overflow-y-auto">
              {speechSupported ? (
                finalText || interimText ? (
                  <p className="text-[0.84375rem] leading-[1.75] text-ink-300">
                    {finalText}
                    {interimText && (
                      <span className="text-ink-600">
                        {finalText ? " " : ""}
                        {interimText}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[0.8125rem] italic text-ink-600">
                    Listening — start talking and the transcript appears here.
                  </p>
                )
              ) : (
                <div>
                  <textarea
                    value={manualText}
                    onChange={(e) => {
                      setManualText(e.target.value);
                      manualRef.current = e.target.value;
                    }}
                    placeholder="Type or paste what you said…"
                    className="min-h-[6.5rem] w-full resize-none rounded-lg border border-white/8 bg-white/3 p-3 text-[0.84375rem] leading-[1.6] text-ink-300 outline-none placeholder:text-ink-600 focus:border-white/15"
                  />
                  <p className="mt-2 text-[0.65625rem] leading-relaxed text-ink-600">
                    Live transcription isn&rsquo;t available in this browser —
                    type or paste what you said.
                  </p>
                </div>
              )}
            </div>
            <div className="mt-5 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={stopRecording}
                aria-label="Stop recording"
                className="flex h-12 w-12 items-center justify-center rounded-full border border-[#D9938A]/40 bg-[#D9938A]/12 hover:bg-[#D9938A]/20"
              >
                <Square
                  className="h-4 w-4"
                  style={{ color: RED, fill: RED }}
                />
              </button>
              <span className="text-[0.65625rem] text-ink-600">
                tap to stop
              </span>
            </div>
          </div>
        ) : (
          // processing / review — two-pane layout per the mock
          <div className="flex min-h-[16rem]">
            <div className="min-w-0 flex-1 border-r border-white/7 px-[1.375rem] pb-5 pt-[1.125rem]">
              <div className="mb-3.5">
                <Waveform bars={bars} />
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                {transcriptToKeep ? (
                  splitParagraphs(transcriptToKeep).map((para, i) => (
                    <p
                      key={i}
                      className="mb-2.5 text-[0.84375rem] leading-[1.75] text-ink-300 last:mb-0"
                    >
                      <HighlightedText
                        text={para}
                        taskPhrases={taskPhrases}
                        linkPhrases={linkPhrases}
                      />
                    </p>
                  ))
                ) : (
                  <p className="text-[0.8125rem] italic text-ink-600">
                    No transcript was captured for this memo.
                  </p>
                )}
              </div>
            </div>

            {/* extraction rail */}
            <div className="flex w-[18.75rem] flex-none flex-col gap-[0.4375rem] bg-[#141618] px-[1.125rem] py-4">
              <span className="text-[0.59375rem] font-medium uppercase tracking-[0.08em] text-ink-600">
                Extracted
              </span>
              {phase === "processing" ? (
                <span className="flex items-center gap-1.5 py-2 text-[0.71875rem] text-ink-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  extracting…
                </span>
              ) : !aiAvailable ? (
                <p className="py-1 text-[0.71875rem] leading-relaxed text-ink-600">
                  AI extraction isn&rsquo;t available — the transcript is
                  still yours to keep.
                </p>
              ) : pendingTasks.length === 0 && pendingLinks.length === 0 ? (
                <p className="py-1 text-[0.71875rem] leading-relaxed text-ink-600">
                  Nothing actionable found in this memo.
                </p>
              ) : (
                <>
                  {pendingTasks.map((t) => (
                    <div
                      key={t.key}
                      className="flex items-center gap-2 rounded-[0.5625rem] border border-sage/20 bg-sage/5 px-2.5 py-2"
                    >
                      <span className="h-3.5 w-3.5 flex-none rounded-[0.25rem] border-[1.5px] border-ink-700" />
                      <span className="min-w-0 flex-1 text-[0.71875rem] leading-[1.4] text-ink-200">
                        {t.title}
                      </span>
                      {t.remindToday && (
                        <span
                          className="flex flex-none items-center gap-[0.1875rem] text-[0.59375rem] font-medium"
                          style={{ color: AMBER }}
                        >
                          <Bell className="h-2.5 w-2.5" />
                          today
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Discard task: ${t.title}`}
                        onClick={() =>
                          setPendingTasks((prev) =>
                            prev.filter((p) => p.key !== t.key),
                          )
                        }
                        className="flex-none text-ink-600 hover:text-ink-300"
                      >
                        <X className="h-[0.6875rem] w-[0.6875rem]" />
                      </button>
                    </div>
                  ))}
                  {pendingLinks.map((l) => (
                    <div
                      key={l.key}
                      className="flex items-center gap-2 rounded-[0.5625rem] border border-steel/22 bg-steel/5 px-2.5 py-2"
                    >
                      <LinkIcon className="h-3 w-3 flex-none text-steel" />
                      <span className="min-w-0 flex-1 text-[0.71875rem] leading-[1.4] text-ink-200">
                        Idea → {l.title}
                      </span>
                      <button
                        type="button"
                        aria-label={`Discard idea for ${l.title}`}
                        onClick={() =>
                          setPendingLinks((prev) =>
                            prev.filter((p) => p.key !== l.key),
                          )
                        }
                        className="flex-none text-ink-600 hover:text-ink-300"
                      >
                        <X className="h-[0.6875rem] w-[0.6875rem]" />
                      </button>
                    </div>
                  ))}
                </>
              )}

              <div className="mt-auto flex items-center gap-2 pt-2.5">
                <button
                  type="button"
                  onClick={handleKeepAll}
                  disabled={phase === "processing" || keeping}
                  className="flex flex-none items-center gap-1.5 rounded-lg bg-sage px-3 py-[0.4375rem] text-[0.6875rem] font-semibold text-sage-ink hover:bg-sage/90 disabled:opacity-50"
                >
                  {keeping ? (
                    <Loader2 className="h-[0.6875rem] w-[0.6875rem] animate-spin" />
                  ) : (
                    <Check className="h-[0.6875rem] w-[0.6875rem]" />
                  )}
                  Keep all
                </button>
                <span className="min-w-0 text-[0.59375rem] leading-[1.4] text-ink-600">
                  {keepError
                    ? "Saving failed — try again."
                    : "transcript stays either way"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={startCapture}
        disabled={noteId === null}
        aria-label="Record a voice memo"
        title={
          noteId === null
            ? "Voice capture needs today's note"
            : "Record a voice memo"
        }
        className="flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-md text-ink-400 hover:bg-white/6 hover:text-ink-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-400"
      >
        <Mic className="h-[0.9375rem] w-[0.9375rem]" />
      </button>
      {overlay && createPortal(overlay, document.body)}
    </>
  );
}
