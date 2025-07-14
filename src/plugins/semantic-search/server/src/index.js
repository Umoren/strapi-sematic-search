'use strict';

const services = require('./services');
const controllers = require('./controllers');
const routes = require('./routes');

module.exports = {
  services,
  controllers,
  routes,
  
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
  // Get configuration from plugin config
  const config = strapi.config.get('plugin.semantic-search') || {};
  
  // Default content types and field mappings
  const defaultContentTypes = {
    'api::article.article': ['title', 'content', 'summary'],
    'api::blog.blog': ['title', 'body', 'excerpt']
  };
  
  // Validate and use configured content types or defaults
  const contentTypes = validateConfiguration(config.contentTypes || defaultContentTypes, strapi);
  
  // Store the configuration for use in other functions
  strapi.plugin('semantic-search').config = { contentTypes };
  
  Object.keys(contentTypes).forEach(contentType => {
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
    
    strapi.log.info(`Registered embedding lifecycle hooks for ${contentType} with fields: ${contentTypes[contentType].join(', ')}`);
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
    const textContent = extractTextContent(data, modelName, strapi);
    
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

function extractTextContent(data, modelName, strapi) {
  let textContent = '';
  
  // Get configured field mappings for this content type
  const config = strapi.plugin('semantic-search').config || {};
  const contentTypes = config.contentTypes || {};
  
  // Get fields for this specific content type, or use defaults
  const textFields = contentTypes[modelName] || ['title', 'name', 'content', 'body', 'summary', 'description', 'excerpt'];
  
  textFields.forEach(field => {
    if (data[field]) {
      if (typeof data[field] === 'string') {
        textContent += data[field] + ' ';
      } else if (Array.isArray(data[field])) {
        // Handle rich text blocks or arrays
        textContent += JSON.stringify(data[field]) + ' ';
      } else if (typeof data[field] === 'object') {
        // Handle nested objects (like rich text)
        textContent += JSON.stringify(data[field]) + ' ';
      }
    }
  });

  return textContent.trim();
}

function validateConfiguration(contentTypes, strapi) {
  if (!contentTypes || typeof contentTypes !== 'object') {
    strapi.log.warn('Semantic Search: Invalid contentTypes configuration, using defaults');
    return {
      'api::article.article': ['title', 'content', 'summary'],
      'api::blog.blog': ['title', 'body', 'excerpt']
    };
  }

  const validatedConfig = {};
  
  Object.keys(contentTypes).forEach(contentType => {
    // Validate content type format
    if (!contentType.startsWith('api::') || !contentType.includes('.')) {
      strapi.log.warn(`Semantic Search: Invalid content type format: ${contentType}. Should be like 'api::article.article'`);
      return;
    }

    // Validate fields array
    const fields = contentTypes[contentType];
    if (!Array.isArray(fields) || fields.length === 0) {
      strapi.log.warn(`Semantic Search: Invalid fields for ${contentType}. Should be an array of field names`);
      return;
    }

    // Validate field names
    const validFields = fields.filter(field => {
      if (typeof field !== 'string' || field.trim() === '') {
        strapi.log.warn(`Semantic Search: Invalid field name '${field}' for ${contentType}`);
        return false;
      }
      return true;
    });

    if (validFields.length > 0) {
      validatedConfig[contentType] = validFields;
      strapi.log.info(`Semantic Search: Validated configuration for ${contentType}: ${validFields.join(', ')}`);
    }
  });

  return validatedConfig;
}