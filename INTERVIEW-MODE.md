# Interview Mode — Architecture & Implementation Plan

> How Torvi can capture system audio during an interview and selectively respond
> only to the **interviewer's questions**, ignoring the candidate's answers.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Audio Pipeline](#2-current-audio-pipeline)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Implementation Approaches](#4-implementation-approaches)
5. [Recommended Approach](#5-recommended-approach)
6. [System Prompt Design](#6-system-prompt-design)
7. [Implementation Plan](#7-implementation-plan)
8. [Data Flow Diagram](#8-data-flow-diagram)

---

## 1. Problem Statement

During a video-call interview, the user (candidate) has Torvi running with system audio capture ON.
The audio stream contains **both speakers**:

- **Interviewer** — Asks questions, provides context, gives follow-ups
- **Candidate (user)** — Answers questions, explains concepts, asks clarifications

**Goal**: Torvi should:
1. Transcribe the full conversation in real-time
2. Identify which parts are the **interviewer's questions**
3. Generate AI responses **only for those questions**
4. Ignore the candidate's own answers (the candidate knows what they said)

---

## 2. Current Audio Pipeline

```
System Audio (WASAPI loopback)
  → Rust VAD (RMS/peak state machine, 1024-sample hops)
  → PCM16 16kHz encoding
  → AssemblyAI WebSocket (u3-rt-pro model)
  → stt-partial / stt-final Tauri events
  → Frontend: final transcript → sendMessage() → AI response
```

**Key facts:**
- AssemblyAI `u3-rt-pro` model outputs `Turn` messages with `end_of_turn` flag
- Each "turn" is a continuous segment of speech separated by pauses
- Currently, **every final transcript** triggers an AI response
- No speaker differentiation — all speech treated equally

---

## 3. Proposed Architecture

### Option A: Prompt-Based Filtering (Recommended for v1)

```
System Audio → VAD → AssemblyAI STT
  → Accumulate all turns into a conversation buffer
  → Every N turns (or on silence > 3s), send buffer to AI with a special prompt
  → AI identifies interviewer questions and answers ONLY those
  → Display AI response in overlay
```

**Pros**: No additional API, works with current pipeline, simplest to implement
**Cons**: AI must infer speaker roles from context (usually reliable in interview format)

### Option B: Speaker Diarization via AssemblyAI

```
System Audio → VAD → AssemblyAI STT (with speaker labels)
  → Turns tagged as Speaker A / Speaker B
  → Identify interviewer (the one asking questions)
  → Filter: only send Speaker A turns to AI
  → AI responds to questions only
```

**Pros**: Hardware-level speaker separation, more accurate
**Cons**: AssemblyAI real-time diarization requires specific plan features; may add latency

### Option C: Dual-Channel Separation (If Available)

```
Channel 1 (System speaker output = interviewer's voice)
Channel 2 (Microphone = candidate's voice)
  → Compare channels, isolate interviewer
  → Send only interviewer audio to STT
```

**Pros**: Perfect separation
**Cons**: Requires separate mic + system audio streams; complex mixing; interviewer voice is in system audio only if it's a video call

---

## 4. Implementation Approaches

### Approach 1: Smart Prompt + Conversation Buffer (Recommended)

The simplest and most effective approach. Instead of sending each transcript turn individually to the AI, **accumulate turns** into a conversation buffer and use a specialized system prompt.

**How it works:**
1. System audio capture runs as normal
2. Each `stt-final` turn is appended to a **conversation buffer** (not sent to AI immediately)
3. A **debounce timer** (3-5 seconds of silence) triggers AI processing
4. The accumulated transcript is sent to the AI with an interview-mode system prompt
5. The AI identifies and answers only the interviewer's questions

**Why this works well:**
- In interviews, there's a natural turn-taking pattern: interviewer asks → candidate answers → pause → next question
- The AI can distinguish questions from answers by linguistic cues (interrogative words, topic introduction, follow-ups)
- The debounce timer naturally aligns with interview pauses between Q&A rounds

### Approach 2: AssemblyAI Speaker Labels

AssemblyAI's real-time API can return speaker labels when multichannel audio or diarization is enabled. The `Turn` messages would include a `speaker` field.

**Requirements:**
- AssemblyAI plan that supports real-time speaker diarization
- Modify WS connection params to enable `speaker_labels=true`
- Frontend filters turns by speaker before sending to AI

### Approach 3: Keyword + Pattern Detection

Use lightweight NLP to detect question patterns in each turn:
- Starts with "What", "How", "Why", "Can you", "Tell me", "Explain", "Describe"
- Ends with "?" 
- Short turns followed by long turns (question → answer pattern)

**Can be combined with Approach 1** as a pre-filter before the AI prompt.

---

## 5. Recommended Approach

**Use Approach 1 (Smart Prompt + Conversation Buffer)** for v1. Here's why:

1. **Zero additional cost** — Uses existing AssemblyAI + AI model subscriptions
2. **No API changes** — Current STT pipeline stays the same
3. **Works immediately** — Only frontend logic + prompt changes needed
4. **High accuracy** — Modern LLMs are excellent at role identification in conversations
5. **Graceful fallback** — If the AI can't determine roles, it still provides useful responses

**Future enhancement**: Add AssemblyAI speaker diarization (Approach 2) for hardware-level accuracy when the API supports it on the current plan.

---

## 6. System Prompt Design

### Interview Mode System Prompt

```
You are Torvi, an AI interview assistant helping a candidate during a live interview.

## Your Role
You are listening to a real-time transcript of an interview conversation. The transcript contains speech from TWO speakers:
- **Interviewer**: The person asking questions (typically shorter turns, uses interrogative phrasing)
- **Candidate**: The person answering (typically longer turns, explanatory content)

## Your Task
1. Read the conversation transcript provided
2. Identify which parts are the INTERVIEWER'S QUESTIONS
3. Provide clear, concise, technically accurate answers to ONLY the interviewer's questions
4. IGNORE the candidate's answers — do not summarize, correct, or comment on them

## How to Identify the Interviewer
- Questions typically start with: "What", "How", "Why", "Can you", "Tell me about", "Explain", "Describe", "Walk me through", "Have you ever"
- Questions end with "?" or rising intonation patterns
- Questions are usually shorter than answers
- The interviewer introduces new topics; the candidate elaborates
- Follow-up questions reference the candidate's previous answer

## Response Format
For each interviewer question you identify, respond with:

**Q: [Brief paraphrase of the question]**
[Your answer — concise, structured, technically accurate]

If you identify multiple questions, answer each one separately.

## Guidelines
- Keep answers concise (3-5 key points per question)
- Use bullet points for technical questions
- Include code snippets only when directly relevant
- If the question is behavioral (STAR format), structure as: Situation → Task → Action → Result
- If the question is about a specific technology, give practical examples
- Do NOT repeat the candidate's answer — provide YOUR best answer
- If the transcript is unclear or you can't identify a question, say so briefly
```

### Conversation Buffer Format

Send to the AI as:

```
[INTERVIEW TRANSCRIPT — Last 60 seconds]

[Turn 1] So tell me about your experience with distributed systems and how you've handled scaling challenges.

[Turn 2] Sure, so at my previous company we had a microservices architecture and I was responsible for...

[Turn 3] Interesting. How did you handle data consistency across those services?

---
Identify the interviewer's questions above and provide answers.
```

---

## 7. Implementation Plan

### Phase 1: Frontend Interview Mode Toggle

**Files to modify:**
- `src/hooks/useSystemAudio.ts` — Add interview mode state
- `src/pages/audio/index.tsx` — Add interview mode toggle UI
- `src/lib/storage/helper.ts` — Persist interview mode preference

**Changes:**
1. Add `interviewMode: boolean` state to the audio hook
2. When interview mode is ON:
   - `stt-final` turns are appended to a `conversationBuffer[]` array instead of triggering AI
   - A debounce timer (3-5s of silence) triggers the AI call
   - The AI call uses the interview-mode system prompt + accumulated buffer
   - Buffer is cleared after AI responds (or keeps last N turns for context)

### Phase 2: Conversation Buffer Logic

```typescript
// New state in useSystemAudio
const [interviewMode, setInterviewMode] = useState(false);
const conversationBufferRef = useRef<string[]>([]);
const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

// Modified stt-final handler
const handleFinalTranscript = (text: string) => {
  if (interviewMode) {
    // Accumulate turns
    conversationBufferRef.current.push(text);
    
    // Reset debounce timer
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      // Silence detected — send buffer to AI
      const transcript = conversationBufferRef.current
        .map((t, i) => `[Turn ${i + 1}] ${t}`)
        .join("\n\n");
      
      const prompt = `[INTERVIEW TRANSCRIPT — Last ${conversationBufferRef.current.length} turns]\n\n${transcript}\n\n---\nIdentify the interviewer's questions above and provide answers.`;
      
      onTranscript(prompt); // Send to AI with interview system prompt
      
      // Keep last 2 turns for context continuity
      conversationBufferRef.current = conversationBufferRef.current.slice(-2);
    }, 4000); // 4s debounce
  } else {
    // Normal mode — send immediately
    onTranscript(text);
  }
};
```

### Phase 3: Interview Mode UI

Add to the Audio page or create a floating interview mode indicator:
- Toggle switch: "Interview Mode" ON/OFF
- When ON: Show a subtle indicator on the overlay pill bar
- Live transcript preview showing accumulated turns
- Manual "Get Answer" button to force AI processing without waiting for debounce

### Phase 4: System Prompt Switching

When interview mode is active, temporarily override the system prompt:
- Save original system prompt
- Switch to interview-mode prompt
- Restore when interview mode is turned off

**OR** (better approach): Prepend the interview context to the user message itself, so the system prompt doesn't need to change. The conversation buffer is sent as the "user message" with instructions embedded.

---

## 8. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    INTERVIEW MODE FLOW                          │
│                                                                 │
│  System Audio (WASAPI)                                          │
│       │                                                         │
│       ▼                                                         │
│  Rust VAD → PCM16 → AssemblyAI WebSocket                       │
│       │                                                         │
│       ▼                                                         │
│  stt-final event (per turn)                                     │
│       │                                                         │
│       ├── [Normal Mode] ──► sendMessage(text) ──► AI Response   │
│       │                                                         │
│       └── [Interview Mode] ──► Conversation Buffer              │
│                                      │                          │
│                    Accumulate turns   │                          │
│                                      │                          │
│                    4s silence ────────┤                          │
│                    OR manual trigger  │                          │
│                                      ▼                          │
│                          Format transcript                      │
│                          with turn labels                       │
│                                      │                          │
│                                      ▼                          │
│                    sendMessage(formatted_transcript)             │
│                    + Interview system prompt                     │
│                                      │                          │
│                                      ▼                          │
│                          AI identifies questions                │
│                          Answers interviewer only                │
│                                      │                          │
│                                      ▼                          │
│                          Display in overlay                     │
│                          (structured Q&A format)                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary

| Aspect | Decision |
|--------|----------|
| **Approach** | Prompt-based filtering with conversation buffer |
| **Speaker Detection** | AI inference from conversational patterns |
| **Trigger** | 4-second silence debounce after last turn |
| **Buffer** | Rolling window, last N turns kept for context |
| **System Prompt** | Specialized interview-mode prompt |
| **UI** | Toggle switch on Audio page + overlay indicator |
| **Complexity** | Low — frontend-only changes, no Rust/STT API modifications |
| **Future** | Add AssemblyAI speaker diarization when available |
