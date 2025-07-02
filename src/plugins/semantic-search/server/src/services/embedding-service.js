'use strict';

const OpenAI = require('openai');

module.exports = ({ strapi }) => ({
  
  openai: null,

  init() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      strapi.log.warn('OpenAI API key not found. Embedding service will not function.');
      return;
    }
    
    this.openai = new OpenAI({
      apiKey: apiKey,
    });
    
    strapi.log.info('OpenAI embedding service initialized');
  },

  preprocessText(text) {
    if (!text) return '';
    
    // Remove HTML tags
    const cleanText = text.replace(/<[^>]*>/g, ' ');
    
    // Remove extra whitespace
    const normalizedText = cleanText.replace(/\s+/g, ' ').trim();
    
    // Truncate if too long (OpenAI has token limits)
    const maxLength = 8000; // Conservative limit for text-embedding-ada-002
    if (normalizedText.length > maxLength) {
      return normalizedText.substring(0, maxLength) + '...';
    }
    
    return normalizedText;
  },

  async generateEmbedding(text) {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized. Check your API key.');
    }
    
    if (!text || text.trim().length === 0) {
      throw new Error('Text is required for embedding generation');
    }
    
    try {
      const processedText = this.preprocessText(text);
      
      if (processedText.length < 10) {
        throw new Error('Text too short for meaningful embedding');
      }
      
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: processedText,
      });
      
      const embedding = response.data[0].embedding;
      
      strapi.log.debug(`Generated embedding for text of length ${processedText.length}`);
      
      return {
        embedding,
        processedText,
        originalLength: text.length,
        processedLength: processedText.length
      };
      
    } catch (error) {
      strapi.log.error('Failed to generate embedding:', error.message);
      
      // Handle specific OpenAI errors
      if (error.code === 'insufficient_quota') {
        throw new Error('OpenAI API quota exceeded');
      } else if (error.code === 'invalid_api_key') {
        throw new Error('Invalid OpenAI API key');
      } else if (error.code === 'rate_limit_exceeded') {
        throw new Error('OpenAI API rate limit exceeded');
      }
      
      throw error;
    }
  },

  async generateBatchEmbeddings(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Texts array is required for batch embedding generation');
    }
    
    // Process in batches to avoid rate limits
    const batchSize = 10;
    const results = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(text => this.generateEmbedding(text));
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Add delay between batches to respect rate limits
        if (i + batchSize < texts.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        strapi.log.error(`Batch embedding generation failed for batch starting at index ${i}:`, error.message);
        throw error;
      }
    }
    
    return results;
  }
  
});