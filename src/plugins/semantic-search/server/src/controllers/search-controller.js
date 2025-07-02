'use strict';

module.exports = ({ strapi }) => ({

  async search(ctx) {
    try {
      const { query, contentType, limit = 10, threshold = 0.1, filters = {} } = ctx.request.body;

      if (!query) {
        return ctx.badRequest('Query is required');
      }

      if (!contentType) {
        return ctx.badRequest('Content type is required');
      }

      // Validate content type exists
      const model = strapi.contentTypes[contentType];
      if (!model) {
        return ctx.badRequest(`Content type ${contentType} not found`);
      }

      const searchService = strapi.plugin('semantic-search').service('searchService');

      const searchOptions = {
        limit: Math.min(parseInt(limit), 50), // Max 50 results
        threshold: parseFloat(threshold),
        filters: filters || {},
        includeEmbedding: false
      };

      const results = await searchService.semanticSearch(query, contentType, searchOptions);

      ctx.body = {
        success: true,
        data: results
      };

    } catch (error) {
      strapi.log.error('Semantic search error:', error);
      ctx.internalServerError('Search failed', { error: error.message });
    }
  },

  async multiSearch(ctx) {
    try {
      const { query, contentTypes, limit = 10, threshold = 0.1, aggregateResults = true } = ctx.request.body;

      if (!query) {
        return ctx.badRequest('Query is required');
      }

      if (!Array.isArray(contentTypes) || contentTypes.length === 0) {
        return ctx.badRequest('Content types array is required');
      }

      // Validate all content types exist
      for (const contentType of contentTypes) {
        const model = strapi.contentTypes[contentType];
        if (!model) {
          return ctx.badRequest(`Content type ${contentType} not found`);
        }
      }

      const searchService = strapi.plugin('semantic-search').service('searchService');

      const searchOptions = {
        limit: Math.min(parseInt(limit), 50),
        threshold: parseFloat(threshold),
        aggregateResults: aggregateResults === true || aggregateResults === 'true'
      };

      const results = await searchService.multiContentTypeSearch(query, contentTypes, searchOptions);

      ctx.body = {
        success: true,
        data: results
      };

    } catch (error) {
      strapi.log.error('Multi-content type search error:', error);
      ctx.internalServerError('Multi-search failed', { error: error.message });
    }
  },

  async getStats(ctx) {
    try {
      const { contentType } = ctx.query;

      const vectorService = strapi.plugin('semantic-search').service('vectorService');
      const stats = await vectorService.getEmbeddingStats(contentType);

      ctx.body = {
        success: true,
        data: stats
      };

    } catch (error) {
      strapi.log.error('Get stats error:', error);
      ctx.internalServerError('Failed to get stats', { error: error.message });
    }
  }

});