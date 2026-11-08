"use client";

import { useEffect, useRef, useState } from "react";

/* The browser's own speech recognition (Chrome, Edge, Safari). Nothing is sent to Uprali until the text is in the box. */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** A mic button that adds what you say to a text box. */
export function MicButton({ onText, label = "Speak" }: { onText: (text: string) => void; label?: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState("");
  const rec = useRef<Recognition | null>(null);

  useEffect(() => setSupported(recognitionClass() !== null), []);
  useEffect(() => () => rec.current?.stop(), []);

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const R = recognitionClass();
    if (!R) return;
    const r = new R();
    r.lang = navigator.language || "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (said) onText(said);
    };
    r.onerror = (e) => setNote(e.error === "not-allowed" ? "Allow the microphone in your browser to speak." : "Didn't catch that. Try again.");
    r.onend = () => setListening(false);
    rec.current = r;
    setNote("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }

  if (!supported) return null;
  return (
    <span className="mic">
      <button type="button" className={`btn small ${listening ? "listening" : ""}`} onClick={toggle} aria-pressed={listening}>
        {listening ? "● Listening… tap to stop" : `🎤 ${label}`}
      </button>
      {note && <span className="muted small"> {note}</span>}
    </span>
  );
}

/** Reads text aloud with the browser's own voice. */
export function ReadAloud({ text }: { text: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => setSupported(typeof window !== "undefined" && "speechSynthesis" in window), []);
  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);
  if (!supported || !text) return null;
  return (
    <button
      type="button"
      className="btn small"
      onClick={() => {
        const s = window.speechSynthesis;
        if (speaking) {
          s.cancel();
          setSpeaking(false);
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        s.cancel();
        s.speak(u);
        setSpeaking(true);
      }}
    >
      {speaking ? "■ Stop reading" : "🔊 Read it aloud"}
    </button>
  );
}

/** Joins spoken words onto what's already typed. */
export const appendSpoken = (current: string, said: string) => (current.trim() ? `${current.trimEnd()} ${said}` : said);
