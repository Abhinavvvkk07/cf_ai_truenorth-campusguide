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
