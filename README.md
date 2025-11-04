# TrueNorth CampusGuide – Cloudflare Agents + Claude

This repo contains **TrueNorth CampusGuide**, a two-stage AI system built on **Cloudflare Agents** and **Claude 3 Haiku**. It is designed as a post-application conversational layer for universities to understand students **beyond scores and résumés**.

There are two main “agents” in this system:

1. **Ingestion Agent** – reads the student's full application (forms, essays, activities) and compresses it into a structured JSON profile.
2. **CampusGuide Conversational Agent** – a Cloudflare chat agent that uses that profile to have a personalized, multi-turn conversation with the student after they have applied.

This project is submitted for the **Cloudflare AI optional assignment** (“build an AI-powered application on Cloudflare”).

---

## High-Level Idea

Most applications only show admissions officers a tiny slice of the student. CampusGuide is meant to be a **TrueNorth-style** layer:

- The student has **already applied** to a university.
- An ingestion step reads **everything** they submitted.
- A conversational agent then talks to them like a **peer mentor**, digs deeper into context, constraints, and motivations, and can later summarize them “for admissions” in a structured way.

---

## Architecture

### 1. Ingestion Agent – `/api/ingest-profile`

**Goal:** Turn a blob of application text (forms + essays + activities) into a structured `StudentProfile` that a conversation agent can use.

Implementation:

- Endpoint: `POST /api/ingest-profile`
- Backend function: `buildStudentProfileFromRaw(rawApplicationText: string)`
- Model: `claude-3-haiku-20240307` via the Anthropic API

The ingestion function is implemented in `src/server.ts` using the `generateText` API. It sends:

- a **system prompt** that describes the desired JSON schema:

  ```json
  {
    "university_name": string,
    "student_name": string,
    "major": string,
    "application_round": string,
    "key_themes": string,
    "context_summary": string,
    "tone_style": string,
    "sensitivity_flags": string
  }
the raw application text as the prompt

a low temperature so that the output is stable and structured

Claude returns a JSON string, which is parsed into a StudentProfile TypeScript type.

Example usage (already tested locally):
curl -X POST \
  -H "Content-Type: text/plain" \
  --data-binary @- \
  http://localhost:5173/api/ingest-profile << 'EOF'
Student name: Abhinav Kumar
University: Penn State
Applied major: Computer Science
Round: Fall 2027 Regular Decision

Personal statement:
I grew up in Patna, India, in a family that stretched everything to prioritize my education...
...

Activities:
- Worked 20 hrs/week as a desk assistant...
- Built AI tools to help classmates...
- Recovered from wrist surgery and came back stronger...
EOF
2. CampusGuide Conversational Agent – Chat

Goal: Use the StudentProfile to hold a personalized, post-application conversation with the student.

Implementation:

Based on the Cloudflare Agents starter, using AIChatAgent<Env>.

Model: same claude-3-haiku-20240307 via the ai SDK’s streamText.

Class: Chat in src/server.ts.

The agent uses a system prompt template with {{variables}} that gets filled from a StudentProfile:
const systemPromptTemplate = `
You are CampusGuide, an AI that speaks with students who have already applied to {{university_name}}.

This specific student:
- Name: {{student_name}}
- Applied major/program: {{major}}
- Application round: {{application_round}}
- Key themes from their application: {{key_themes}}
- Context & constraints (summarized): {{context_summary}}

Your job:
- Use the above profile as prior context. Do NOT ask them to repeat everything that already appears here.
- Instead, dig deeper into motives, nuance, and things they may not have had space to explain.
- Adapt your tone to {{tone_style}} while staying respectful and appropriate for an admissions-facing system.
- If relevant, be especially mindful of: {{sensitivity_flags}}.

Conversation behavior:
- At the start, briefly explain your role at {{university_name}} and that you already have their application, so you're just trying to understand the story behind it.
- Ask 1–3 open-ended questions at a time, tailored to the profile above.
- Actively reference details from {{key_themes}} and {{context_summary}} so the student feels understood.
- When asked to "summarize me for admissions", produce a structured summary grounded ONLY in what you've been told.

Boundaries:
- Don't promise admission.
- Don't give legal/visa/medical advice.
- Encourage real-world support if the student reveals heavy personal struggles.

${getSchedulePrompt({ date: new Date() })}

If the student asks to plan study time, deadlines, or application work, use the schedule tool to help them structure their time.
`;
A simple fillTemplate helper replaces {{university_name}}, {{student_name}}, etc. with fields from a StudentProfile, producing the final system string passed into streamText.

For the demo, the app uses a demoStudentProfile object, which simulates the output of the ingestion agent. In a production setup, this would be loaded from storage per-student after calling /api/ingest-profile.

The Agent maintains chat state and can use built-in tools (from the starter) such as scheduling.
How this meets the Cloudflare assignment requirements

“An AI-powered application should include the following components…”

LLM

Uses Claude 3 Haiku (claude-3-haiku-20240307) via the Anthropic API.

Integrated via the ai SDK in src/server.ts.

Used in two places:

Ingestion (generateText)

Conversation (streamText)

Workflow / coordination

Uses the Cloudflare Agents framework (AIChatAgent, routeAgentRequest) for orchestration.

Implements a two-stage workflow:

Ingestion Agent builds a StudentProfile from application text.

CampusGuide Agent uses that profile to drive a personalized conversation.

Tools (like scheduling) are wired in via the starter’s tools and executions.

User input via chat or voice

The starter’s chat UI (React/Vite) is used to provide a text chat interface.

The CampusGuide agent is exposed through this UI and responds in real-time.

Memory or state

The chat agent retains conversation history across turns for a given session.

Additionally, the design includes a StudentProfile object that represents long-term state extracted from the application.

In a full deployment, this profile would be persisted (KV / D1) and re-used for future sessions.

Tech Stack

Cloudflare Workers / Agents for backend

Claude 3 Haiku (Anthropic) as the LLM

TypeScript for the Worker and Agent logic

React + Vite for the frontend (from Cloudflare Agents starter)

Wrangler for local dev and deployment
Local Development

Install dependencies:

npm install


Set up your Anthropic API key locally in .dev.vars:

echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .dev.vars


.dev.vars is in .gitignore and is not committed.

Run the dev server:

npm start


Open the frontend (typically):

http://localhost:5173/


To test ingestion:

curl -X POST \
  -H "Content-Type: text/plain" \
  --data-binary @- \
  http://localhost:5173/api/ingest-profile << 'EOF'
[paste application text here]
EOF

Deployment

To deploy to Cloudflare Workers:

Set your Anthropic key as a Cloudflare secret:

npx wrangler secret put ANTHROPIC_API_KEY


Deploy:

npm run deploy


Wrangler will print a *.workers.dev URL where CampusGuide is live.