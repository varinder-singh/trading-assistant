import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, SchemaType } from '@google/generative-ai'
import type {
  LLMChatWithToolsResult,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMToolCallRecord,
  LLMToolDefinition,
  LLMToolOptions,
} from '../types.js'

type GeminiModelParams = Parameters<GoogleGenerativeAI['getGenerativeModel']>[0]

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export class GeminiProvider implements LLMProvider {
  name = 'gemini'

  constructor(private genAI: GoogleGenerativeAI | null = null) {}

  private ensureClient(): GoogleGenerativeAI {
    if (!this.genAI) {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required')
      }
      this.genAI = new GoogleGenerativeAI(apiKey)
    }
    return this.genAI
  }

  private buildSafetySettings() {
    return [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ]
  }

  public async chat(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const client = this.ensureClient()
    const modelName = options?.model || 'gemini-2.5-flash-lite'
    const systemMessage = messages.find((m) => m.role === 'system')
    const userMessages = messages.filter((m) => m.role !== 'system')

    const modelParams: GeminiModelParams = {
      model: modelName,
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
      safetySettings: this.buildSafetySettings(),
    }

    console.log(
      `[Gemini] Starting chat with model: ${modelName} (System Instruction: ${systemMessage?.content.length || 0} chars)`
    )

    try {
      const model = client.getGenerativeModel(modelParams)

      const chat = model.startChat({
        history: userMessages.slice(0, -1).map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          responseMimeType: 'application/json',
        },
      })

      const lastMessage = userMessages[userMessages.length - 1]
      if (!lastMessage) {
        throw new Error('No user message provided for Gemini chat')
      }

      const result = await chat.sendMessage(lastMessage.content)
      const response = await result.response
      return response.text()
    } catch (error: any) {
      console.error('[Gemini] API Error:', JSON.stringify(error, null, 2) || error.message || error)
      throw error
    }
  }

  public async chatWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    options?: LLMToolOptions
  ): Promise<LLMChatWithToolsResult> {
    if (tools.length === 0) {
      const text = await this.chat(messages, options)
      const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0)
      return {
        text,
        toolCalls: [],
        estimatedInputTokens: estimateTokens(String(inputChars)),
        estimatedOutputTokens: estimateTokens(text),
        stepsUsed: 1,
      }
    }

    const client = this.ensureClient()
    const modelName = options?.model || 'gemini-2.5-flash-lite'
    const systemMessage = messages.find((m) => m.role === 'system')
    const userMessages = messages.filter((m) => m.role !== 'system')
    const maxRoundtrips = options?.maxToolRoundtrips ?? 2

    const functionDeclarations = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, prop]) => [
            key,
            {
              type:
                prop.type === 'number'
                  ? SchemaType.NUMBER
                  : prop.type === 'boolean'
                    ? SchemaType.BOOLEAN
                    : SchemaType.STRING,
              description: prop.description,
            },
          ])
        ),
        required: tool.parameters.required ?? [],
      },
    }))

    const model = client.getGenerativeModel({
      model: modelName,
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
      safetySettings: this.buildSafetySettings(),
      tools: [{ functionDeclarations: functionDeclarations as any }],
    })

    const chatSession = model.startChat({
      history: userMessages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
      },
    })

    const lastMessage = userMessages[userMessages.length - 1]
    if (!lastMessage) {
      throw new Error('No user message provided for Gemini chatWithTools')
    }

    const initialResult = await chatSession.sendMessage(lastMessage.content)
    const initialInputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

    return this.resolveToolLoop(chatSession, initialResult.response, tools, 0, maxRoundtrips, [], initialInputTokens, 0)
  }

  private async resolveToolLoop(
    chatSession: any,
    response: any,
    tools: LLMToolDefinition[],
    currentRound: number,
    maxRoundtrips: number,
    recordedCalls: LLMToolCallRecord[],
    inputTokens: number,
    outputTokens: number
  ): Promise<LLMChatWithToolsResult> {
    const functionCalls = typeof response.functionCalls === 'function' ? response.functionCalls() : undefined
    if (!functionCalls || functionCalls.length === 0 || currentRound >= maxRoundtrips) {
      const text = response.text()
      return {
        text,
        toolCalls: recordedCalls,
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens + estimateTokens(text),
        stepsUsed: currentRound + 1,
      }
    }

    const executedBatch = await Promise.all(
      functionCalls.map(async (call: { name: string; args: Record<string, unknown> }) => {
        const startMs = Date.now()
        const matchingTool = tools.find((t) => t.name === call.name)
        const result = matchingTool
          ? await Promise.resolve(matchingTool.execute(call.args || {}))
          : { error: `Unknown tool ${call.name}`, attempts: 1, suggestion: 'Use a declared tool name.' }
        const record: LLMToolCallRecord = {
          toolName: call.name,
          args: call.args || {},
          result,
          durationMs: Date.now() - startMs,
        }
        return {
          record,
          part: {
            functionResponse: {
              name: call.name,
              response: typeof result === 'object' && result !== null ? result : { value: result },
            },
          },
        }
      })
    )

    const nextResult = await chatSession.sendMessage(executedBatch.map((b) => b.part))
    const batchTokens = executedBatch.reduce((sum, b) => sum + estimateTokens(JSON.stringify(b.record.result)), 0)

    return this.resolveToolLoop(
      chatSession,
      nextResult.response,
      tools,
      currentRound + 1,
      maxRoundtrips,
      [...recordedCalls, ...executedBatch.map((b) => b.record)],
      inputTokens + batchTokens,
      outputTokens
    )
  }
}
