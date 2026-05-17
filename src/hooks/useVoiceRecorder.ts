"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const MAX_RECORDING_MS = 2 * 60 * 1000;
const MIN_RECORDING_MS = 300;
const AUDIO_BITS_PER_SECOND = 128_000;

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";

  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }

  return "audio/webm";
}

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>("audio/webm");

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    setError(null);
    setAudioBlob(null);
    setDuration(0);
    chunksRef.current = [];

    try {
      console.log("[voiceRecorder] Requesting mic permission...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const tracks = stream.getAudioTracks();
      console.log(
        `[voiceRecorder] Got stream with ${tracks.length} audio tracks. ` +
        `Track 0: label='${tracks[0]?.label}' enabled=${tracks[0]?.enabled} readyState=${tracks[0]?.readyState}`
      );

      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;
      console.log(`[voiceRecorder] Using mimeType: ${mimeType}`);

      const recorderOptions: MediaRecorderOptions = {
        mimeType,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      };
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          console.log(`[voiceRecorder] chunk: ${e.data.size} bytes (total chunks: ${chunksRef.current.length})`);
        }
      };

      recorder.onstop = () => {
        const elapsedMs = Date.now() - startTimeRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeType });

        console.log(
          `[voiceRecorder] STOP: duration=${elapsedMs}ms, chunks=${chunksRef.current.length}, blob=${blob.size} bytes, type=${blob.type}`
        );

        if (elapsedMs < MIN_RECORDING_MS) {
          console.warn(`[voiceRecorder] Too short (${elapsedMs}ms). Ignoring.`);
          setError("Nagranie zbyt krótkie — przytrzymaj dłużej.");
          setIsRecording(false);
          cleanup();
          return;
        }

        if (blob.size < 1000) {
          console.warn(`[voiceRecorder] Blob too small (${blob.size} bytes). Mic may not be capturing.`);
          setError(`Mikrofon nie nagrywa (blob: ${blob.size} bajtów). Sprawdź uprawnienia.`);
          setIsRecording(false);
          cleanup();
          return;
        }

        setAudioBlob(blob);
        setIsRecording(false);
        cleanup();
      };

      recorder.onerror = (e) => {
        console.error("[voiceRecorder] MediaRecorder error", e);
        setError("Blad nagrywania");
        setIsRecording(false);
        cleanup();
      };

      recorder.start(250);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      console.log("[voiceRecorder] Recording started.");

      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      cleanup();
      console.error("[voiceRecorder] getUserMedia failed", err);
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError") {
          setError("Brak dostepu do mikrofonu. Zezwol w ustawieniach przegladarki.");
        } else if (err.name === "NotFoundError") {
          setError("Nie znaleziono mikrofonu.");
        } else {
          setError(`Blad mikrofonu: ${err.message}`);
        }
      } else {
        setError("Nie udalo sie uruchomic nagrywania");
      }
    }
  }, [cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    error,
    duration,
  };
}
