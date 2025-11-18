Integrating OCR Into a Compliance Evidence Analyzer Using the OpenAI Responses API

Compliance evidence rarely arrives as neatly formatted text. Teams submit screenshots, photos of invoices, PDFs, and scanned policy documents. Until recently, our Vision page could only analyze plain text, meaning users had to manually extract text from documents before running compliance classification.

I fixed that by integrating Optical Character Recognition (OCR) directly into the upload flow using the OpenAI Responses API. Now users can upload anything, and the application extracts the text automatically, displays it for review, and streams it through the existing LLM-based analysis pipeline—no manual copying required.

⸻

# TL;DR

I upgraded the compliance evidence analyzer by adding built-in OCR using the OpenAI Responses API, allowing users to upload real-world documents—images, screenshots, and PDFs—and have the text extracted and analyzed automatically. A new /api/ocr route handles text extraction, the Vision page upload flow now feeds that text directly into the LLM-based supervisor pipeline, and an “Interpreted Text” viewer shows exactly what the system extracted. Fixes to payload formatting and React state timing ensure accurate parsing, making the entire evidence ingestion process smoother, more reliable, and far more practical for everyday compliance workflows.

⸻

# Why I Added OCR

Our app analyzes evidence using a multi-step LLM “supervisor” pipeline:
	1.	Date Guard – Detects when the evidence event occurred
	2.	Action Analyzer – Describes the compliance-relevant action
	3.	Control Assigner – Maps the action to controls in the database

This pipeline only worked reliably when users pasted text into a field.

OCR unlocks real-world usability:
	•	Users upload JPGs, PNGs, or PDFs
	•	The backend extracts readable text
	•	The pipeline processes it automatically

This reduces friction and makes the app far more practical for compliance workflows.

⸻

# What I Built

1. A New OCR API Route

I added a dedicated endpoint:

/api/ocr

This route:
	•	Accepts { fileName, mimeType, fileContentBase64 }
	•	Decodes text files immediately (no need for AI)
	•	Sends images and PDFs to OpenAI Responses API
	•	Uses image_url data URIs compatible with the vision models
	•	Extracts plain text in reading order
	•	Returns { text } or detailed errors

The default model is gpt-4o-mini, but this can be overridden with OCR_MODEL.

⸻

2. Updating the Vision Page Upload Flow

Previously, uploading a file triggered immediate streaming analysis using stale or empty text.
Now the flow is:
	1.	Save the file
	2.	Call /api/ocr
	3.	Extract text
	4.	Display the interpreted text to the user
	5.	Stream that text into the LLM supervisor pipeline

This ensures analysis always uses the correct text.

⸻

3. “Interpreted Text” Debug Viewer

To make troubleshooting easier, a new card appears under the uploader:
	•	Shows the raw OCR output
	•	Displays character count
	•	Renders scrollable, monospaced text
	•	Lets users confirm “what the system thinks it saw”

This was helpful for diagnosing mismatches between OCR output and LLM parsing.

⸻

Technical Challenges & Fixes

Issue: React State Race Condition Causing Wrong Text to Be Analyzed

I had hardcoded default data when building the initial solution, which won the race against the new extracted data.

Right after extracting OCR text, the app did:

setTextInput(extracted);
runDirectStream();

React state updates are asynchronous.
runDirectStream() read the default old textInput value.

This caused incorrect date parsing—for example:
	•	OCR read: 10/25/25
	•	LLM analyzed: 2025-10-22 (from old placeholder text)

Fix: Add an override parameter:

runDirectStream(extracted);

This guarantees the pipeline always uses the exact OCR output.

⸻

# How the New Flow Works

1. Upload Any File

The user uploads a TXT, PDF, JPG, PNG, etc.

2. OCR Extraction

/api/ocr:
	•	Converts file → base64 data URI
	•	Sends to OpenAI
	•	Extracts clean text
	•	Returns { text }

3. Interpreted Text Viewer Renders Output

The Vision page displays:
	•	The text
	•	The length
	•	A scrollable preview

4. Streaming LLM Analysis Begins

The extracted text is passed into:
	•	Date Guard
	•	Action Analyzer
	•	Control Assigner

5. Results Appear as Before

The UI and evidence-mapping behaviors remain unchanged.

⸻

# The Impact

This update makes the evidence ingestion pipeline more useful for end users:
	•	Users can upload real-world documents without preprocessing
	•	OCR ensures consistent inputs to the compliance pipeline
	•	Debug viewer increases transparency and trust
	•	Stale-state bugs no longer distort results
	•	The system can now handle screenshots, photos, and PDFs automatically

The difference in usability is dramatic. What previously required three manual steps now happens instantly and reliably.