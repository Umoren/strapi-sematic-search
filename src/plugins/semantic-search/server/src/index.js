'use strict';

const services = require('./services');

module.exports = {
  services,
  
  register({ strapi }) {
    // Initialize the embedding service
    const embeddingService = strapi.plugin('semantic-search').service('embeddingService');
    embeddingService.init();
  },
  
  bootstrap({ strapi }) {
    strapi.log.info('Semantic Search plugin bootstrapped successfully');
    
    // Register lifecycle hooks for auto-embedding in bootstrap phase
    registerEmbeddingLifecycles(strapi);
  },
};

function registerEmbeddingLifecycles(strapi) {
  // Register lifecycle hooks for content types that should have embeddings
  const contentTypes = ['api::article.article', 'api::blog.blog'];
  
  contentTypes.forEach(contentType => {
    // Use Strapi 5 lifecycle hooks
    strapi.db.lifecycles.subscribe({
      models: [contentType],
      beforeCreate: async (event) => {
        await processDocumentEmbedding(event, 'create', strapi);
      },
      beforeUpdate: async (event) => {
        await processDocumentEmbedding(event, 'update', strapi);
      }
    });
    
    strapi.log.info(`Registered embedding lifecycle hooks for ${contentType}`);
  });
}

async function processDocumentEmbedding(event, action, strapi) {
  const { model, params } = event;
  const data = params.data;
  
  // Get the model name as string
  const modelName = typeof model === 'string' ? model : model.uid;
  
  // Only process content types we want (not admin, plugin, or user types)
  if (modelName.startsWith('admin::') || modelName.startsWith('plugin::') || modelName === 'plugin::users-permissions.user') {
    return;
  }

  try {
    const embeddingService = strapi.plugin('semantic-search').service('embeddingService');

    // Extract text content from the document
    const textContent = extractTextContent(data);
    
    if (!textContent || textContent.trim().length < 10) {
      strapi.log.debug(`Skipping embedding generation for ${modelName} - insufficient text content`);
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

      strapi.log.info(`Generated embedding for ${modelName} document (${action})`);
    }

  } catch (error) {
    strapi.log.error(`Failed to generate embedding for ${modelName} document:`, error.message);
    // Don't throw error - we don't want to break content creation/update
  }
}

function extractTextContent(data) {
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