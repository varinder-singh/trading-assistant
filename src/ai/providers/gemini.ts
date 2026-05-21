import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMMessage, LLMOptions, LLMProvider } from "../types.js";

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private genAI: GoogleGenerativeAI | null = null;

  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    if (!this.genAI) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required");
      }
      this.genAI = new GoogleGenerativeAI(apiKey);
    }

    const modelName = options?.model || "gemini-2.5-flash-lite";

    // Extract system message if present
    const systemMessage = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const modelParams: any = {
      model: modelName,
    };

    if (systemMessage) {
      modelParams.systemInstruction = systemMessage.content;
    }

    console.log(`[Gemini] Starting chat with model: ${modelName} (System Instruction: ${modelParams.systemInstruction?.length || 0} chars)`);

    try {
      const model = this.genAI.getGenerativeModel(modelParams);

      const chat = model.startChat({
        history: userMessages.slice(0, -1).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
        },
      });

      const lastMessage = userMessages[userMessages.length - 1];
      if (!lastMessage) {
        throw new Error("No user message provided for Gemini chat");
      }

      const result = await chat.sendMessage(lastMessage.content);
      const response = await result.response;
      return response.text();
    } catch (error: any) {
      console.error("[Gemini] API Error:", JSON.stringify(error, null, 2) || error.message || error);
      throw error;
    }
  }
}
