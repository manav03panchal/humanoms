import type { ChatProvider, ChatEvent } from "../../src/chat/providers/types.ts";

/** No-op chat provider for API tests that don't exercise the chat endpoint. */
export const stubProvider: ChatProvider = {
  name: "stub",
  async *chat(): AsyncGenerator<ChatEvent> {
    yield { type: "text", text: "stub response" };
    yield { type: "done" };
  },
};
