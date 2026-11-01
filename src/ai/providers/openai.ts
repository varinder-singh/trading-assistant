import { AzureOpenAI } from 'openai'
import type {
  LLMChatWithToolsResult,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMToolCallRecord,
  LLMToolDefinition,
  LLMToolOptions,
} from '../types.js'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  private deploymentName: string = ''

  constructor(private client: AzureOpenAI | null = null) {}

  private ensureClient(): AzureOpenAI {
    if (!this.client) {
      const endpoint = (
        process.env.AZURE_OPENAI_ENDPOINT ?? 'https://delta-codex-us-2-poc.services.ai.azure.com/openai/v1'
      ).replace(/\/+$/, '')
      this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-5.5'
      const apiKey = process.env.AZURE_OPENAI_API_KEY

      if (!apiKey) {
        throw new Error('AZURE_OPENAI_API_KEY environment variable is required')
      }

      this.client = new AzureOpenAI({
        apiKey,
        endpoint,
        deployment: this.deploymentName,
        apiVersion: '2024-02-01',
      })
    }
    return this.client
  }

  public async chat(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const client = this.ensureClient()
    const response = await client.chat.completions.create({
      model: options?.model || this.deploymentName,
      messages: messages as any,
      temperature: options?.temperature ?? 0.7,
    })

    return response.choices[0]?.message.content || ''
  }

  public async chatWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    options?: LLMToolOptions
  ): Promise<LLMChatWithToolsResult> {
    if (tools.length === 0) {
      const text = await this.chat(messages, options)
      const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
      return {
        text,
        toolCalls: [],
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: estimateTokens(text),
        stepsUsed: 1,
      }
    }

    const client = this.ensureClient()
    const maxRoundtrips = options?.maxToolRoundtrips ?? 2
    const openAiTools = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))

    const initialInputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

    return this.resolveOpenAiToolLoop(
      client,
      messages as any[],
      tools,
      openAiTools,
      options,
      0,
      maxRoundtrips,
      [],
      initialInputTokens,
      0
    )
  }

  private async resolveOpenAiToolLoop(
    client: AzureOpenAI,
    conversation: any[],
    tools: LLMToolDefinition[],
    openAiTools: any[],
    options: LLMToolOptions | undefined,
    currentRound: number,
    maxRoundtrips: number,
    recordedCalls: LLMToolCallRecord[],
    inputTokens: number,
    outputTokens: number
  ): Promise<LLMChatWithToolsResult> {
    const isFinalRound = currentRound >= maxRoundtrips
    const response = await client.chat.completions.create({
      model: options?.model || this.deploymentName,
      messages: conversation,
      tools: openAiTools,
      tool_choice: isFinalRound ? 'none' : 'auto',
      temperature: options?.temperature ?? 0.2,
    })

    const msg = response.choices[0]?.message
    const toolCalls = msg?.tool_calls

    if (!toolCalls || toolCalls.length === 0 || isFinalRound) {
      const text = msg?.content || ''
      return {
        text,
        toolCalls: recordedCalls,
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens + estimateTokens(text),
        stepsUsed: currentRound + 1,
      }
    }

    const executedBatch = await Promise.all(
      toolCalls.map(async (tc: any) => {
        const startMs = Date.now()
        const toolName = tc.function?.name || ''
        const parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
        const matchingTool = tools.find((t) => t.name === toolName)
        const result = matchingTool
          ? await Promise.resolve(matchingTool.execute(parsedArgs))
          : { error: `Unknown tool ${toolName}`, attempts: 1, suggestion: 'Use a declared tool name.' }

        const record: LLMToolCallRecord = {
          toolName,
          args: parsedArgs,
          result,
          durationMs: Date.now() - startMs,
        }
        return {
          record,
          toolMessage: {
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          },
        }
      })
    )

    const nextConversation = [...conversation, msg, ...executedBatch.map((b) => b.toolMessage)]
    const batchTokens = executedBatch.reduce((sum, b) => sum + estimateTokens(b.toolMessage.content), 0)

    return this.resolveOpenAiToolLoop(
      client,
      nextConversation,
      tools,
      openAiTools,
      options,
      currentRound + 1,
      maxRoundtrips,
      [...recordedCalls, ...executedBatch.map((b) => b.record)],
      inputTokens + batchTokens,
      outputTokens
    )
  }
}
