import { AzureOpenAI } from "openai";
import type { LLMMessage, LLMOptions, LLMProvider } from "../types.js";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: AzureOpenAI | null = null;
  private deploymentName: string = "";

  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    if (!this.client) {
      const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "https://delta-codex-us-2-poc.services.ai.azure.com/openai/v1").replace(/\/+$/, "");
      this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.5";
      const apiKey = process.env.AZURE_OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error("AZURE_OPENAI_API_KEY environment variable is required");
      }
      
      this.client = new AzureOpenAI({
        apiKey,
        endpoint,
        deployment: this.deploymentName,
        apiVersion: "2024-02-01",
      });
    }

    const response = await this.client.chat.completions.create({
      model: options?.model || this.deploymentName,
      messages: messages as any, // Cast due to slight interface differences in OpenAI types
      temperature: options?.temperature ?? 0.7,
    });

    return response.choices[0]?.message.content || "";
  }
}
