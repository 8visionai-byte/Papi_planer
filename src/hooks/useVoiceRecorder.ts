"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const MAX_RECORDING_MS = 2 * 60 * 1000; // 2 minutes
const MIN_RECORDING_MS = 500; // ignore accidental taps under 0.5s
const AUDIO_BITS_PER_SECOND = 128_000; // 128 kbps opus — clean speech quality

// RMS threshold under which we consider the recording "silent".
// Audio data is 0-255 (Uint8Array); 128 is silence midpoint.
// We compute deviation from 128 — values under ~3 mean barely any signal.
const SILENCE_RMS_THRESHOLD = 3;

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";

  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }

  return "audio/webm"; // fallback
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

  // Silence detection state
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserRafRef = useRef<number | null>(null);
  const maxRmsRef = useRef<number>(0); // peak RMS observed during recording

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (analyserRafRef.current !== null) {
      cancelAnimationFrame(analyserRafRef.current);
      analyserRafRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {
        // ignore close errors
      });
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    setError(null);
    setAudioBlob(null);
    setDuration(0);
    chunksRef.current = [];
    maxRmsRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const recorderOptions: MediaRecorderOptions = {
        mimeType,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      };
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;

      // Set up AnalyserNode for silence detection
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        analyserRef.current = analyser;

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const sampleLoop = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(buffer);
          // Compute RMS deviation from 128 (silence midpoint)
          let sumSq = 0;
          for (let i = 0; i < buffer.length; i++) {
            const dev = buffer[i] - 128;
            sumSq += dev * dev;
          }
          const rms = Math.sqrt(sumSq / buffer.length);
          if (rms > maxRmsRef.current) maxRmsRef.current = rms;
          analyserRafRef.current = requestAnimationFrame(sampleLoop);
        };
        analyserRafRef.current = requestAnimationFrame(sampleLoop);
      } catch (analyserErr) {
        // AnalyserNode is optional — if it fails, we still record without
        // silence detection.
        console.warn("[voiceRecorder] AnalyserNode setup failed:", analyserErr);
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const elapsedMs = Date.now() - startTimeRef.current;
        const peakRms = maxRmsRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeType });

        // Guard 1: minimum recording duration — ignore accidental short taps
        if (elapsedMs < MIN_RECORDING_MS) {
          console.warn(
            `[voiceRecorder] Recording too short (${elapsedMs}ms < ${MIN_RECORDING_MS}ms). Ignoring.`
          );
          setError("Nagranie zbyt krótkie — przytrzymaj dłużej.");
          setIsRecording(false);
          cleanup();
          return;
        }

        // Guard 2: silence detection — if entire recording was below threshold,
        // don't waste an API call (Whisper would hallucinate).
        if (peakRms > 0 && peakRms < SILENCE_RMS_THRESHOLD) {
          console.warn(
            `[voiceRecorder] Recording too quiet (peak RMS=${peakRms.toFixed(2)} < ${SILENCE_RMS_THRESHOLD}). Ignoring.`
          );
          setError("Nagranie zbyt ciche — spróbuj głośniej.");
          setIsRecording(false);
          cleanup();
          return;
        }

        setAudioBlob(blob);
        setIsRecording(false);
        cleanup();
      };

      recorder.onerror = () => {
        setError("Blad nagrywania");
        setIsRecording(false);
        cleanup();
      };

      recorder.start(250); // collect chunks every 250ms
      startTimeRef.current = Date.now();
      setIsRecording(true);

      // Duration timer
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Auto-stop after 2 minutes
      autoStopRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      cleanup();
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
