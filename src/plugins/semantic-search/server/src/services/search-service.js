'use strict';

module.exports = ({ strapi }) => ({

  getEmbeddingService() {
    return strapi.plugin('semantic-search').service('embeddingService');
  },

  getVectorService() {
    return strapi.plugin('semantic-search').service('vectorService');
  },

  async semanticSearch(query, contentType, options = {}) {
    if (!query || !contentType) {
      throw new Error('Query and content type are required');
    }

    const {
      limit = 10,
      threshold = 0.1,
      filters = {},
      locale = null,
      includeEmbedding = false
    } = options;

    try {
      const embeddingService = this.getEmbeddingService();
      const vectorService = this.getVectorService();

      // Generate embedding for the search query
      const queryResult = await embeddingService.generateEmbedding(query);
      
      if (!queryResult || !queryResult.embedding) {
        throw new Error('Failed to generate embedding for search query');
      }

      // Search for similar documents
      const searchOptions = {
        limit,
        threshold,
        filters,
        locale
      };

      const results = await vectorService.searchSimilar(
        queryResult.embedding, 
        contentType, 
        searchOptions
      );

      // Clean up results (remove embedding from response unless requested)
      const cleanResults = results.map(result => {
        const cleaned = { ...result };
        
        if (!includeEmbedding) {
          delete cleaned.embedding;
          delete cleaned.embeddingMetadata;
        }
        
        return cleaned;
      });

      const response = {
        query: query,
        contentType: contentType,
        results: cleanResults,
        metadata: {
          totalResults: cleanResults.length,
          queryProcessing: {
            originalQuery: query,
            processedText: queryResult.processedText,
            embeddingDimensions: queryResult.embedding.length
          },
          searchOptions: {
            limit,
            threshold,
            locale,
            filtersApplied: Object.keys(filters).length > 0
          }
        }
      };

      strapi.log.debug(`Semantic search completed: ${cleanResults.length} results for "${query}" in ${contentType}`);
      
      return response;

    } catch (error) {
      strapi.log.error(`Semantic search failed for query "${query}" in ${contentType}:`, error.message);
      throw error;
    }
  },

  async multiContentTypeSearch(query, contentTypes, options = {}) {
    if (!query || !Array.isArray(contentTypes) || contentTypes.length === 0) {
      throw new Error('Query and content types array are required');
    }

    const {
      limit = 10,
      threshold = 0.1,
      aggregateResults = true
    } = options;

    try {
      const searchPromises = contentTypes.map(contentType => 
        this.semanticSearch(query, contentType, {
          ...options,
          limit: aggregateResults ? Math.ceil(limit * 1.5) : limit // Get more results for aggregation
        }).catch(error => {
          strapi.log.warn(`Search failed for content type ${contentType}:`, error.message);
          return {
            query,
            contentType,
            results: [],
            error: error.message
          };
        })
      );

      const searchResults = await Promise.all(searchPromises);

      if (aggregateResults) {
        // Combine and re-sort all results by similarity score
        const allResults = [];
        
        searchResults.forEach(searchResult => {
          if (searchResult.results && searchResult.results.length > 0) {
            searchResult.results.forEach(result => {
              allResults.push({
                ...result,
                contentType: searchResult.contentType
              });
            });
          }
        });

        // Sort by similarity score and limit
        const sortedResults = allResults
          .sort((a, b) => b.similarityScore - a.similarityScore)
          .slice(0, limit);

        return {
          query,
          contentTypes,
          results: sortedResults,
          metadata: {
            totalResults: sortedResults.length,
            searchedContentTypes: contentTypes,
            individualResults: searchResults.map(sr => ({
              contentType: sr.contentType,
              count: sr.results ? sr.results.length : 0,
              hasError: !!sr.error
            }))
          }
        };
      } else {
        // Return separate results for each content type
        return {
          query,
          contentTypes,
          results: searchResults,
          metadata: {
            totalContentTypes: contentTypes.length,
            successfulSearches: searchResults.filter(sr => !sr.error).length
          }
        };
      }

    } catch (error) {
      strapi.log.error(`Multi-content type search failed for query "${query}":`, error.message);
      throw error;
    }
  },

  async searchWithFilters(query, contentType, filters = {}, options = {}) {
    // Helper method for common filtering scenarios
    const searchFilters = {};

    // Date range filtering
    if (filters.dateFrom || filters.dateTo) {
      const dateFilter = {};
      if (filters.dateFrom) dateFilter.$gte = filters.dateFrom;
      if (filters.dateTo) dateFilter.$lte = filters.dateTo;
      searchFilters.createdAt = dateFilter;
    }

    // Status filtering
    if (filters.publishedAt !== undefined) {
      if (filters.publishedAt === 'published') {
        searchFilters.publishedAt = { $notNull: true };
      } else if (filters.publishedAt === 'draft') {
        searchFilters.publishedAt = { $null: true };
      }
    }

    // Custom field filters
    if (filters.customFields) {
      Object.assign(searchFilters, filters.customFields);
    }

    return this.semanticSearch(query, contentType, {
      ...options,
      filters: searchFilters
    });
  }

});