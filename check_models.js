import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const models = await genAI.listModels();
    console.log("Available models:");
    models.models.forEach((m) => {
      console.log(`${m.name} - ${m.supportedGenerationMethods}`);
    });
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();
