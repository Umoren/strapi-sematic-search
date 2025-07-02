'use strict';

module.exports = ({ strapi }) => ({

  calculateCosineSimilarity(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
      throw new Error('Invalid vectors for similarity calculation');
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      magnitudeA += vectorA[i] * vectorA[i];
      magnitudeB += vectorB[i] * vectorB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  },

  async storeEmbedding(documentId, embedding, contentType, metadata = {}) {
    if (!documentId || !embedding || !contentType) {
      throw new Error('Document ID, embedding, and content type are required');
    }

    try {
      const updated = await strapi.documents(contentType).update({
        documentId: documentId,
        data: {
          embedding: embedding,
          embeddingMetadata: {
            model: 'text-embedding-ada-002',
            generatedAt: new Date().toISOString(),
            dimensions: embedding.length,
            ...metadata
          }
        }
      });

      strapi.log.debug(`Stored embedding for ${contentType} document ${documentId}`);
      return updated;

    } catch (error) {
      strapi.log.error(`Failed to store embedding for ${contentType} document ${documentId}:`, error.message);
      throw error;
    }
  },

  async searchSimilar(queryEmbedding, contentType, options = {}) {
    if (!queryEmbedding || !contentType) {
      throw new Error('Query embedding and content type are required');
    }

    const {
      limit = 10,
      threshold = 0.1,
      filters = {},
      locale = null
    } = options;

    try {
      const documents = await strapi.documents(contentType).findMany({
        filters: {
          embedding: { $notNull: true },
          ...filters
        },
        locale: locale,
        limit: 1000
      });

      if (!documents || documents.length === 0) {
        return [];
      }

      const scoredResults = documents
        .map(doc => {
          if (!doc.embedding) return null;

          try {
            const similarity = this.calculateCosineSimilarity(queryEmbedding, doc.embedding);
            
            return {
              ...doc,
              similarityScore: similarity
            };
          } catch (error) {
            strapi.log.warn(`Failed to calculate similarity for document ${doc.documentId}:`, error.message);
            return null;
          }
        })
        .filter(result => result !== null && result.similarityScore >= threshold)
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, limit);

      strapi.log.debug(`Found ${scoredResults.length} similar documents for ${contentType}`);
      
      return scoredResults;

    } catch (error) {
      strapi.log.error(`Failed to search similar documents for ${contentType}:`, error.message);
      throw error;
    }
  },

  async getEmbeddingStats(contentType = null) {
    try {
      const stats = {};

      if (contentType) {
        // Stats for specific content type
        const total = await strapi.documents(contentType).count();
        const withEmbeddings = await strapi.documents(contentType).count({
          filters: { embedding: { $notNull: true } }
        });

        stats[contentType] = {
          total,
          withEmbeddings,
          coverage: total > 0 ? (withEmbeddings / total * 100).toFixed(2) + '%' : '0%'
        };

      } else {
        // Stats for all content types
        const contentTypes = Object.keys(strapi.contentTypes)
          .filter(type => !type.startsWith('admin::') && !type.startsWith('plugin::'));

        for (const type of contentTypes) {
          try {
            const total = await strapi.documents(type).count();
            const withEmbeddings = await strapi.documents(type).count({
              filters: { embedding: { $notNull: true } }
            });

            stats[type] = {
              total,
              withEmbeddings,
              coverage: total > 0 ? (withEmbeddings / total * 100).toFixed(2) + '%' : '0%'
            };
          } catch (error) {
            // Skip content types that can't be queried
            strapi.log.debug(`Skipping stats for ${type}:`, error.message);
          }
        }
      }

      return stats;

    } catch (error) {
      strapi.log.error('Failed to get embedding stats:', error.message);
      throw error;
    }
  }

});