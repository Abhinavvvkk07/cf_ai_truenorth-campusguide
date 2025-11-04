import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet,
  generateText
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
// import { env } from "cloudflare:workers";

const model = anthropic("claude-3-haiku-20240307");
type StudentProfile = {
  university_name: string;
  student_name: string;
  major: string;
  application_round: string;
  key_themes: string;
  context_summary: string;
  tone_style: string;
  sensitivity_flags: string;
};
async function buildStudentProfileFromRaw(rawApplicationText: string): Promise<StudentProfile> {
  const { text } = await generateText({
    model,
    system: `
You are an admissions-focused analysis assistant.

Your job is to read a student's entire application context (forms, essays, activities, notes)
and compress it into a structured JSON object with the following exact shape:

{
  "university_name": string,
  "student_name": string,
  "major": string,
  "application_round": string,
  "key_themes": string,              // 1–3 sentence summary of the main recurring themes
  "context_summary": string,         // 2–4 sentence summary of background + constraints
  "tone_style": string,              // short description of how the conversational AI should sound
  "sensitivity_flags": string        // comma-separated list of sensitive topics to handle gently
}

Rules:
- Output VALID JSON ONLY. Do not wrap it in markdown, backticks, or extra text.
- If some fields are unknown, make a reasonable best guess based on the text, but do not invent wild details.
- Keep strings concise but specific.
`,
    prompt: rawApplicationText,
    temperature: 0.2 // low creativity, we want stable structured output
  });

  // text should now be a JSON string. Parse it into our StudentProfile type.
  const parsed = JSON.parse(text) as StudentProfile;
  return parsed;
}

const demoStudentProfile = {
  university_name: "Penn State",
  student_name: "Abhinav Kumar",
  major: "Computer Science",
  application_round: "Fall 2027 Regular Decision",
  key_themes:
    "first-gen abroad, AI + education projects, balancing 20 hrs/week work with a heavy course load, resilience after health setbacks",
  context_summary:
    "Grew up in India, moved to the US for college; family finances are tight, works part-time while studying, recovering from a past surgery while still pushing academically.",
  tone_style: "chill, peer-mentor, very supportive but honest about trade-offs",
  sensitivity_flags:
    "financial stress, health history, immigration context, burnout risk"
};
// Template system prompt for CampusGuide, with variables for per-student personalization
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

// Simple helper to replace {{variables}} with values from the profile
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/{{(\w+)}}/g, (_match, key) => vars[key] ?? "");
}

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const systemPrompt = fillTemplate(systemPromptTemplate, demoStudentProfile);
        
        
        const result = streamText({
          system: systemPrompt,
          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: ...
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<typeof allTools>,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // NEW: ingestion endpoint – build a profile from raw application text
    if (url.pathname === "/api/ingest-profile" && request.method === "POST") {
      // For now we accept plain text in the body: paste forms + essays + activities, etc.
      const rawText = await request.text();

      if (!rawText || rawText.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: "Request body must contain raw application text." }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }

      try {
        const profile = await buildStudentProfileFromRaw(rawText);
        return new Response(JSON.stringify(profile, null, 2), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      } catch (err) {
        console.error("Error building student profile:", err);
        return new Response(
          JSON.stringify({ error: "Failed to build student profile" }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    }

    if (url.pathname === "/check-open-ai-key") {
      const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
      return Response.json({ success: hasAnthropicKey });
    }
    
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        "ANTHROPIC_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret put ANTHROPIC_API_KEY` (or secret bulk) to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;