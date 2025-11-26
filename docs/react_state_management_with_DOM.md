HITL Evidence Editing: Making Typing Rock-Solid
  
  We built a multi-step, Human-in-the-Loop (HITL) flow for evidence processing: propose → edit → approve → persist. It worked — except for the part that matters most: typing. The textarea caret
  jumped around, edits reverted after approval, and the UX felt brittle. This post explains why that happened (in React terms) and what we changed to make typing feel native and reliable.
  
  Symptoms
  
  - Caret jumped or required clicking back into the textarea as you typed.
  - Edits reverted when clicking Approve & Continue (snapped back to proposals).
  - Undo/redo history disappeared between steps.
  - Occasionally, text reset when switching steps or when proposals loaded.
  
  Anatomy Of The Bug
  
  The root causes were interlocking React and DOM anti-patterns, not one-off bugs.
  
  - Controlled inputs with frequent state writes:
      - We used value={text} with onChange to update React state on every keystroke.
      - Proposal updates (from agents) and step changes wrote to that same state.
      - Result: the DOM node re-rendered frequently, and sometimes was replaced entirely.
      - Result: the DOM node re-rendered frequently, and sometimes was replaced entirely.
  - 
  Node remounts due to step changes:
      - The stepper rendered different content conditionally. In places, the textarea had key={step} or was conditionally included/excluded.
      - Any key change or conditional flip remounts the node, resetting caret and undo history.
  - 
  Reseeding overwrote user input:
      - On entering a step or when proposals arrived, we “seeded” text by setting state.
      - If that ran while a user was typing, it overwrote the DOM’s value and reset the caret.
  - 
  Programmatic caret control made things worse:
      - We attempted to save/restore selection with setSelectionRange after state updates.
      - This raced with React rendering and IME composition (e.g., CJK input), causing jumps to start/end and broken input on Safari/iOS.
  - 
  Stale values on Approve:
      - Approve read from React state (“source of truth”), not the DOM’s current value.
      - Because state and the DOM diverged (due to debouncing, race conditions, or lost updates), we persisted stale text — user edits were lost.
  - 
  StrictMode doubled effect runs:
      - Proposal seeding in useEffect ran twice in development, reseeding the input and clobbering the current text.
  - 
  Hydration mismatch risks:
      - Using value tied to server-provided data risked hydration mismatches and remounts in edge cases, especially with rapidly updating proposals.
  
  Together, this created a loop: user types → state write → re-render → selection lost → programmatic selection set → proposals arrive → state write → DOM replaced → edits lost or caret jumps.
  
  What We Tried That Failed
  
  - Controlled + debounced state:
      - Reduced the frequency of state updates, but didn’t fix node replacement or reseeding overwrites.
  - Manual caret preservation:
      - Saving selectionStart/End before updates and restoring after often ran against a new DOM node or during IME composition, causing visible jumps.
  - Forced focus/selection in effects:
      - Fighting the browser led to more flicker, not less.
  
  These are brittle on modern React (with concurrent rendering and StrictMode).
  
  The Fix: DOM-First, Uncontrolled, And One-Time Seeding
  
  We rewired the UI to let the DOM own typing and only sync when the user commits.
  
  - Uncontrolled textareas:
      - Use defaultValue and a ref to read/write the DOM value. Do not bind value.
      - Don’t update React state on every keystroke.
      - Don’t update React state on every keystroke.
  - 
  Stable nodes (no remounts):
      - Keep the textarea mounted with a stable key.
      - Avoid conditional rendering that unmounts it; prefer CSS to hide/show if needed.
  - 
  One-time seeding with guard refs:
      - Seed proposals only once per step and only if the field is still empty.
      - Use useRef flags like hasSeeded.current to prevent reseeding on subsequent renders and StrictMode double-invocations.
  - 
  Read DOM on Approve:
      - On Approve & Continue, read textRef.current.value for the exact typed content.
      - Send that to the API and only then update React state once (if you need to show a preview or advance the step).
  - 
  Never programmatically manage caret:
      - Avoid focus(), setSelectionRange(), or forcing selection in effects. Let the browser manage caret and composition.
  - 
  Don’t reseed while typing:
      - Proposals can update a “suggestion” panel, but never overwrite the textarea once seeded unless the field is empty and user hasn’t typed.
  
  Here’s a representative before/after:
  
  Problematic (controlled + reseeding)
  const [text, setText] = useState('');
  
  useEffect(() => {
    // When proposals arrive or step changes
    setText(proposalText); // Overwrites user edits
  }, [proposalText, step]);
  
  <textarea
    value={text}
    onChange={(e) => setText(e.target.value)}
  />
  Fixed (uncontrolled + guarded seeding + DOM read on commit)
  const textRef = useRef<HTMLTextAreaElement>(null);
  const hasSeeded = useRef(false);
  
  useEffect(() => {
    // One-time seed if empty
    const el = textRef.current;
    if (!el) return;
    if (!hasSeeded.current && !el.value) {
      el.value = initialProposal ?? '';
      hasSeeded.current = true;
    }
  }, [initialProposal]); // Safe: won’t overwrite once seeded
  
  // Keep node mounted and key stable
  <textarea
    ref={textRef}
    defaultValue="" // Let DOM own the value
    // no onChange that writes to state
  />
  
  const onApprove = async () => {
    const value = textRef.current?.value ?? '';
    await api.apply({ text: value });
    // Optionally sync once to state for previews/next step
  };
  Why This Works
  
  - Uncontrolled inputs decouple keystrokes from React renders. The DOM remains the authority on value and selection, so the caret never moves unexpectedly.
  - Stable nodes preserve caret, selection, and undo/redo because the textarea isn’t being remounted.
  - One-time seeding prevents proposal updates from clobbering user edits or retriggering hydration issues.
  - DOM reads on commit ensure the exact user-typed content is persisted, not a stale copy in React state.
  - No programmatic caret manipulation avoids racing the browser’s selection model and IME composition.
  
  Edge Cases We Accounted For
  
  - IME composition (CJK, accents):
      - No state writes or selection changes during typing prevents composition disruption.
  - StrictMode:
      - Guard refs prevent effects from running twice and reseeding.
  - Hydration:
      - Using defaultValue and stable markup avoids hydration mismatch-induced remounts.
  - Step navigation:
      - Keep the textarea mounted; if you must switch steps, don’t reuse keys that cause remounts. If a remount is unavoidable, explicitly carry the DOM value forward by reading it first.
  
  Practical Guidelines (Checklist)
  
  - Use defaultValue for textareas in heavy-edit flows; avoid value unless strictly necessary.
  - Keep nodes stable: no changing keys, avoid conditional unmounts.
  - Seed once: only write initial content if the field is empty, guarded by useRef.
  - Read from the DOM on commit actions (Approve/Next).
  - Don’t set focus or selection in effects during typing.
  - Treat proposals as suggestions, not a source of truth for the textarea.
  - If you need live previews or validation, read from ref.current.value — don’t mirror typing into React state.
  - If you must show/hide steps, prefer CSS visibility over conditional rendering to maintain node identity.
  
  What Changed In The App
  
  - Textareas in HITL steps are now uncontrolled with guarded seeding.
  - Approve & Continue reads values via refs and persists them directly.
  - Proposals never overwrite user input once seeded.
  - No focus/selection juggling; the browser manages caret placement.
  - After finalize, the UI resets cleanly to a blank Ingest step without retroactively changing what the user typed.
  
  Results
  
  - Caret stability is rock-solid — no jumping or lost focus.
  - Edits persist reliably across approvals and step transitions.
  - Undo/redo works naturally because the DOM node stays the same.
  - The UI feels native, even with background proposals and stage progress.
  
  Takeaways
  
  When building HITL or any typing-heavy flow in React, let the DOM own the input while the user is typing, and only synchronize at intentional boundaries. Controlled inputs are fine for simple
  forms, but they can undermine typing UX when mixed with frequent proposal updates, step transitions, or effects. Use uncontrolled inputs, keep nodes stable, seed once, and read from the DOM on
  commit — your users’ caret (and sanity) will thank you.