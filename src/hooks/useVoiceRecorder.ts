"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const MAX_RECORDING_MS = 2 * 60 * 1000;
const MIN_RECORDING_MS = 300;
const AUDIO_BITS_PER_SECOND = 128_000;
const LEVEL_UPDATE_HZ = 10;

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

/**
 * Enumerate available audio input devices.
 * Browser security: labels are empty until permission is granted at least once.
 * If no labels are present, this function performs a quick getUserMedia request
 * to unlock device labels, then re-enumerates.
 */
export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  let devices = await navigator.mediaDevices.enumerateDevices();
  let audioInputs = devices.filter((d) => d.kind === "audioinput");

  // If labels are empty, we need permission first. Trigger a quick prompt.
  const labelsMissing = audioInputs.length > 0 && audioInputs.every((d) => !d.label);
  if (labelsMissing) {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
      audioInputs = devices.filter((d) => d.kind === "audioinput");
    } catch {
      // permission denied — return what we have (labels will be empty)
    }
  }

  return audioInputs;
}

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentLevel, setCurrentLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>("audio/webm");

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (meterTimerRef.current) {
      clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (meterStreamRef.current) {
      meterStreamRef.current.getTracks().forEach((t) => t.stop());
      meterStreamRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setCurrentLevel(0);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const startRecording = useCallback(
    async (deviceId?: string) => {
      setError(null);
      setAudioBlob(null);
      setDuration(0);
      setCurrentLevel(0);
      chunksRef.current = [];

      try {
        console.log(
          `[voiceRecorder] Requesting mic permission... ${deviceId ? `(deviceId=${deviceId})` : "(default device)"}`
        );

        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (deviceId) {
          audioConstraints.deviceId = { exact: deviceId };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
        streamRef.current = stream;

        const tracks = stream.getAudioTracks();
        console.log(
          `[voiceRecorder] Got stream with ${tracks.length} audio tracks. ` +
            `Track 0: label='${tracks[0]?.label}' enabled=${tracks[0]?.enabled} readyState=${tracks[0]?.readyState}`
        );

        // Set up level meter using a CLONED stream so it cannot conflict with MediaRecorder
        try {
          const meterStream = stream.clone();
          meterStreamRef.current = meterStream;

          const AudioCtx: typeof AudioContext =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const audioCtx = new AudioCtx();
          audioCtxRef.current = audioCtx;

          const source = audioCtx.createMediaStreamSource(meterStream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.6;
          source.connect(analyser);
          analyserRef.current = analyser;

          const buffer = new Uint8Array(analyser.fftSize);

          meterTimerRef.current = setInterval(() => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteTimeDomainData(buffer);
            // Compute RMS deviation from midpoint (128)
            let sumSquares = 0;
            for (let i = 0; i < buffer.length; i++) {
              const normalized = (buffer[i] - 128) / 128;
              sumSquares += normalized * normalized;
            }
            const rms = Math.sqrt(sumSquares / buffer.length);
            // Scale to 0-1 with a small boost so quiet speech still registers visually
            const level = Math.min(1, rms * 2.5);
            setCurrentLevel(level);
          }, Math.floor(1000 / LEVEL_UPDATE_HZ));
        } catch (meterErr) {
          // Level meter is purely cosmetic — never block recording on its failure
          console.warn("[voiceRecorder] Level meter setup failed (continuing without):", meterErr);
        }

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
            console.log(
              `[voiceRecorder] chunk: ${e.data.size} bytes (total chunks: ${chunksRef.current.length})`
            );
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
            console.warn(
              `[voiceRecorder] Blob too small (${blob.size} bytes). Mic may not be capturing.`
            );
            setError(
              `Mikrofon nie wychwytuje dźwięku (blob: ${blob.size} bajtów). Wybierz inny mikrofon (⚙) lub sprawdź uprawnienia.`
            );
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
          setError("Błąd nagrywania — spróbuj ponownie.");
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
            setError("Brak dostępu do mikrofonu. Zezwól w ustawieniach przeglądarki.");
          } else if (err.name === "NotFoundError") {
            setError("Nie znaleziono wybranego mikrofonu. Wybierz inne urządzenie (⚙).");
          } else if (err.name === "OverconstrainedError") {
            setError("Wybrany mikrofon jest niedostępny. Wybierz inne urządzenie (⚙).");
          } else if (err.name === "NotReadableError") {
            setError("Mikrofon zajęty przez inną aplikację. Zamknij ją i spróbuj ponownie.");
          } else {
            setError(`Błąd mikrofonu: ${err.message}`);
          }
        } else {
          setError("Nie udało się uruchomić nagrywania.");
        }
      }
    },
    [cleanup]
  );

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
    currentLevel,
  };
}
