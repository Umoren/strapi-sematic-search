'use strict';

const services = require('./services');

module.exports = {
  services,
  
  register({ strapi }) {
    // Initialize the embedding service
    const embeddingService = strapi.plugin('semantic-search').service('embeddingService');
    embeddingService.init();

    // Register document service middleware for auto-embedding
    strapi.documents.middlewares.register('semantic-search', {
      beforeCreate: async (event) => {
        await processDocumentEmbedding(event, 'create', strapi);
      },
      beforeUpdate: async (event) => {
        await processDocumentEmbedding(event, 'update', strapi);
      }
    });
  },
  
  bootstrap({ strapi }) {
    strapi.log.info('Semantic Search plugin bootstrapped successfully');
  },
};

async function processDocumentEmbedding(event, action, strapi) {
  const { model, data } = event;
  
  // Only process content types we want (not admin, plugin, or user types)
  if (model.startsWith('admin::') || model.startsWith('plugin::') || model === 'plugin::users-permissions.user') {
    return;
  }

  try {
    const embeddingService = strapi.plugin('semantic-search').service('embeddingService');
    const vectorService = strapi.plugin('semantic-search').service('vectorService');

    // Extract text content from the document
    const textContent = extractTextContent(data, model);
    
    if (!textContent || textContent.trim().length < 10) {
      strapi.log.debug(`Skipping embedding generation for ${model} - insufficient text content`);
      return;
    }

    // Generate embedding
    const embeddingResult = await embeddingService.generateEmbedding(textContent);
    
    if (embeddingResult && embeddingResult.embedding) {
      // Add embedding to the data that will be saved
      data.embedding = embeddingResult.embedding;
      data.embeddingMetadata = {
        model: 'text-embedding-ada-002',
        generatedAt: new Date().toISOString(),
        dimensions: embeddingResult.embedding.length,
        processedText: embeddingResult.processedText,
        originalLength: embeddingResult.originalLength,
        processedLength: embeddingResult.processedLength
      };

      strapi.log.debug(`Generated embedding for ${model} document (${action})`);
    }

  } catch (error) {
    strapi.log.error(`Failed to generate embedding for ${model} document:`, error.message);
    // Don't throw error - we don't want to break content creation/update
  }
}

function extractTextContent(data, model) {
  let textContent = '';
  
  // Common text fields to extract from
  const textFields = ['title', 'name', 'content', 'body', 'summary', 'description', 'excerpt'];
  
  textFields.forEach(field => {
    if (data[field]) {
      if (typeof data[field] === 'string') {
        textContent += data[field] + ' ';
      } else if (Array.isArray(data[field])) {
        // Handle rich text blocks or arrays
        textContent += JSON.stringify(data[field]) + ' ';
      }
    }
  });

  return textContent.trim();
}