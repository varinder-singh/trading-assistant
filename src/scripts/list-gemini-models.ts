import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing");
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  try {
    // The SDK doesn't have a direct listModels on the main class easily accessible 
    // without using the underlying fetch or a different client, 
    // but we can try to probe common ones or use a simple fetch.
    console.log("Probing models via fetch to Google API...");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    
    if (data.models) {
      console.log("Available Models:");
      data.models.forEach((m: any) => {
        console.log(`- ${m.name} (Supports: ${m.supportedGenerationMethods.join(", ")})`);
      });
    } else {
      console.log("No models returned. Response:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();
