# Voice-Enabled Form Components

Drop-in replacements for `<textarea>` and `<input>` with built-in voice recording. The microphone button records via `useVoiceRecorder` and transcribes through `/api/voice/transcribe`. Transcribed text is appended to the current value with a space separator, so users can dictate, type, and dictate again into the same field.

```tsx
// Goal form — swap <textarea> for VoiceTextarea
import VoiceTextarea from "@/components/forms/VoiceTextarea";

<VoiceTextarea
  value={goalDescription}
  onChange={setGoalDescription}
  placeholder="Opisz swoj cel..."
  minHeight={120}
/>
```

```tsx
// Mentor form / schedule notes — swap <input> for VoiceInput
import VoiceInput from "@/components/forms/VoiceInput";

<VoiceInput
  value={mentorName}
  onChange={setMentorName}
  placeholder="Imie mentora"
/>
```
