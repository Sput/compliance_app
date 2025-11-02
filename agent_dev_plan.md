Here’s a step-by-step plan to build your three-stage review using the LangChain agents tutorial you linked (with modern LangGraph agents and sub-agents wrapped as tools). I’m keeping it tight and directly grounded in the docs.

⸻

0) Prereqs & installs
	1.	Install packages (pin reasonably recent versions):

pip install "langchain>=0.3" "langgraph>=0.2" langchain-openai pydantic psycopg[binary] supabase
# (or your chosen model provider package; OpenAI shown as an example)

	2.	Set model + (optional) tracing env vars:

export OPENAI_API_KEY=...
# Optional but very helpful:
export LANGSMITH_TRACING="true"
export LANGSMITH_API_KEY=...

	•	The tutorial shows a minimal end-to-end agent using create_react_agent (prebuilt LangGraph agent) with tools and optional memory; it also shows enabling LangSmith for traces.  ￼

Note: LangChain’s docs recommend building new agents with LangGraph (the prebuilt create_react_agent constructor is exactly that).  ￼

⸻

1) Decide your orchestration pattern (multi-agent)

Use the “tool-calling (supervisor + subagents)” pattern:
	•	A supervisor agent orchestrates three specialist sub-agents:
	1.	Date Guard (verify evidence date in range)
	2.	Action Describer (summarize what the document describes)
	3.	Control Assigner (select a controls.control_id)

Wrap each sub-agent as a tool callable by the supervisor (this is the documented pattern: “controller agent calls subagents as tools”).  ￼

⸻

2) Define your tools (functions) and/or wrap sub-agents as tools

You’ll create tools using the @tool decorator (the recommended way in LangChain):
	•	Custom tools are simple Python functions with docstrings, decorated with @tool.  ￼

You’ll use two kinds of tools:
	1.	Infrastructure tools (deterministic helpers): e.g., fetch_evidence_text(evidence_id), extract_dates(text), check_date_range(dates, start, end), list_controls(query) that queries Postgres/Supabase.
	2.	Sub-agent wrappers (controller calls “agent as a tool”): small functions that internally call a sub-agent’s invoke() and return a compact result to the supervisor. (See “subagents as tools” example.)  ￼

⸻

3) Build the three sub-agents

Use create_react_agent(model, tools=[...]) for each sub-agent; each gets a narrow prompt and only the tools it truly needs. This aligns with the tutorial’s model+tools → create_react_agent flow.  ￼

A) Date Guard Agent
	•	Goal: Given OCR text (or pre-extracted text) + a target date window, output {status: PASS|FAIL, parsed_date, reason}.
	•	Tools it can use:
	•	extract_dates(text) (deterministic function)
	•	check_date_range(date, start, end) (deterministic function)
	•	Prompt hint: “Return a strict JSON with keys: status, parsed_date, reason. If multiple dates, choose the one that denotes the evidence date (e.g., ‘Report Date’, ‘Effective on’).”
	•	Output: small JSON string (the supervisor will parse it).

B) Action Describer Agent
	•	Goal: Produce a one-paragraph description of what actions the document prescribes/records.
	•	Tools: none (pure LLM) or a tiny helper tool if you want a guardrail for length.
	•	Prompt hint: “In ≤120 words, describe the actions the document says were performed or required. No extra commentary.”

C) Control Assigner Agent
	•	Goal: Pick one controls.control_id from DB and provide brief rationale.
	•	Tools it can use:
	•	list_controls(query_or_keywords) → returns a short list of candidate controls (code + title) from Postgres.
	•	Optionally a similarity helper (but keep it minimal first).
	•	Prompt hint: “Choose a single controls.control_id that best matches the described actions. Return {control_id, rationale}. If uncertain, return {control_id: null, rationale}.”

Notes:
	•	Narrow tools reduce confusion and improve tool-choice reliability.
	•	Keep sub-agent outputs structured and small; the supervisor composes the final result.

⸻

4) Wrap each sub-agent as a tool (for the supervisor)

Following the multi-agent docs, expose each sub-agent via @tool("date_guard"), @tool("action_describer"), @tool("control_assigner") functions that internally invoke() the corresponding sub-agent and return their final (structured) outputs to the supervisor.  ￼

⸻

5) Create the Supervisor Agent with those tools
	•	Build a supervisor via create_react_agent(model, tools=[date_guard_tool, action_describer_tool, control_assigner_tool]).
	•	Provide a controller prompt that explains the fixed sequence:
	1.	Call date_guard first. If status=FAIL, stop and return failure.
	2.	If PASS, call action_describer.
	3.	Then call control_assigner (pass it the summary + evidence text).
	4.	Return a final JSON:

{
  "date_check": {...},
  "actions_summary": "...",
  "assigned_control_id": "X.Y.Z",
  "rationale": "..."
}


	•	This is exactly the “tool-calling controller coordinating sub-agents” pattern.  ￼

⸻

6) Hook into your upload pipeline
	•	After the evidence file is stored & OCR text is available, call the supervisor agent with:
	•	text: OCR text (or extracted_text you already store),
	•	date_start, date_end (from your audit settings),
	•	(optional) system name if you already parse it,
	•	any IDs you need for DB writes.
	•	The tutorial shows the full “model + tools + create_react_agent + .stream()/.invoke()” wiring pattern; apply the same but with your tools & prompts.  ￼

⸻

7) Implement the DB tool(s) for controls.control_id
	•	Create a minimal read-only tool that queries Postgres (Supabase) for candidate controls:
	•	Inputs: keywords (few tokens from the action summary).
	•	Query: SELECT control_id, title FROM controls WHERE to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(control_id,'')) @@ plainto_tsquery($1) LIMIT 10;
	•	Return: JSON list [{"control_id":"...", "title":"..."}] to keep the agent’s context lean.
	•	Keep this deterministic and fast; let the LLM pick from that shortlist.

(This is a simple “tool” in LangChain terms; the @tool pattern is the recommended approach.)  ￼

⸻

8) Add basic observability (optional but useful)
	•	Enable LangSmith tracing per the tutorial to see each tool call and agent step while you debug the flow.  ￼

⸻

9) Minimal tests (smoke level)
	•	Date Guard: unit test check_date_range() with edge cases.
	•	Supervisor flow: stub tools to force PASS/FAIL and ensure the supervisor runs the fixed sequence (date → actions → control).
	•	DB tool: test that it returns a bounded list and survives empty results.

⸻

10) Ship it behind a feature flag (optional)
	•	Add a simple flag (USE_AGENT_REVIEW=true/false) so you can fall back to your existing single-agent classifier if needed.

⸻

Quick reference to the tutorial & docs used
	•	Build an Agent (model + tools → create_react_agent; optional LangSmith setup) on python.langchain.com.  ￼
	•	Use LangGraph for new agents (modern guidance).  ￼
	•	Multi-agent: supervisor calls sub-agents as tools (pattern & example).  ￼
	•	Create custom tools with @tool decorator (recommended).  ￼