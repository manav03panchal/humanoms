import type { AgentLoopRunner } from "../../src/chat/agent-loop.ts";

/** No-op chat loop runner for API tests that don't exercise the chat endpoint. */
export const stubChatLoop: AgentLoopRunner = async function* () {
  yield { type: "text", text: "stub response" };
};
